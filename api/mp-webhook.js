import { webcrypto } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { db } from "./_db.js";
import { withSentry, reportError, flushSentry } from "./_sentry.js";
import { getClientIp, rateLimitOk } from "./_ratelimit.js";
const { subtle } = webcrypto;

const ENDPOINT = "mp-webhook";
const RL_IP = { limite: 60, ventanaSeg: 60 };

// Motivos terminales de confirmar_reserva_pago que disparan reembolso.
// Deben coincidir exactamente con los RETURN strings de la función PG.
const ORPHAN_MOTIVOS = new Set(["ttl_expirado", "cupo_excedido", "cancelada"]);

/**
 * Reembolsa un pago huérfano ya registrado en pagos_huerfanos.
 *
 * Fase 2 de 2 del protocolo INSERT-FIRST (fase 1 — el INSERT que decide quién
 * es el único handler — vive en RAMA A, en el camino crítico, awaited). Esta
 * función solo corre para el handler que ganó ese INSERT.
 *
 * Se ejecuta en background (via waitUntil, ver RAMA A) — el webhook ya
 * respondió 200 antes de que esto corra, así que cualquier falla acá tiene
 * que reportarse a Sentry explícitamente: ya no hay un 500 que bubblee para
 * que MP reintente. A diferencia del INSERT (fase 1), perder un reintento acá
 * no pierde la fila — pagos_huerfanos.motivo queda en 'pendiente' y se puede
 * reparar a mano; por eso esta fase sí puede ir en background.
 */
async function refundPagoHuerfano(pool, paymentId, montoArs, motivo) {
  let refundOk = false;
  try {
    const refundRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}/refunds`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ amount: montoArs }),
      },
    );
    if (refundRes.ok) {
      refundOk = true;
      console.log("Reembolso MP exitoso:", paymentId, "monto:", montoArs);
    } else {
      const errBody = await refundRes.text();
      console.error("Reembolso MP fallido:", refundRes.status, errBody, "paymentId:", paymentId);
      reportError("Reembolso MP fallido", { endpoint: ENDPOINT, payment_id: paymentId, mp_status: refundRes.status });
    }
  } catch (err) {
    console.error("Error de red al reembolsar en MP:", err, "paymentId:", paymentId);
    reportError(err, { endpoint: ENDPOINT, payment_id: paymentId, etapa: "refund_network_error" });
  }

  const finalMotivo = refundOk ? motivo : "refund_pendiente";
  try {
    await pool.query("UPDATE pagos_huerfanos SET motivo = $1 WHERE payment_id = $2", [finalMotivo, paymentId]);
  } catch (err) {
    console.error("Error al UPDATE motivo en pagos_huerfanos:", err, { paymentId, finalMotivo });
    reportError(err, { endpoint: ENDPOINT, payment_id: paymentId, etapa: "update_motivo_error" });
  }
  if (!refundOk) await flushSentry();
}

async function handler(req, res) {
  // POST only
  if (req.method !== "POST") return res.status(200).send("ok");

  const url = new URL(req.url, `https://${req.headers.host}`);

  // Soporte para AMBOS formatos de notificación de MP:
  //   Nuevo: POST ?type=payment&data.id=XXXXX
  //   Viejo: POST body={"type":"payment","data":{"id":"XXXXX"}}
  const qType = url.searchParams.get("type");
  const qDataId = url.searchParams.get("data.id");

  const bodyJson = req.body || {};
  const notifType = qType ?? bodyJson.type;
  const rawId = qDataId ?? bodyJson.data?.id;
  const paymentId = rawId != null ? String(rawId) : "";

  // 1. Validar firma HMAC-SHA256 de MP — fail-closed
  const xSignature = req.headers["x-signature"] ?? "";
  const xRequestId = req.headers["x-request-id"] ?? "";
  const webhookSecret = process.env.MP_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("MP_WEBHOOK_SECRET no configurado — rechazando por seguridad");
    reportError("MP_WEBHOOK_SECRET no configurado", { endpoint: ENDPOINT });
    await flushSentry();
    return res.status(500).send("Webhook misconfigured");
  }

  const ts = xSignature.match(/ts=([^,&]+)/)?.[1] ?? "";
  const v1 = xSignature.match(/v1=([^,&]+)/)?.[1] ?? "";
  const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`;
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected !== v1) {
    // No se reporta a Sentry a propósito: puede dispararse por bots/scanners
    // y por reintentos legítimos justo después de rotar el secreto — no es
    // un error operativo, y hay que cuidar la cuota free.
    console.error("Firma MP inválida", { expected, v1, manifest });
    return res.status(401).send("Unauthorized");
  }

  // 2. Filtrar: solo pagos con id
  if (notifType !== "payment") return res.status(200).send("ok");
  if (!paymentId) return res.status(200).send("ok");

  // 3. Rate limit por IP — recién acá (firma ya validada arriba); firma
  // inválida ya corta gratis sin llegar a este punto, así que esto es
  // piso extra contra un secreto filtrado o un reintentador descontrolado.
  const pool = db();
  const ip = getClientIp(req);
  if (!(await rateLimitOk(pool, `webhook:ip:${ip}`, RL_IP.limite, RL_IP.ventanaSeg))) {
    return res.status(429).send("Too Many Requests");
  }

  // 4. Consultar pago real en MP — no confiar en la notificación sola
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  const payment = await mpRes.json();

  if (payment.status !== "approved") return res.status(200).send("ok");

  const extRef = String(payment.external_reference ?? "");

  // ── RAMA A0: carrito de reservas (external_reference = "cart_<uuid>") ─────
  // Fase C (rama feature/carrito, no en main). Un solo pago de MP cubre varias
  // reservas que comparten carrito_id. Reusa confirmar_reserva_pago tal cual,
  // sin reescribirla — solo la llama en loop, una vez por reserva del carrito.
  if (extRef.startsWith("cart_")) {
    const carritoId = extRef.slice(5);

    let itemsCarrito;
    try {
      const r = await pool.query(
        "SELECT id FROM reservas WHERE carrito_id = $1 AND estado = 'pendiente_pago'",
        [carritoId],
      );
      itemsCarrito = r.rows;
    } catch (err) {
      console.error("Error al buscar reservas del carrito:", err);
      reportError(err, { endpoint: ENDPOINT, carrito_id: carritoId, payment_id: paymentId });
      await flushSentry();
      return res.status(500).send("error");
    }

    if (itemsCarrito.length === 0) {
      // Nada en pendiente_pago con ese carrito_id: o ya se confirmó todo en un
      // webhook anterior (reintento de MP, idempotente), o el carrito_id no
      // existe. 200 en ambos casos — no hay nada más que hacer, y no queremos
      // que MP reintente para siempre algo que no va a cambiar.
      return res.status(200).send("ok");
    }

    const huerfanos = [];
    for (const row of itemsCarrito) {
      let resultado;
      try {
        const { rows: [r] } = await pool.query(
          "SELECT confirmar_reserva_pago(p_reserva_id => $1, p_payment_id => $2) AS resultado",
          [row.id, String(paymentId)],
        );
        resultado = String(r?.resultado ?? "");
      } catch (err) {
        // Un ítem del carrito falló — se sigue con el resto en vez de cortar
        // todo el webhook (los otros ítems sí tienen que confirmarse). El que
        // falló queda pendiente_pago, se puede reintentar/reparar a mano.
        console.error("Error en confirmar_reserva_pago (carrito):", err, { reservaId: row.id, carritoId });
        reportError(err, { endpoint: ENDPOINT, carrito_id: carritoId, reserva_id: row.id, payment_id: paymentId });
        continue;
      }
      if (ORPHAN_MOTIVOS.has(resultado)) huerfanos.push({ reservaId: row.id, resultado });
    }

    if (huerfanos.length > 0) {
      // DECISIÓN DE NEGOCIO PENDIENTE, no adivinada: el pago del carrito es UNO
      // solo (un monto total, un payment_id) cubriendo varias clases. Si una o
      // más quedan huérfanas (cupo lleno / TTL vencido mientras se pagaba) no
      // está definido si corresponde reembolsar solo la parte de esa clase
      // (¿cómo se prorratea?), el total, o reprogramar sin costo. A diferencia
      // de RAMA A (reserva suelta) NO se dispara el refund automático acá — solo
      // se deja registro en pagos_huerfanos (clave sintética payment_id+reserva_id
      // porque la real se repite entre ítems del mismo carrito, y esa columna es
      // UNIQUE) para revisión manual. Ver docs/overnight-2026-08-10.md.
      for (const h of huerfanos) {
        try {
          await pool.query(
            `INSERT INTO pagos_huerfanos (payment_id, reserva_id, monto_ars, motivo)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (payment_id) DO NOTHING`,
            [`${paymentId}_cart_r${h.reservaId}`, h.reservaId, null, `carrito:${h.resultado}`],
          );
        } catch (err) {
          console.error("Error al registrar huérfano de carrito:", err);
          reportError(err, { endpoint: ENDPOINT, carrito_id: carritoId, reserva_id: h.reservaId, payment_id: paymentId });
        }
      }
      await flushSentry();
    }

    return res.status(200).send("ok");
  }

  // ── RAMA A: reserva de clase (external_reference = "r_<bigint>") ──────────
  if (extRef.startsWith("r_")) {
    const reservaId = parseInt(extRef.slice(2), 10);
    if (isNaN(reservaId)) {
      console.error("external_reference r_ con id no numérico:", extRef);
      reportError("external_reference r_ con id no numérico", { endpoint: ENDPOINT, external_reference: extRef, payment_id: paymentId });
      await flushSentry();
      return res.status(500).send("error");
    }

    let resultado;
    try {
      const { rows: [row] } = await pool.query(
        "SELECT confirmar_reserva_pago(p_reserva_id => $1, p_payment_id => $2) AS resultado",
        [reservaId, String(paymentId)],
      );
      resultado = String(row?.resultado ?? "");
    } catch (err) {
      console.error("Error en confirmar_reserva_pago:", err);
      reportError(err, { endpoint: ENDPOINT, reserva_id: reservaId, payment_id: paymentId });
      await flushSentry();
      return res.status(500).send("error");
    }

    if (resultado === "confirmada" || resultado === "ya_confirmada") {
      return res.status(200).send("ok");
    }

    if (ORPHAN_MOTIVOS.has(resultado)) {
      // FASE 1 (crítico, await): INSERT-first en pagos_huerfanos. Atómico bajo
      // el UNIQUE index (migración 005) — decide si somos el único handler.
      // Si esto falla, tiene que bubblear a un 500 real: sin la fila insertada
      // no queda ni idempotencia ni rastro para reparar el reembolso después,
      // así que necesitamos que MP reintente el webhook entero (por eso NO
      // hay try/catch acá — un catch que "resuelve" el error con un return
      // silencioso es exactamente lo que rompe el reintento).
      const { rows: inserted } = await pool.query(
        `INSERT INTO pagos_huerfanos (payment_id, reserva_id, monto_ars, motivo)
         VALUES ($1, $2, $3, 'pendiente')
         ON CONFLICT (payment_id) DO NOTHING
         RETURNING id`,
        [String(paymentId), reservaId, Math.round(payment.transaction_amount ?? 0)],
      );

      if (inserted.length === 0) {
        console.log("Pago huérfano ya registrado (conflict), skipping:", paymentId);
        return res.status(200).send("ok");
      }

      // FASE 2 (background, waitUntil): ganamos el INSERT → somos el único
      // handler → refund a MP + update de motivo, que es la parte lenta.
      // waitUntil evita que Vercel congele la función a mitad del fetch a MP
      // una vez que ya mandamos la respuesta.
      waitUntil(refundPagoHuerfano(pool, String(paymentId), payment.transaction_amount ?? 0, resultado));
      return res.status(200).send("ok");
    }

    console.error("confirmar_reserva_pago resultado inesperado:", resultado, { reservaId, paymentId });
    reportError(`confirmar_reserva_pago resultado inesperado: ${resultado}`, { endpoint: ENDPOINT, reserva_id: reservaId, payment_id: paymentId });
    await flushSentry();
    return res.status(500).send("error");
  }

  // ── RAMA B: compra de pack (external_reference = dígitos puros) ───────────
  if (/^\d+$/.test(extRef)) {
    const compraId = parseInt(extRef, 10);
    try {
      await pool.query(
        "SELECT aprobar_compra(p_compra_id => $1, p_payment_id => $2)",
        [compraId, String(paymentId)],
      );
    } catch (err) {
      console.error("Error en aprobar_compra:", err);
      reportError(err, { endpoint: ENDPOINT, compra_id: compraId, payment_id: paymentId });
      await flushSentry();
      return res.status(500).send("error");
    }
    return res.status(200).send("ok");
  }

  // ── RAMA C: patrón legado (external_reference = UUID) ────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { alumno_id, horas, precio, pack_id } = payment.metadata ?? {};
  if (!alumno_id || !horas || !precio) {
    console.error("Metadata incompleta (patrón legado), external_reference:", extRef, "payment:", paymentId);
    reportError("Metadata incompleta (patrón legado)", { endpoint: ENDPOINT, external_reference: extRef, payment_id: paymentId });
    await flushSentry();
    return res.status(500).send("error");
  }
  const safePackId = pack_id && UUID_RE.test(String(pack_id)) ? pack_id : null;
  try {
    await pool.query(
      `SELECT acreditar_compra(
         p_alumno_id => $1, p_horas => $2, p_precio => $3,
         p_payment_id => $4, p_pack_id => $5
       )`,
      [alumno_id, horas, precio, String(paymentId), safePackId],
    );
  } catch (err) {
    console.error("Error en acreditar_compra (legado):", err);
    reportError(err, { endpoint: ENDPOINT, payment_id: paymentId });
    await flushSentry();
    return res.status(500).send("error");
  }
  return res.status(200).send("ok");
}

export default withSentry(handler, ENDPOINT);

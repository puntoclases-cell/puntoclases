import { webcrypto } from "node:crypto";
import { db } from "./_db.js";
const { subtle } = webcrypto;

// Motivos terminales de confirmar_reserva_pago que disparan reembolso.
// Deben coincidir exactamente con los RETURN strings de la función PG.
const ORPHAN_MOTIVOS = new Set(["ttl_expirado", "cupo_excedido", "cancelada"]);

/**
 * Reembolsa un pago huérfano de forma atómica e idempotente.
 *
 * PROTOCOLO INSERT-FIRST:
 *   1. INSERT con ON CONFLICT (payment_id) DO NOTHING
 *   2. Si no insertó (conflict) → otro webhook ya lo procesó → return
 *   3. Si insertó → somos el único handler → hacer refund en MP
 *   4. UPDATE motivo con resultado real (motivo original | 'refund_pendiente')
 *
 * PREREQUISITO: pagos_huerfanos.payment_id debe tener índice UNIQUE
 * (migración 005). Sin él, el ON CONFLICT no tiene constraint sobre qué
 * columna conflictuar y no funciona como barrera.
 */
async function handleOrphan(pool, paymentId, reservaId, montoArs, motivo) {
  // INSERT-first: atómico bajo el UNIQUE index
  const { rows: inserted } = await pool.query(
    `INSERT INTO pagos_huerfanos (payment_id, reserva_id, monto_ars, motivo)
     VALUES ($1, $2, $3, 'pendiente')
     ON CONFLICT (payment_id) DO NOTHING
     RETURNING id`,
    [paymentId, reservaId, Math.round(montoArs)],
  );

  if (inserted.length === 0) {
    console.log("Pago huérfano ya registrado (conflict), skipping:", paymentId);
    return;
  }

  // Ganamos el INSERT → somos el único que hace el refund
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
    }
  } catch (err) {
    console.error("Error de red al reembolsar en MP:", err, "paymentId:", paymentId);
  }

  const finalMotivo = refundOk ? motivo : "refund_pendiente";
  try {
    await pool.query("UPDATE pagos_huerfanos SET motivo = $1 WHERE payment_id = $2", [finalMotivo, paymentId]);
  } catch (err) {
    console.error("Error al UPDATE motivo en pagos_huerfanos:", err, { paymentId, finalMotivo });
  }
}

export default async function handler(req, res) {
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
    console.error("Firma MP inválida", { expected, v1, manifest });
    return res.status(401).send("Unauthorized");
  }

  // 2. Filtrar: solo pagos con id
  if (notifType !== "payment") return res.status(200).send("ok");
  if (!paymentId) return res.status(200).send("ok");

  // 3. Consultar pago real en MP — no confiar en la notificación sola
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  const payment = await mpRes.json();

  if (payment.status !== "approved") return res.status(200).send("ok");

  const pool = db();
  const extRef = String(payment.external_reference ?? "");

  // ── RAMA A: reserva de clase (external_reference = "r_<bigint>") ──────────
  if (extRef.startsWith("r_")) {
    const reservaId = parseInt(extRef.slice(2), 10);
    if (isNaN(reservaId)) {
      console.error("external_reference r_ con id no numérico:", extRef);
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
      return res.status(500).send("error");
    }

    if (resultado === "confirmada" || resultado === "ya_confirmada") {
      return res.status(200).send("ok");
    }

    if (ORPHAN_MOTIVOS.has(resultado)) {
      await handleOrphan(pool, String(paymentId), reservaId, payment.transaction_amount ?? 0, resultado);
      return res.status(200).send("ok");
    }

    console.error("confirmar_reserva_pago resultado inesperado:", resultado, { reservaId, paymentId });
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
      return res.status(500).send("error");
    }
    return res.status(200).send("ok");
  }

  // ── RAMA C: patrón legado (external_reference = UUID) ────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { alumno_id, horas, precio, pack_id } = payment.metadata ?? {};
  if (!alumno_id || !horas || !precio) {
    console.error("Metadata incompleta (patrón legado), external_reference:", extRef, "payment:", paymentId);
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
    return res.status(500).send("error");
  }
  return res.status(200).send("ok");
}

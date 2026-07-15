import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
 * (migración 005). Sin él, upsert ignoreDuplicates no tiene constraint
 * sobre qué columna conflictuar y no funciona como barrera.
 */
async function handleOrphan(
  supabase: ReturnType<typeof createClient>,
  paymentId: string,
  reservaId: number,
  montoArs: number,
  motivo: string,
): Promise<void> {
  // INSERT-first: atómico bajo el UNIQUE index
  const { data: inserted, error: insertErr } = await supabase
    .from("pagos_huerfanos")
    .upsert(
      {
        payment_id: paymentId,
        reserva_id: reservaId,
        monto_ars:  Math.round(montoArs),
        motivo:     "pendiente",  // se actualiza al final con el resultado real
      },
      { onConflict: "payment_id", ignoreDuplicates: true },
    )
    .select("id");

  if (insertErr) {
    console.error("Error al insert en pagos_huerfanos:", insertErr, { paymentId });
    return;
  }

  if (!inserted || inserted.length === 0) {
    // Conflict: otro webhook ya ganó el INSERT — no reembolsar
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
          Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}`,
        },
        body: JSON.stringify({}),
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

  // Actualizar motivo final (reemplaza "pendiente" con el resultado real)
  const finalMotivo = refundOk ? motivo : "refund_pendiente";
  const { error: updateErr } = await supabase
    .from("pagos_huerfanos")
    .update({ motivo: finalMotivo })
    .eq("payment_id", paymentId);
  if (updateErr) {
    console.error("Error al UPDATE motivo en pagos_huerfanos:", updateErr, { paymentId, finalMotivo });
  }
}

Deno.serve(async (req) => {
  const url  = new URL(req.url);
  const body = await req.text();

  // Soporte para AMBOS formatos de notificación de MP:
  //   Nuevo: POST ?type=payment&data.id=XXXXX
  //   Viejo: POST body={"type":"payment","data":{"id":"XXXXX"}}
  const qType   = url.searchParams.get("type");
  const qDataId = url.searchParams.get("data.id");

  let bodyJson: { type?: string; data?: { id?: string | number } } = {};
  try { if (body) bodyJson = JSON.parse(body); } catch { /* body no-JSON, ignorar */ }

  const notifType = qType   ?? bodyJson.type;
  const rawId     = qDataId ?? bodyJson.data?.id;
  const paymentId = rawId != null ? String(rawId) : "";

  // 1. Validar firma HMAC-SHA256 de MP (sin cambios respecto al original)
  const xSignature    = req.headers.get("x-signature") ?? "";
  const xRequestId    = req.headers.get("x-request-id") ?? "";
  const webhookSecret = Deno.env.get("MP_WEBHOOK_SECRET");

  if (webhookSecret) {
    const ts  = xSignature.match(/ts=([^,&]+)/)?.[1] ?? "";
    const v1  = xSignature.match(/v1=([^,&]+)/)?.[1] ?? "";
    const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
    const expected = Array.from(new Uint8Array(sigBytes))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    if (expected !== v1) {
      console.error("Firma MP inválida", { expected, v1, manifest });
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 2. Filtrar: solo pagos con id
  if (notifType !== "payment") return new Response("ok", { status: 200 });
  if (!paymentId)              return new Response("ok", { status: 200 });

  // 3. Consultar pago real en MP — no confiar en la notificación sola
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}` },
  });
  const payment = await mpRes.json();

  if (payment.status !== "approved") return new Response("ok", { status: 200 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const extRef = String(payment.external_reference ?? "");

  // ── RAMA A: reserva de clase (external_reference = "r_<bigint>") ──────────
  if (extRef.startsWith("r_")) {
    const reservaId = parseInt(extRef.slice(2), 10);
    if (isNaN(reservaId)) {
      console.error("external_reference r_ con id no numérico:", extRef);
      return new Response("error", { status: 500 });
    }

    const { data: confirmarResult, error: confirmarErr } = await supabase.rpc(
      "confirmar_reserva_pago",
      { p_reserva_id: reservaId, p_payment_id: String(paymentId) },
    );
    if (confirmarErr) {
      // Error transitorio (DB, red) → 500 para que MP reintente
      console.error("Error en confirmar_reserva_pago:", confirmarErr);
      return new Response("error", { status: 500 });
    }

    const resultado = String(confirmarResult ?? "");

    if (resultado === "confirmada" || resultado === "ya_confirmada") {
      return new Response("ok", { status: 200 });
    }

    if (ORPHAN_MOTIVOS.has(resultado)) {
      // Terminal: reembolsar + registrar atómicamente, no reintentar
      await handleOrphan(
        supabase,
        String(paymentId),
        reservaId,
        payment.transaction_amount ?? 0,
        resultado,
      );
      return new Response("ok", { status: 200 });
    }

    // Respuesta inesperada del RPC → 500 para diagnóstico
    console.error("confirmar_reserva_pago resultado inesperado:", resultado, { reservaId, paymentId });
    return new Response("error", { status: 500 });
  }

  // ── RAMA A2: multi-reserva (external_reference = "mr_<id1>,<id2>,...") ────
  if (extRef.startsWith("mr_")) {
    const idsStr = extRef.slice(3);
    const reservaIds = idsStr.split(",").map(s => parseInt(s, 10)).filter(n => !isNaN(n));

    if (reservaIds.length === 0) {
      console.error("external_reference mr_ sin IDs válidos:", extRef);
      return new Response("error", { status: 500 });
    }

    const failedIds: number[] = [];
    for (const reservaId of reservaIds) {
      const { data: resultado, error: confirmarErr } = await supabase.rpc(
        "confirmar_reserva_pago",
        { p_reserva_id: reservaId, p_payment_id: String(paymentId) },
      );
      if (confirmarErr) {
        console.error("Error en confirmar_reserva_pago (multi):", confirmarErr, { reservaId });
        failedIds.push(reservaId);
        continue;
      }
      const result = String(resultado ?? "");
      if (result !== "confirmada" && result !== "ya_confirmada") {
        console.error("confirmar_reserva_pago resultado inesperado (multi):", result, { reservaId, paymentId });
        failedIds.push(reservaId);
      }
    }

    if (failedIds.length > 0) {
      console.error("Multi-reserva: fallaron confirmaciones:", failedIds, "paymentId:", paymentId);
    }
    return new Response("ok", { status: 200 });
  }

  // ── RAMA B: compra de pack (external_reference = dígitos puros) ───────────
  // Intacto respecto al original.
  if (/^\d+$/.test(extRef)) {
    const compraId = parseInt(extRef, 10);
    const { error } = await supabase.rpc("aprobar_compra", {
      p_compra_id:  compraId,
      p_payment_id: String(paymentId),
    });
    if (error) {
      console.error("Error en aprobar_compra:", error);
      return new Response("error", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }

  // ── RAMA C: patrón legado (external_reference = UUID) ────────────────────
  // Intacto respecto al original.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { alumno_id, horas, precio, pack_id } = payment.metadata ?? {};
  if (!alumno_id || !horas || !precio) {
    console.error("Metadata incompleta (patrón legado), external_reference:", extRef, "payment:", paymentId);
    return new Response("error", { status: 500 });
  }
  const safePackId = pack_id && UUID_RE.test(String(pack_id)) ? pack_id : null;
  const { error } = await supabase.rpc("acreditar_compra", {
    p_alumno_id:  alumno_id,
    p_horas:      horas,
    p_precio:     precio,
    p_payment_id: String(paymentId),
    p_pack_id:    safePackId,
  });
  if (error) {
    console.error("Error en acreditar_compra (legado):", error);
    return new Response("error", { status: 500 });
  }
  return new Response("ok", { status: 200 });
});

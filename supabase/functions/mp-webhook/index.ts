import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const body = await req.text();

  // Soporte para AMBOS formatos de MP:
  //   Nuevo: POST ?type=payment&data.id=XXXXX  (body puede ser vacío o JSON distinto)
  //   Viejo: POST body={"type":"payment","data":{"id":"XXXXX"}}
  const qType   = url.searchParams.get("type");
  const qDataId = url.searchParams.get("data.id");

  let bodyJson: { type?: string; data?: { id?: string | number } } = {};
  try { if (body) bodyJson = JSON.parse(body); } catch { /* body no-JSON, ignoramos */ }

  const notifType   = qType   ?? bodyJson.type;
  const rawId       = qDataId ?? bodyJson.data?.id;
  const paymentId   = rawId != null ? String(rawId) : "";

  // 1. Validar firma HMAC-SHA256 de MP
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

  // 2. Filtrar: solo procesamos notificaciones de pago con id
  if (notifType !== "payment") return new Response("ok", { status: 200 });
  if (!paymentId)              return new Response("ok", { status: 200 });

  // 3. Consultar el pago real en MP — no confiamos en la notificación sola
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

  // 4a. Nuevo patrón: external_reference = id numérico de la fila en compras
  if (/^\d+$/.test(extRef)) {
    const compraId = parseInt(extRef, 10);
    const { error } = await supabase.rpc("aprobar_compra", {
      p_compra_id:  compraId,
      p_payment_id: String(paymentId),
    });
    if (error) {
      console.error("Error en aprobar_compra:", error);
      return new Response("error", { status: 500 }); // MP reintenta en 500
    }
    return new Response("ok", { status: 200 });
  }

  // 4b. Patrón legado: external_reference = alumno_id (UUID), datos en metadata
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { alumno_id, horas, precio, pack_id } = payment.metadata ?? {};
  if (!alumno_id || !horas || !precio) {
    console.error("Metadata incompleta (patrón legado), external_reference:", extRef, "payment:", paymentId);
    return new Response("error", { status: 500 }); // MP reintenta — requiere fix manual
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const body = await req.text();

  // 1. Validar firma HMAC-SHA256 de MP
  //    MP envía: x-signature: "ts=<epoch>,v1=<hmac>"  y  x-request-id: "<uuid>"
  const xSignature = req.headers.get("x-signature") ?? "";
  const xRequestId = req.headers.get("x-request-id") ?? "";
  const webhookSecret = Deno.env.get("MP_WEBHOOK_SECRET");

  if (webhookSecret) {
    let notification: { type?: string; data?: { id?: string | number } };
    try { notification = JSON.parse(body); } catch { return new Response("Bad Request", { status: 400 }); }

    const paymentId = String(notification.data?.id ?? "");
    const ts = xSignature.match(/ts=([^,&]+)/)?.[1] ?? "";
    const v1 = xSignature.match(/v1=([^,&]+)/)?.[1] ?? "";
    const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
    const expected = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, "0")).join("");

    if (expected !== v1) {
      console.error("Firma MP inválida", { expected, v1, manifest });
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 2. Parsear la notificación
  let notification: { type?: string; data?: { id?: string | number } };
  try { notification = JSON.parse(body); } catch { return new Response("Bad Request", { status: 400 }); }

  if (notification.type !== "payment") return new Response("ok", { status: 200 });

  const paymentId = notification.data?.id;
  if (!paymentId) return new Response("ok", { status: 200 });

  // 3. Consultar el pago real en MP — no confiamos en la notificación sola
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}` },
  });
  const payment = await mpRes.json();

  if (payment.status !== "approved") return new Response("ok", { status: 200 });

  // 4. Extraer datos del alumno desde la metadata que pusimos al crear la preferencia
  const { alumno_id, horas, precio, pack_id } = payment.metadata ?? {};
  if (!alumno_id || !horas || !precio) {
    console.error("Metadata incompleta en payment", paymentId, payment.metadata);
    return new Response("ok", { status: 200 }); // no retryar — datos faltantes
  }

  // 5. Acreditar horas con la RPC idempotente (service_role bypasea RLS)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await supabase.rpc("acreditar_compra", {
    p_alumno_id: alumno_id,
    p_horas: horas,
    p_precio: precio,
    p_payment_id: String(paymentId),
    p_pack_id: pack_id ?? null,
  });

  if (error) {
    console.error("Error en acreditar_compra:", error);
    return new Response("error", { status: 500 }); // MP reintenta en 500
  }

  return new Response("ok", { status: 200 });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 1. Verificar JWT — rechaza usuarios no autenticados
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  // 2. El cliente manda { horas?, packId? } — NUNCA el precio
  const { horas, packId } = await req.json();

  // 3. Calcular precio server-side desde la config real de la DB
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: cfg, error: cfgErr } = await admin.from("config").select("precio_ind").single();
  if (cfgErr || !cfg) return new Response("Error leyendo config", { status: 500, headers: corsHeaders });

  const precioInd: number = cfg.precio_ind;
  let actualHoras: number;
  let actualPrecio: number;
  let resolvedPackId: string | null = null;

  if (packId) {
    const { data: pack, error: packErr } = await admin
      .from("packs")
      .select("horas, descuento")
      .eq("id", packId)
      .single();
    if (packErr || !pack) return new Response("Pack no encontrado", { status: 400, headers: corsHeaders });
    actualHoras = pack.horas;
    actualPrecio = Math.round(precioInd * pack.horas * (1 - pack.descuento / 100));
    resolvedPackId = packId;
  } else {
    if (!horas || horas < 1) return new Response("Parámetro horas inválido", { status: 400, headers: corsHeaders });
    actualHoras = horas;
    actualPrecio = actualHoras * precioInd;
  }

  // 4. Crear preferencia en MP — el token nunca sale al cliente
  const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}`,
    },
    body: JSON.stringify({
      items: [{ title: `${actualHoras} horas PuntoClases`, quantity: 1, unit_price: actualPrecio, currency_id: "ARS" }],
      // metadata viaja intacta con el pago — el webhook la lee para acreditar
      metadata: { alumno_id: user.id, horas: actualHoras, precio: actualPrecio, pack_id: resolvedPackId },
      external_reference: user.id,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
      back_urls: {
        success: "https://puntoclases.vercel.app",
        failure: "https://puntoclases.vercel.app",
        pending: "https://puntoclases.vercel.app",
      },
    }),
  });

  const pref = await mpRes.json();
  if (!mpRes.ok) {
    console.error("Error MP al crear preferencia:", JSON.stringify(pref));
    return new Response(JSON.stringify({ error: pref }), { status: 500, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ init_point: pref.init_point }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

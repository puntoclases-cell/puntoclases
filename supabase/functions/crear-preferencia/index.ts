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

  const body = await req.json();

  // ── RAMA A: pago por clase ────────────────────────────────────────────────
  // Body: { reservaParams: { profeId, materia, fecha, hora, horas, modalidad, tipo, necesidad? } }
  // El precio es 100% server-side (RPC crear_reserva_pendiente_pago lo calcula).
  if (body.reservaParams) {
    const { profeId, materia, fecha, hora, horas: rHoras, modalidad, tipo, necesidad } =
      body.reservaParams as {
        profeId: string; materia: string; fecha: string; hora: string;
        horas: number; modalidad: string; tipo: string; necesidad?: string;
      };

    const { data: rpcRows, error: rpcErr } = await anonClient.rpc(
      "crear_reserva_pendiente_pago",
      {
        p_profe_id:  profeId,
        p_materia:   materia,
        p_fecha:     fecha,
        p_hora:      hora,
        p_horas:     rHoras,
        p_modalidad: modalidad,
        p_tipo:      tipo,
        p_necesidad: necesidad ?? null,
      },
    );
    if (rpcErr || !rpcRows?.[0]) {
      console.error("Error en crear_reserva_pendiente_pago:", rpcErr);
      return new Response(
        JSON.stringify({ error: rpcErr?.message ?? "Error al crear reserva" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { reserva_id: reservaId, monto_ars: montoArs } = rpcRows[0] as {
      reserva_id: number; monto_ars: number;
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}`,
      },
      body: JSON.stringify({
        items: [{
          title:       `Clase de ${materia} - PuntoClases`,
          quantity:    1,
          unit_price:  montoArs,
          currency_id: "ARS",
        }],
        external_reference: `r_${reservaId}`,
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
        back_urls: {
          success: `https://puntoclases.vercel.app?reserva_id=${reservaId}`,
          failure: `https://puntoclases.vercel.app?reserva_id=${reservaId}`,
          pending: `https://puntoclases.vercel.app?reserva_id=${reservaId}`,
        },
      }),
    });
    const pref = await mpRes.json();
    if (!mpRes.ok) {
      console.error("Error MP al crear preferencia de clase:", JSON.stringify(pref));
      return new Response(
        JSON.stringify({ error: pref }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ init_point: pref.init_point, reserva_id: reservaId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── RAMA B: pago de packs (flujo existente, sin cambios) ─────────────────
  // Body: { horas?, packId? }
  const { horas, packId } = body as { horas?: number; packId?: string };

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
    actualHoras  = pack.horas;
    actualPrecio = Math.round(precioInd * pack.horas * (1 - pack.descuento / 100));
    resolvedPackId = packId;
  } else {
    if (!horas || horas < 1) return new Response("Parámetro horas inválido", { status: 400, headers: corsHeaders });
    actualHoras  = horas;
    actualPrecio = actualHoras * precioInd;
  }

  const { data: compraId, error: pendErr } = await admin.rpc("registrar_compra_pendiente", {
    p_alumno_id: user.id,
    p_horas:     actualHoras,
    p_precio:    actualPrecio,
    p_pack_id:   resolvedPackId,
  });
  if (pendErr || compraId == null) {
    console.error("Error al registrar compra pendiente:", pendErr);
    return new Response("Error al registrar compra", { status: 500, headers: corsHeaders });
  }

  const mpPackRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}`,
    },
    body: JSON.stringify({
      items: [{ title: `${actualHoras} horas PuntoClases`, quantity: 1, unit_price: actualPrecio, currency_id: "ARS" }],
      external_reference: String(compraId),
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
      back_urls: {
        success: "https://puntoclases.vercel.app",
        failure: "https://puntoclases.vercel.app",
        pending: "https://puntoclases.vercel.app",
      },
    }),
  });
  const pref = await mpPackRes.json();
  if (!mpPackRes.ok) {
    console.error("Error MP al crear preferencia:", JSON.stringify(pref));
    return new Response(JSON.stringify({ error: pref }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(
    JSON.stringify({ init_point: pref.init_point, compra_id: compraId }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

import { createClient } from "@supabase/supabase-js";
import { withSentry, reportError, flushSentry } from "./_sentry.js";

const ENDPOINT = "crear-preferencia-reserva";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const mpToken = process.env.MP_ACCESS_TOKEN;
  if (!mpToken) {
    reportError("MP_ACCESS_TOKEN no configurado", { endpoint: ENDPOINT });
    await flushSentry();
    return res.status(500).json({ error: "MP_ACCESS_TOKEN no configurado" });
  }

  // crear_reserva_pendiente_pago usa auth.uid() internamente (no recibe alumno_id
  // como parámetro) — tiene que llamarse vía PostgREST con el JWT real del alumno,
  // no por conexión directa a Postgres (ahí auth.uid() da NULL).
  const authHeader = req.headers.authorization ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return res.status(401).json({ error: "No autenticado" });

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: "Token inválido" });

  const { reservaParams } = req.body;
  if (!reservaParams) return res.status(400).json({ error: "Falta reservaParams" });

  const { profeId, materia, fecha, hora, horas, modalidad, tipo, necesidad } = reservaParams;

  const { data: rpcRows, error: rpcErr } = await userClient.rpc("crear_reserva_pendiente_pago", {
    p_profe_id: profeId,
    p_materia: materia,
    p_fecha: fecha,
    p_hora: hora,
    p_horas: horas,
    p_modalidad: modalidad,
    p_tipo: tipo,
    p_necesidad: necesidad ?? null,
  });
  if (rpcErr || !rpcRows?.[0]) {
    console.error("Error en crear_reserva_pendiente_pago:", rpcErr);
    return res.status(400).json({ error: rpcErr?.message ?? "Error al crear reserva" });
  }
  const { reserva_id: reservaId, monto_ars: montoArs } = rpcRows[0];

  try {
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify({
        items: [{
          title: `Clase de ${materia} - PuntoClases`,
          quantity: 1,
          unit_price: montoArs,
          currency_id: "ARS",
        }],
        external_reference: `r_${reservaId}`,
        notification_url: "https://puntoclases.vercel.app/api/mp-webhook",
        back_urls: {
          success: `https://puntoclases.vercel.app?reserva_id=${reservaId}`,
          failure: `https://puntoclases.vercel.app?reserva_id=${reservaId}`,
          pending: `https://puntoclases.vercel.app?reserva_id=${reservaId}`,
        },
      }),
    });
    const pref = await mpRes.json();
    if (!mpRes.ok) {
      reportError("Mercado Pago rechazó la preferencia (reserva)", { endpoint: ENDPOINT, reserva_id: reservaId, mp_status: mpRes.status });
      await flushSentry();
      return res.status(500).json(pref);
    }
    return res.status(200).json({ init_point: pref.init_point, reserva_id: reservaId });
  } catch (err) {
    reportError(err, { endpoint: ENDPOINT, reserva_id: reservaId });
    await flushSentry();
    return res.status(500).json({ error: err.message });
  }
}

export default withSentry(handler, ENDPOINT);

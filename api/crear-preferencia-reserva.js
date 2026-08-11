import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { db } from "./_db.js";
import { withSentry, reportError, flushSentry } from "./_sentry.js";
import { getClientIp, rateLimitOk, sendRateLimited } from "./_ratelimit.js";

const ENDPOINT = "crear-preferencia-reserva";
const RL_IP = { limite: 20, ventanaSeg: 300 };
const RL_ALUMNO = { limite: 5, ventanaSeg: 300 };
const MAX_ITEMS_CARRITO = 10; // tope defensivo, no pedido explícito pero evita un carrito gigante por error de front

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const pool = db();
  const ip = getClientIp(req);
  if (!(await rateLimitOk(pool, `reserva:ip:${ip}`, RL_IP.limite, RL_IP.ventanaSeg))) {
    return sendRateLimited(res, RL_IP.ventanaSeg);
  }

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

  if (!(await rateLimitOk(pool, `reserva:alumno:${user.id}`, RL_ALUMNO.limite, RL_ALUMNO.ventanaSeg))) {
    return sendRateLimited(res, RL_ALUMNO.ventanaSeg);
  }

  const { reservaParams, carritoItems } = req.body;

  // ── CAMINO NUEVO: carrito (Fase C, rama feature/carrito) ──────────────────
  if (Array.isArray(carritoItems)) {
    if (carritoItems.length === 0) return res.status(400).json({ error: "El carrito está vacío" });
    if (carritoItems.length > MAX_ITEMS_CARRITO) {
      return res.status(400).json({ error: `Máximo ${MAX_ITEMS_CARRITO} clases por carrito` });
    }

    const carritoId = randomUUID();
    const creadas = []; // { reservaId, montoArs, materia }

    // Se crean en orden, una por una — cada una es su propia transacción server-side
    // (dentro de la RPC), así que un fallo a mitad de camino deja las anteriores
    // como pendiente_pago reales (con TTL de 30min, se limpian solas si no se
    // completa el pago — mismo comportamiento que ya existe hoy para el caso de
    // una sola clase). No hay rollback conjunto: ver nota en
    // docs/overnight-2026-08-10.md, es una limitación conocida de este primer pase.
    for (const item of carritoItems) {
      const { profeId, materia, fecha, hora, horas, modalidad, tipo, necesidad } = item ?? {};
      const { data: rpcRows, error: rpcErr } = await userClient.rpc("crear_reserva_pendiente_pago", {
        p_profe_id: profeId,
        p_materia: materia,
        p_fecha: fecha,
        p_hora: hora,
        p_horas: horas,
        p_modalidad: modalidad,
        p_tipo: tipo,
        p_necesidad: necesidad ?? null,
        p_carrito_id: carritoId,
      });
      if (rpcErr || !rpcRows?.[0]) {
        console.error("Error en crear_reserva_pendiente_pago (carrito):", rpcErr, { materia, fecha, hora });
        return res.status(400).json({
          error: rpcErr?.message ?? "Error al crear una de las reservas del carrito",
          creadas_antes_del_error: creadas.map(c => c.reservaId), // para que el front pueda avisar qué sí quedó pendiente
        });
      }
      const { reserva_id: reservaId, monto_ars: montoArs } = rpcRows[0];
      creadas.push({ reservaId, montoArs, materia });
    }

    try {
      const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mpToken}`,
        },
        body: JSON.stringify({
          items: creadas.map(c => ({
            title: `Clase de ${c.materia} - PuntoClases`,
            quantity: 1,
            unit_price: c.montoArs,
            currency_id: "ARS",
          })),
          external_reference: `cart_${carritoId}`,
          notification_url: "https://puntoclases.vercel.app/api/mp-webhook",
          back_urls: {
            success: `https://puntoclases.vercel.app?carrito_id=${carritoId}`,
            failure: `https://puntoclases.vercel.app?carrito_id=${carritoId}`,
            pending: `https://puntoclases.vercel.app?carrito_id=${carritoId}`,
          },
        }),
      });
      const pref = await mpRes.json();
      if (!mpRes.ok) {
        reportError("Mercado Pago rechazó la preferencia (carrito)", { endpoint: ENDPOINT, carrito_id: carritoId, mp_status: mpRes.status });
        await flushSentry();
        return res.status(500).json(pref);
      }
      return res.status(200).json({
        init_point: pref.init_point,
        carrito_id: carritoId,
        reservas: creadas.map(c => c.reservaId),
      });
    } catch (err) {
      reportError(err, { endpoint: ENDPOINT, carrito_id: carritoId });
      await flushSentry();
      return res.status(500).json({ error: err.message });
    }
  }

  // ── CAMINO EXISTENTE: una sola clase (sin tocar, idéntico a como estaba) ──
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

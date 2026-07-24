import { db, getUserFromRequest } from "./_db.js";
import { withSentry, reportError, flushSentry } from "./_sentry.js";

const ENDPOINT = "crear-preferencia-pack";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // TEST TEMPORAL Sentry — remover tras confirmar en dashboard (2026-07-24)
  if (req.headers["x-sentry-test"] === "pc-sentry-test-2026-07-24") {
    reportError(`Sentry test — ${ENDPOINT}`, { endpoint: ENDPOINT, test: true });
    await flushSentry();
    return res.status(200).json({ sentry_test: "sent", endpoint: ENDPOINT });
  }

  const mpToken = process.env.MP_ACCESS_TOKEN;
  if (!mpToken) {
    reportError("MP_ACCESS_TOKEN no configurado", { endpoint: ENDPOINT });
    await flushSentry();
    return res.status(500).json({ error: "MP_ACCESS_TOKEN no configurado" });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "No autenticado" });

  const { horas, packId } = req.body;
  const pool = db();

  const { rows: [cfg] } = await pool.query("SELECT precio_ind FROM config LIMIT 1");
  if (!cfg) {
    reportError("Error leyendo config", { endpoint: ENDPOINT });
    await flushSentry();
    return res.status(500).json({ error: "Error leyendo config" });
  }
  const precioInd = cfg.precio_ind;

  let actualHoras;
  let actualPrecio;
  let resolvedPackId = null;

  if (packId) {
    const { rows: [pack] } = await pool.query(
      "SELECT horas, descuento FROM packs WHERE id = $1",
      [packId],
    );
    if (!pack) return res.status(400).json({ error: "Pack no encontrado" });
    actualHoras = pack.horas;
    actualPrecio = Math.round(precioInd * pack.horas * (1 - pack.descuento / 100));
    resolvedPackId = packId;
  } else {
    if (!horas || horas < 1) return res.status(400).json({ error: "Parámetro horas inválido" });
    actualHoras = horas;
    actualPrecio = actualHoras * precioInd;
  }

  let compraId;
  try {
    const { rows: [row] } = await pool.query(
      "SELECT registrar_compra_pendiente(p_alumno_id => $1, p_horas => $2, p_precio => $3, p_pack_id => $4) AS id",
      [user.id, actualHoras, actualPrecio, resolvedPackId],
    );
    compraId = row?.id;
  } catch (err) {
    console.error("Error al registrar compra pendiente:", err);
    reportError(err, { endpoint: ENDPOINT, alumno_id: user.id, pack_id: resolvedPackId, horas: actualHoras });
    await flushSentry();
    return res.status(500).json({ error: "Error al registrar compra" });
  }
  if (compraId == null) {
    reportError("registrar_compra_pendiente devolvió id null", { endpoint: ENDPOINT, alumno_id: user.id });
    await flushSentry();
    return res.status(500).json({ error: "Error al registrar compra" });
  }

  try {
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify({
        items: [{ title: `${actualHoras} horas PuntoClases`, quantity: 1, unit_price: actualPrecio, currency_id: "ARS" }],
        external_reference: String(compraId),
        notification_url: "https://puntoclases.vercel.app/api/mp-webhook",
        back_urls: {
          success: "https://puntoclases.vercel.app",
          failure: "https://puntoclases.vercel.app",
          pending: "https://puntoclases.vercel.app",
        },
      }),
    });
    const pref = await mpRes.json();
    if (!mpRes.ok) {
      reportError("Mercado Pago rechazó la preferencia (pack)", { endpoint: ENDPOINT, compra_id: compraId, mp_status: mpRes.status });
      await flushSentry();
      return res.status(500).json(pref);
    }
    return res.status(200).json({ init_point: pref.init_point, compra_id: compraId });
  } catch (err) {
    reportError(err, { endpoint: ENDPOINT, compra_id: compraId });
    await flushSentry();
    return res.status(500).json({ error: err.message });
  }
}

export default withSentry(handler, ENDPOINT);

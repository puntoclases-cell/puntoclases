import { db } from "../_db.js";
import { withSentry, reportError, flushSentry } from "../_sentry.js";

const ENDPOINT = "admin-limpiar-compras-colgadas";

// Cron diario (ver vercel.json) — compras que quedaron en 'pendiente' hace más
// de 24hs (el alumno abandonó el pago sin volver con failure/pending, o volvió
// con failure pero algo falló al llamar marcar_compra_fallida desde el front)
// se marcan 'fallido'. Solo higiene: usa la misma RPC marcar_compra_fallida()
// de Fase F, que NUNCA pisa una fila que ya esté 'aprobado' (transición
// pendiente→fallido únicamente) — no toca saldo, no reemplaza al webhook.
//
// Autenticación: Vercel manda `Authorization: Bearer $CRON_SECRET` en las
// invocaciones reales de Cron cuando CRON_SECRET está seteado (verificado acá,
// no confiamos en que la request "parezca" venir de Vercel). No usa JWT de
// usuario porque un cron job no tiene sesión de nadie — mismo motivo por el
// que confirmar_reserva_pago/aprobar_compra corren vía `pg` como `postgres`
// en el webhook en vez de vía PostgREST con JWT.
async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET no configurado — rechazando por seguridad");
    reportError("CRON_SECRET no configurado", { endpoint: ENDPOINT });
    await flushSentry();
    return res.status(500).json({ error: "CRON_SECRET no configurado" });
  }
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const pool = db();
  let candidatas;
  try {
    ({ rows: candidatas } = await pool.query(
      `SELECT id, alumno_id, horas, monto, creado_en
       FROM compras
       WHERE estado_pago = 'pendiente'
         AND creado_en < now() - interval '24 hours'
       ORDER BY creado_en ASC`,
    ));
  } catch (err) {
    console.error("Error al buscar compras colgadas:", err);
    reportError(err, { endpoint: ENDPOINT });
    await flushSentry();
    return res.status(500).json({ error: "Error al consultar compras" });
  }

  const marcadas = [];
  const fallidas = [];
  for (const c of candidatas) {
    try {
      await pool.query("SELECT marcar_compra_fallida($1)", [c.id]);
      marcadas.push(c.id);
    } catch (err) {
      console.error("Error al marcar compra fallida:", c.id, err);
      reportError(err, { endpoint: ENDPOINT, compra_id: c.id });
      fallidas.push(c.id);
    }
  }

  console.log(`limpiar-compras-colgadas: ${candidatas.length} candidata(s), ${marcadas.length} marcada(s), ${fallidas.length} error(es)`);
  if (fallidas.length > 0) await flushSentry();

  return res.status(200).json({
    candidatas: candidatas.length,
    marcadas: marcadas.length,
    errores: fallidas.length,
    ids_marcadas: marcadas,
  });
}

export default withSentry(handler, ENDPOINT);

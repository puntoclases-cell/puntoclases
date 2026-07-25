import { db, getUserFromRequest } from "../_db.js";
import { withSentry, reportError, flushSentry } from "../_sentry.js";

const ENDPOINT = "admin-reconciliar-huerfanos";

// Lista pagos_huerfanos sin reembolsar (motivo 'pendiente' o 'refund_pendiente') —
// filas que quedaron así porque el proceso murió entre el INSERT y el refund a MP,
// o porque el refund en sí falló. Por ahora SOLO lista y loguea — no dispara nada.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "No autenticado" });

  const pool = db();

  const { rows: [profile] } = await pool.query("SELECT rol FROM profiles WHERE id = $1", [user.id]);
  if (!profile || profile.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, payment_id, reserva_id, monto_ars, motivo, creado_en
       FROM pagos_huerfanos
       WHERE motivo IN ('pendiente', 'refund_pendiente')
       ORDER BY creado_en ASC`,
    ));
  } catch (err) {
    console.error("Error al listar pagos huérfanos:", err);
    reportError(err, { endpoint: ENDPOINT });
    await flushSentry();
    return res.status(500).json({ error: "Error al consultar pagos huérfanos" });
  }

  console.log(`Reconciliación huérfanos: ${rows.length} fila(s) sin reembolsar`, rows.map(r => r.payment_id));

  // ─────────────────────────────────────────────────────────────────────────
  // DISPARO DE REFUND REAL — DESHABILITADO A PROPÓSITO. Esto mueve plata real
  // en Mercado Pago. NO descomentar/activar sin aprobación explícita de David
  // en un paso aparte (ver reporte de la tarea 2 del loop 2026-07-25).
  //
  // for (const fila of rows) {
  //   try {
  //     const refundRes = await fetch(
  //       `https://api.mercadopago.com/v1/payments/${fila.payment_id}/refunds`,
  //       {
  //         method: "POST",
  //         headers: {
  //           "Content-Type": "application/json",
  //           Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
  //         },
  //         body: JSON.stringify({ amount: fila.monto_ars }),
  //       },
  //     );
  //     if (refundRes.ok) {
  //       await pool.query("UPDATE pagos_huerfanos SET motivo = $1 WHERE id = $2", [fila.motivo, fila.id]);
  //     } else {
  //       reportError("Reembolso MP fallido (reconciliación)", { endpoint: ENDPOINT, payment_id: fila.payment_id, mp_status: refundRes.status });
  //     }
  //   } catch (err) {
  //     reportError(err, { endpoint: ENDPOINT, payment_id: fila.payment_id, etapa: "reconciliacion_refund" });
  //   }
  // }
  // ─────────────────────────────────────────────────────────────────────────

  return res.status(200).json({ pendientes: rows.length, filas: rows });
}

export default withSentry(handler, ENDPOINT);

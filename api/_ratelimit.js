export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

export async function rateLimitOk(pool, clave, limite, ventanaSeg) {
  const { rows: [row] } = await pool.query(
    "SELECT chequear_rate_limit($1, $2, $3) AS ok",
    [clave, limite, ventanaSeg],
  );
  return row.ok;
}

export function sendRateLimited(res, ventanaSeg) {
  res.setHeader("Retry-After", String(ventanaSeg));
  return res.status(429).json({ error: "Demasiadas solicitudes, esperá unos minutos" });
}

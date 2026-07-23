import * as Sentry from "@sentry/node";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV === "production" ? "production" : "preview",
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}

// Nunca deben llegar a Sentry: secretos server-side ni PII de alumnos.
function scrubEvent(event) {
  const secrets = [process.env.MP_ACCESS_TOKEN, process.env.MP_WEBHOOK_SECRET, process.env.DATABASE_URL].filter(Boolean);
  let json = JSON.stringify(event);
  for (const secret of secrets) json = json.split(secret).join("[REDACTED]");
  const scrubbed = JSON.parse(json);
  delete scrubbed.user;
  if (scrubbed.request) {
    delete scrubbed.request.data;
    delete scrubbed.request.cookies;
    delete scrubbed.request.headers;
  }
  return scrubbed;
}

// Reporta un error ya manejado (el caller sigue decidiendo status code y respuesta).
// Acepta un Error o un mensaje de texto (para condiciones sin excepción, ej. config faltante).
// El contexto debe ser solo ids/metadata (endpoint, payment_id, reserva_id, compra_id) —
// nunca mail/nombre del alumno.
export function reportError(errOrMessage, context = {}) {
  ensureInit();
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context.endpoint) scope.setTag("endpoint", context.endpoint);
    scope.setContext("detalle", context);
    if (errOrMessage instanceof Error) {
      Sentry.captureException(errOrMessage);
    } else {
      Sentry.captureMessage(String(errOrMessage), "error");
    }
  });
}

export async function flushSentry() {
  if (!initialized || !process.env.SENTRY_DSN) return;
  await Sentry.flush(2000).catch(() => {});
}

// Envuelve un handler: reporta cualquier excepción no capturada por el handler
// y la vuelve a lanzar tal cual — no cambia el status code (si nadie más la
// agarra, Vercel responde 500 igual que antes de instrumentar).
export function withSentry(handler, endpoint) {
  return async function wrapped(req, res) {
    ensureInit();
    try {
      return await handler(req, res);
    } catch (err) {
      reportError(err, { endpoint });
      await flushSentry();
      throw err;
    }
  };
}

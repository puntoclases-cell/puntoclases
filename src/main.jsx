import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'
import UpdatePrompt from './UpdatePrompt.jsx'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.VERCEL_ENV === 'production' ? 'production' : 'preview',
    tracesSampleRate: 0, // solo errores por ahora — cuida la cuota free
    ignoreErrors: [
      'message channel closed',
      'ResizeObserver loop completed with undelivered notifications',
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
    ],
    beforeSend: scrubSentryEvent,
  })
}

// Nunca mandar PII de alumnos (mail, nombre) ni datos de sesión del navegador.
function scrubSentryEvent(event) {
  delete event.user
  if (event.request) {
    delete event.request.cookies
    delete event.request.data
  }
  return event
}

function ErrorFallback() {
  return (
    <div style={{ padding: 32, textAlign: 'center', fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <p style={{ fontSize: 15, color: '#374151' }}>Algo salió mal. Recargá la página para seguir.</p>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: 12, padding: '10px 20px', borderRadius: 10, border: 'none', background: '#1c7ed6', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
      >
        Recargar
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
    <UpdatePrompt />
  </StrictMode>,
)

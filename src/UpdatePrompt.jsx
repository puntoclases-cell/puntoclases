import { useRegisterSW } from 'virtual:pwa-register/react'

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Polling cada hora: detecta deploys nuevos aunque la app quede abierta mucho tiempo
      if (r) setInterval(() => r.update(), 15 * 60 * 1000)
    },
  })

  if (!needRefresh) return null

  return (
    <div style={{
      position: 'fixed', bottom: 90, left: 0, right: 0,
      display: 'flex', justifyContent: 'center',
      zIndex: 9999, padding: '0 20px', pointerEvents: 'none',
    }}>
      <div style={{
        background: '#1e293b', color: '#fff',
        borderRadius: 14, padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        maxWidth: 440, width: '100%', pointerEvents: 'auto',
      }}>
        <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
          🆕 Hay una versión nueva disponible
        </span>
        <button
          onClick={() => updateServiceWorker(true)}
          style={{
            background: '#D94F3D', color: '#fff',
            border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 13,
            fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}

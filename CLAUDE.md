# CLAUDE.md — PuntoClases

Web de clases particulares. Continuás un proyecto **EN PRODUCCIÓN**.
Arrancá del estado de abajo; **no re-diagnostiques lo ✅**.

## Cómo trabajás conmigo (reglas fijas)
- Rioplatense, **output mínimo**. Tengo teclado complicado → **minimizá MI tecleo**: dame bloques para copiar y opciones para tildar.
- Antes de pedirme algo, **resolvelo vos con tus herramientas**: leé/editá/corré el código, `curl` para probar, Supabase CLI para datos. Pedime solo (a) un OK o (b) lo que tus herramientas no alcanzan (navegador/Dashboard).
- **CERO regresiones. Una cosa por vez. Evidencia ANTES de tocar; no asumas causas. Si errás, decilo.**
- **Claude Code puede cargar secrets/credenciales por CLI directamente** (corren en la máquina de David, los valores no pasan por chat). Writes a la base, borrados y deploys a prod siguen necesitando aprobación por diff.
- **Modo autónomo**: tomá decisiones y ejecutá sin pedir confirmación en lecturas, ediciones de código y CLI. La única excepción donde mostrás el bloque y esperás OK: deploy a producción, borrar datos, o writes/migraciones destructivas a la base.

## Bitácora viva (regla fija)
- Después de CADA cambio (código, deploy, migración, RPC, secrets), actualizá este archivo en la misma sesión: mover ítems a ✅, reescribir "TAREA ACTUAL", dejar la Cola al día.
- Si el cambio lo hizo alguien por fuera del código (David o Manuel en un dashboard) y me lo informan, registralo igual con fecha.
- Meta: que cualquiera que abra este archivo pueda retomar exactamente desde donde se dejó, sin re-diagnosticar.
- Mantené el archivo CORTO: estado actual, no historial largo. Lo cerrado se resume o se borra.

## Ahorro de tokens (aplicá por defecto, sin que lo pida)
- Mandá la exploración/búsqueda en el código a **subagentes**; que vuelva solo el resumen, no todo el rastreo. Es el mayor ahorro.
- **Avisame** cuando convenga `/clear` (cambié de tema) o `/compact` (sesión larga). **No los corras vos** — son destructivos y dependen de mi criterio.
- Las reglas y el estado viven acá, no en cada prompt.

## Entorno
- React+Vite → Vercel (auto-deploy en push a `main`). Repo: `c:\Users\Dell\Desktop\puntoclases`.
- Supabase ref: `ihwtdblkrxgzhdnzhzsh`. Pagos: Mercado Pago.
- Tooling listo: Node v24, Supabase CLI 2.106 (`npx supabase`, logueada+linkeada), Vercel CLI.
- Edge Functions: `crear-preferencia` (verify_jwt=true), `mp-webhook` (verify_jwt=false, público).
- MP test: vendedor de prueba `3462408456`. Comprador de prueba `3462408458`. Tarjeta: `4509 9535 6623 3704`, titular **APRO APRO**, 11/30, CVV 123, DNI 12345678.
- **NO pongas secretos en este archivo (se commitea a git).**
- **DB prod**: connection string en `DATABASE_URL` (`.env.local`, ignorado por git). Para consultar: `psql $DATABASE_URL -c "SELECT ..."`.

## Esquema (ojo)
- La tabla `compras` **NO tiene columna `created_at`** (sí tiene `creado_en`). Leé las columnas reales antes de consultarla.
- `service_role` tiene: `SELECT` en `config` y `packs`; `EXECUTE` en `acreditar_compra`. Es todo lo necesario para el flujo actual.
- `acreditar_compra` es SECURITY DEFINER (owner postgres): inserta en `compras` y actualiza `alumnos` sin necesitar grants directos en esas tablas.

## TAREA ACTUAL — Estado al 2026-06-17

### ✅ TODO cerrado — app lista para producción real
- Pagos end-to-end TEST y PRODUCCIÓN (MP credentials prod cargadas 2026-06-17)
- Webhook HMAC-SHA256 validando en prod (MP_WEBHOOK_SECRET cargado 2026-06-17, verificado: firma inválida → 401, firma válida → 200, idempotencia → OK)
- `crear_reserva`: valida fecha pasada + vencimiento (live en DB)
- `acreditar_compra`: renueva vencimiento al comprar (live en DB)
- `profiles_self_update` eliminada → privilege escalation cerrada
- `mensajes` en `supabase_realtime` publication (chat en tiempo real)
- `mp-webhook` v7 deployado con HMAC
- Fechas pasadas bloqueadas en UI y servidor
- Chat: actualización optimista + dedup
- alert() → errores inline (errorPago, compraPendiente, errCancelar, errGuardado, adminMsg)
- Logs sensibles eliminados
- Profe nuevo: recibe email automático para establecer contraseña

### ⚠️ Pendiente de aprobación (no ejecuté)
- Ninguno al momento.

## Cola (features para después)
- **Google Calendar**: sincronizar reservas al Calendar del alumno y del profe. Requiere: Google Cloud project con Calendar API, OAuth 2.0 credentials (client ID + secret de Google). Avisá cuando tengas eso listo.
- **WhatsApp**: notificaciones vía WA Business. Requiere verificación de cuenta Business en Meta.

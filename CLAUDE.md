# CLAUDE.md — PuntoClases

Web de clases particulares. Continuás un proyecto **EN PRODUCCIÓN**.
Arrancá del estado de abajo; **no re-diagnostiques lo ✅**.

## Autonomía (regla fija)
- Claude Code corre TODO de forma autónoma sin pedir OK: lecturas, ediciones de código, comandos CLI, secrets, deploys, y migraciones a la base (incluida producción).
- ÚNICA obligación antes de una migración que MODIFIQUE o BORRE datos existentes (no para agregar columnas/tablas nuevas vacías): hacer un backup/dump de las tablas afectadas primero, automáticamente, sin preguntar. Dejar registrado en el CLAUDE.md qué se respaldó y dónde.
- Si una operación falla, revertir lo que se pueda y reportarlo a David. Nunca dejar la base rota a medias.

## Cómo trabajás conmigo (reglas fijas)
- Rioplatense, **output mínimo**. Tengo teclado complicado → **minimizá MI tecleo**: dame bloques para copiar y opciones para tildar.
- Antes de pedirme algo, **resolvelo vos con tus herramientas**: leé/editá/corré el código, `curl` para probar, Supabase CLI para datos. Pedime solo (a) un OK o (b) lo que tus herramientas no alcanzan (navegador/Dashboard).
- **CERO regresiones. Una cosa por vez. Evidencia ANTES de tocar; no asumas causas. Si errás, decilo.**
- Claude Code puede cargar secrets/credenciales por CLI directamente (corren en la máquina de David, los valores no pasan por chat).
- **Reads y diagnóstico:** automatizalos siempre.
- **Writes ADITIVOS / reversibles a la base** (ej: ADD COLUMN IF NOT EXISTS, CREATE POLICY, CREATE TABLE, INSERT … ON CONFLICT DO NOTHING, grants que agregan permisos, crear bucket de Storage, deploy de Edge Functions): corrélos vos por la Supabase CLI y mostrame evidencia de que aplicó. No me los pidas para correrlos yo.
- **Writes DESTRUCTIVOS / irreversibles** (DROP, DELETE, TRUNCATE, ALTER que borra o renombra columnas, migraciones con pérdida de datos, revocar o quitar permisos, rotar o borrar credenciales): NO ejecutes. Backup primero si aplica, mostrame el bloque y el plan, los corro yo.
- **Ante la duda:** si no tenés certeza de que un write es aditivo/reversible, tratalo como destructivo y pedime OK.

## Bitácora viva (regla fija)
- Después de CADA cambio (código, deploy, migración, RPC, secrets), actualizá este archivo en la misma sesión.
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
- **⚠️ DOS implementaciones del webhook de pagos hoy — ver "P0 ABIERTO" abajo antes de tocar cualquiera de las dos:**
  - `api/mp-webhook.js` (Vercel, `pg`/`DATABASE_URL`) — tiene HMAC fail-closed, rate limiting, Sentry, idempotencia, fix de refund async. Es lo que crea `crear-preferencia-pack.js`/`crear-preferencia-reserva.js` (Vercel) como `notification_url`.
  - `supabase/functions/mp-webhook` (Edge Function, Deno) — es la URL cargada HOY en el panel de MP ("Tus integraciones → Webhooks → Modo productivo"), confirmado con entregas reales 200 OK. Sin Sentry, sin rate limiting, HMAC fail-open si falta el secret. `supabase/functions/crear-preferencia` (su contraparte) ya no la llama el front.
  - No confirmado todavía: si un pago real creado por el código de Vercel hoy termina notificando a Vercel o a la Edge Function (no hay pagos reales completados desde el 22/07 para comprobarlo). Plan de cutover con evidencia: ver "P0 ABIERTO".
- MP test: vendedor de prueba `3462408456`. Comprador de prueba `3462408458`. Tarjeta: `4509 9535 6623 3704`, titular **APRO APRO**, 11/30, CVV 123, DNI 12345678.
- **NO pongas secretos en este archivo (se commitea a git).**
- **DB prod**: connection string en `DATABASE_URL` (`.env.local`, ignorado por git). `MP_WEBHOOK_SECRET` también en `.env.local` (cargado 2026-07-25) y en Vercel Production. Para consultar: `psql $DATABASE_URL -c "SELECT ..."` (o vía `pg` desde Node si `psql` no está en el PATH).

## Esquema (ojo)
- La tabla `compras` **NO tiene columna `created_at`** (sí tiene `creado_en`). Leé las columnas reales antes de consultarla.
- `service_role` tiene: `SELECT` en `config` y `packs`; `EXECUTE` en `acreditar_compra`, `registrar_compra_pendiente`, `aprobar_compra`. Ningún grant directo en `alumnos`, `compras`, `reservas`, `profiles`, `mensajes`.
- `acreditar_compra`, `registrar_compra_pendiente`, `aprobar_compra` son SECURITY DEFINER (owner postgres): operan sobre `compras` y `alumnos` sin grants directos.
- `registrar_compra_pendiente(alumno_id, horas, precio, pack_id)` → inserta fila con `estado_pago='pendiente'`, devuelve `id BIGINT`.
- `aprobar_compra(compra_id, payment_id)` → idempotente: si ya está `'aprobado'` devuelve saldo sin tocar nada; si no, actualiza `compras` y `alumnos` en un solo tx.

## ESTADO ACTUAL — al 2026-07-25

**P0 ABIERTO — unificar webhook de MP (correctitud/plata, ver "Entorno" arriba):**
Diagnóstico hecho, plan de cutover propuesto, **nada ejecutado todavía** (panel de MP lo toca David). Pendiente: pago de prueba (sandbox o productivo de mínimo monto, a decidir) para confirmar por dónde entra hoy un pago creado con el código de Vercel, y recién ahí decidir si hace falta cambiar la URL del panel o no.

✅ Backend de pagos reescrito a `pg`/`DATABASE_URL` (2026-07-22, `dd42dd8`): `api/crear-preferencia-pack.js`, `api/crear-preferencia-reserva.js`, `api/mp-webhook.js` en Vercel, sin depender de `SUPABASE_SERVICE_ROLE_KEY`. Auth híbrida: funciones con `auth.uid()` interno (`crear_reserva_pendiente_pago`) vía JWT/PostgREST; el resto vía `pg` directo (rol `postgres`, ya tiene EXECUTE en todas las RPC).

✅ Carrito multi-reserva revertido (2026-07-22, `75fb3c7`): vuelta a una clase por vez. La rama `mr_...` sigue existiendo (muerta) en la Edge Function vieja.

✅ Rate limiting en prod (2026-07-24/25): tabla `rate_limits` + función `chequear_rate_limit` (ventana fija, atómica, `EXECUTE` solo `postgres`) aplicadas y **verificadas en DB** (existencia + grants + filas reales de uso). Activo en los 3 endpoints Vercel (pack/reserva/webhook). Migración `20260724000001_rate_limits.sql`.

✅ Sentry instrumentado (2026-07-24, `7c61513`): front (`@sentry/react`) + los 3 endpoints Vercel (`@sentry/node`, `api/_sentry.js`). Scrubbing de secrets/PII. Requiere `SENTRY_DSN`/`VITE_SENTRY_DSN` cargados en Vercel (ya están). **No cubre la Edge Function** (ver P0).

✅ Paginación admin (2026-07-25, `74b268e`): `getAlumnos`/`getProfesAdmin`/`getTodasLasReservas` con `{page, pageSize}` + `.range()`. Los agregados de Dashboard/Personas/Finanzas siguen trayendo el set completo (pageSize alto) para no romper conteos — con `console.warn` si se trunca.

✅ Cache config/packs (2026-07-25, `84b46e2`): TTL 5min en memoria del cliente, `updateConfig` refresca el cache al guardar.

✅ Refund de pago huérfano fuera del camino crítico (2026-07-25, `9242332` + fix `8e7ad35`): el INSERT-first en `pagos_huerfanos` queda `await`-eado en el crítico (si falla, bubblea a 500 real → MP reintenta); solo el refund a MP + update de motivo van en background vía `waitUntil` (`@vercel/functions`). *Ojo: este fix es solo para `api/mp-webhook.js` — la Edge Function nunca tuvo este bug porque nunca tuvo el patrón async que lo causaba.*

✅ Endpoint de reconciliación de huérfanos (2026-07-25, `1e3b014`): `GET /api/admin/reconciliar-huerfanos` (admin-only), solo lista y loguea filas `pendiente`/`refund_pendiente` de `pagos_huerfanos`. **Refund automático deshabilitado a propósito** (código comentado, activar requiere OK explícito de David).

⏸️ `get_finanzas_periodo()` — migración escrita y documentada (`20260725000001_finanzas_agregados.sql`), agregados server-side de ingresos por período para Finanzas/Dashboard. **NO aplicada a la DB todavía.**

⏸️ `npm audit fix` parcial (2026-07-25, `0d7c383`): resueltos `fast-uri`/`postcss`. Queda `brace-expansion` (alta, transitivo de `vite-plugin-pwa`→`workbox-build`, requiere `--force` y bajar `vite-plugin-pwa` a 1.2.0 — breaking change, no aplicado, riesgo real bajo por ser build-time).

✅ `invalidatePacksCache()` borrada (2026-07-25, `bc41f61`) — código muerto confirmado, no hay ningún escritor de `packs` en el repo.

--- histórico (2026-07-02 a 2026-07-15), cerrado, sin acción pendiente ---

✅ Fix definitivo del bug original de acreditación (2026-07-02): MP Checkout Pro no propaga `metadata` al payment → patrón "compra pendiente en DB" (Opción B), `external_reference` = id numérico, 500 en vez de 200 silencioso.
✅ `MP_WEBHOOK_SECRET` rotado 2026-06-24 (valor viejo había pasado por chat).
✅ `devolver_horas` bigint fix (2026-07-05, `cb395f3`).
✅ F6 Etapa 1 (migraciones `pendiente_pago`/`expirada`, `pagos_huerfanos`, `crear_reserva_pendiente_pago`, `confirmar_reserva_pago`) y Etapa 2a (backend pago por clase + `handleOrphan`) — aplicadas a prod el 2026-07-05, en su momento en rama `f6-review`.

## INVARIANTES DE INTEGRIDAD (obligatorias en todas las fases)
1. Dinero y saldo solo se mueven server-side en RPCs atómicas e idempotentes (clave: payment_id / reserva_id). El front jamás confirma pagos ni descuenta saldo.
2. Toda reserva paga nace `'pendiente_pago'` con TTL de 30 min que retiene cupo; el webhook la confirma vía external_reference; vencida, libera cupo. Revalidar cupo al aprobar.
3. Cupo grupal y overlap de slots se validan y descuentan DENTRO de la transacción SQL (lock), nunca en el front.
4. La tabla `reservas` es la única fuente de verdad del calendario (alumno y profe leen de ahí, sin copias).
5. Precios se leen de la DB también para display (nada de precios hardcodeados en el front).
6. Al volver de MP: polling del estado real en DB (cada ~3s, mensaje "Estamos confirmando tu pago…"), no setTimeout ciego.
7. Cancelaciones: RPC atómica idempotente con regla de 24hs (nunca devolver dos veces).

Toda fase nueva se diseña para que violar estas reglas sea imposible, y agrega verificación de esto en sus criterios de aceptación.

## REDISEÑO — COLA DE FASES
- **F1–F5.1 ✅** (2026-07-04/05): design system accesible, wizard reserva 8 pasos, agenda del alumno rediseñada, grupal real (tabla `grupos`, cupo en vivo, `unirse_grupo`/`get_grupo_info`). Todo en prod, sin cambios desde entonces.
  - **RADAR F6 pendiente**: cancelar grupo → devolver saldo a todos los inscriptos · reconciliar tipo 'ambas' de disponibilidad.
  - **LÍMITE CONOCIDO (no bloqueante)**: `unirse_grupo` no valida solapamiento entre dos grupos del mismo profe a horas distintas.
- **F6 (Etapas 1, 2a, 2b, 2c) ✅ — en `main`, no en `f6-review`**: el pago por clase (reserva → `pendiente_pago` con TTL → pago MP → `confirmar_reserva_pago` → huérfano/refund si corresponde) está completo y mergeado. La bitácora vieja decía "en rama f6-review" para 2b/2c — quedó desactualizada; confirmado en código que `api/crear-preferencia-reserva.js` y el flujo completo viven en `main` desde el push del 2026-07-22.
  - **VERIFICAR pendiente (no bloqueante, no crítico hoy)**: reprogramar una grupal pagada de extremo a extremo — cupo en el nuevo horario, re-agrupación correcta.
- **F7** (opcional, no arrancado): carrito progresivo "Agregar otra clase".

## AUDITORÍA DE ESCALABILIDAD — cola aparte (track distinto al rediseño)
- **FASE 1 ✅**: diagnóstico completo, solo reporte (10 áreas: DB/pooler, índices, RLS, caching, paginación, async, rate limit, monitoreo, realtime). Sin cambios de código.
- **FASE 2 (en curso)**: fixes uno por uno, ver ✅/⏸️ en ESTADO ACTUAL arriba (índices, rate limiting, Sentry, paginación admin, cache, refund async, reconciliación huérfanos, npm audit). Pendientes: aplicar `get_finanzas_periodo`, `npm audit --force` (decisión), P0 del webhook.
- **FASE 3 (no arrancada)**: load testing contra un Preview deploy (no prod). Explícitamente pausada hasta cerrar FASE 2.
- **Objetivo declarado**: soportar ~15 profes × 20 alumnos (hasta 300 usuarios). Ver resumen ejecutivo de la sesión 2026-07-25 para el detalle de qué es mínimo indispensable antes de esa carga (hoy: P0 del webhook es el ítem #1).

## Regla de negocio — Vencimiento de horas (fija)
- `saldo >= 0.8 hs` cuando vence → se pierde todo (saldo = 0). La clase mínima es 0.8 hs; si tenés menos no podés reservar.
- `saldo < 0.8 hs` cuando vence → se conserva (remanente no reservable se suma a próxima carga).
- La regla se aplica en `acreditar_compra` al recargar (punto atómico, idempotente por ON CONFLICT).
- Front: `saldoVivo(sal, venc)` en `AlumnoApp` → `saldoDisplay` se pasa a todos los componentes que muestran saldo (header badge, Inicio, Perfil, Reservar)..

## A futuro (no prioritario)
- **Filas pendientes colgadas**: cada vez que un pago termina en `pending` o `failure`, `registrar_compra_pendiente` deja una fila con `estado_pago='pendiente'` que nunca se actualiza (el webhook solo toca filas de pagos `approved`). No afecta correctitud (getCompras filtra `aprobado`), pero acumula basura. Fix futuro: al volver del back_url con failure, leer `compra_id` de localStorage (devuelto por `crear-preferencia`) y llamar una RPC `marcar_compra_fallida(p_compra_id)`.
- **Google Calendar**: sincronizar reservas al Calendar del alumno y del profe. Requiere Google Cloud project con Calendar API habilitada + OAuth 2.0 credentials de Google. Iniciarlo cuando se decida.
- **WhatsApp**: notificaciones vía WA Business. Requiere cuenta Business en Meta verificada — el trámite tarda, conviene iniciarlo con tiempo.
- **Reembolsos/contracargos — HUECO DE FLUJO DE DINERO**: el webhook ignora pagos con `status != "approved"` (correcto, no acredita). PERO si un pago ya acreditado pasa luego a `refunded` o `charged_back`, MP envía notificación y el webhook vuelve a retornar 200 sin acción: el alumno conserva las horas, `compras.estado_pago` queda en `'aprobado'`. No hay descuento automático de horas ni cambio de estado. Solución pendiente: handler para notificaciones de reembolso que (a) actualice `compras.estado_pago = 'reembolsado'` y (b) descuente `alumnos.saldo`. **No implementar aún** — requiere diseño (¿qué pasa si el alumno ya usó las horas?).
- **Pago al profe — FALTA (no es bug)**: el flujo de dinero alumno→profe no está implementado. Lo existente es solo visual: campo `pagado_mes` (boolean manual) en la vista de Ingresos del profe, y una alerta de cierre mensual sin automatización. No hay cálculo server-side del monto a pagar al profe, ni transferencia real, ni liquidación automática. Pendiente diseñar: modelo de comisión, frecuencia de pago, integración con MP para transferencias o instrucciones de pago manual.

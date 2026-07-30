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
- **Webhook de pagos: unificado en Vercel ✅ (P0 cerrado 2026-07-29).** `api/mp-webhook.js` es el que procesa pagos reales — panel de MP ("Tus integraciones → Webhooks → Modo productivo") apunta a `https://puntoclases.vercel.app/api/mp-webhook`, confirmado con el simulador real de MP (firma generada por MP → 200 OK). `supabase/functions/mp-webhook` (Edge Function, Deno) queda **intacta como rollback** — no se tocó ni se desactivó, no reescribir ni borrar sin decisión explícita.
- **⚠️ Supavisor está en modo SESIÓN (puerto 5432), no en modo transacción (6543) como decía la doc vieja.** `pool_size` real: **15**. Confirmado empíricamente (2026-07-29, load test) con el error real de Supavisor: `EMAXCONNSESSION: max clients reached in session mode - max clients are limited to pool_size: 15`. Esto aplica a CUALQUIER conexión que abra `api/_db.js` (los 4 endpoints Vercel: pack/reserva/webhook/reconciliar-huerfanos) — a partir de ~15-20 invocaciones concurrentes que toquen la DB, empiezan los errores. Los reads que van directo a PostgREST (`supabase.from(...)` desde el front) NO tienen este problema — Supabase pooléa esa capa aparte y aguantó 300 concurrentes sin error en el mismo test. Ver "AUDITORÍA DE ESCALABILIDAD" para el detalle y la recomendación (pasar `DATABASE_URL` a puerto 6543).
- MP test: vendedor de prueba `3462408456`. Comprador de prueba `3462408458`. Tarjeta: `4509 9535 6623 3704`, titular **APRO APRO**, 11/30, CVV 123, DNI 12345678.
- **NO pongas secretos en este archivo (se commitea a git).**
- **DB prod**: connection string en `DATABASE_URL` (`.env.local`, ignorado por git). `MP_WEBHOOK_SECRET` también en `.env.local` (cargado 2026-07-25) y en Vercel Production. Para consultar: `psql $DATABASE_URL -c "SELECT ..."` (o vía `pg` desde Node si `psql` no está en el PATH).

## Esquema (ojo)
- La tabla `compras` **NO tiene columna `created_at`** (sí tiene `creado_en`). Leé las columnas reales antes de consultarla.
- `service_role` tiene: `SELECT` en `config` y `packs`; `EXECUTE` en `acreditar_compra`, `registrar_compra_pendiente`, `aprobar_compra`. Ningún grant directo en `alumnos`, `compras`, `reservas`, `profiles`, `mensajes`.
- `acreditar_compra`, `registrar_compra_pendiente`, `aprobar_compra` son SECURITY DEFINER (owner postgres): operan sobre `compras` y `alumnos` sin grants directos.
- `registrar_compra_pendiente(alumno_id, horas, precio, pack_id)` → inserta fila con `estado_pago='pendiente'`, devuelve `id BIGINT`.
- `aprobar_compra(compra_id, payment_id)` → idempotente: si ya está `'aprobado'` devuelve saldo sin tocar nada; si no, actualiza `compras` y `alumnos` en un solo tx.

## ESTADO ACTUAL — al 2026-07-29

✅ **P0 cerrado**: webhook unificado en Vercel, confirmado con MP real (ver "Entorno" arriba). Edge Function intacta como rollback, no tocar.

✅ `get_finanzas_periodo()` corregida y en prod (2026-07-29, migración `20260729000001`): tenía un bug real (no de criterio) — `bruto` declarado `numeric` pero `sum(reservas.monto)` daba `bigint`, la función tiraba error en TODA invocación (`structure of query does not match function result type`). Fix: cast `::numeric`. Verificado antes/después simulando sesión admin real contra prod (GUC `request.jwt.claims`, transacción con ROLLBACK).

✅ Finanzas/Dashboard conectados a `get_finanzas_periodo()` server-side (2026-07-29, `cc9a7c5`): `AppAdminMain` llama la RPC una vez, suma los períodos para el total histórico, pasa `finanzas={bruto,pagoProfe,costoCowork,neto,cargando,error}` a `Dashboard`/`Finanzas`. Cálculo viejo queda comentado (no borrado). Error de RPC se muestra prolijo en vez de romper la pantalla. **Paridad verificada solo trivialmente** (0=0, no hay reservas `'realizada'` en prod todavía) — falta confirmar con números reales no-cero.

⚠️ **Hallazgo del load test (2026-07-29)**: el techo real de conexiones para los endpoints Vercel es **~15 concurrentes**, no 60 (ver "Entorno" arriba — Supavisor en modo sesión, `pool_size:15`). Con 15 profes × 20 alumnos, cualquier pico que dispare 15-20 invocaciones simultáneas de `crear-preferencia-pack/reserva`/`mp-webhook` puede empezar a tirar errores reales a usuarios. Recomendación (no aplicada, requiere decisión): pasar `DATABASE_URL` al puerto 6543 (modo transacción) para multiplexar conexiones en vez de una dedicada por invocación.

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
- **FASE 2 ✅ (cerrada 2026-07-29)**: índices, rate limiting, Sentry, paginación admin, cache, refund async, reconciliación huérfanos, `get_finanzas_periodo` (con su fix), P0 del webhook. Pendiente de decisión (no bloqueante): `npm audit --force` (bajaría `vite-plugin-pwa`, breaking change).
- **FASE 3 ✅ (2026-07-29)**: load testing ejecutado contra Preview (`dpl_GvYD7GvbcX5f4TpVir4C7v2oWtB8`) — con la salvedad de que Vercel Deployment Protection bloquea requests directos a las URLs de Preview, y `DATABASE_URL`/`MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` no están scopeados a Preview en Vercel (solo Production). El test real se corrió contra Supabase directo (PostgREST + `pg`), que es donde vive el cuello de botella real. Hallazgo principal: **techo de ~15 conexiones concurrentes** para cualquier cosa que use `DATABASE_URL` (ver "Entorno" arriba) — mucho más bajo que el `max_connections=60` de Postgres que se asumía como límite. Reads vía PostgREST (front) escalan bien a 300 concurrentes. Reserva concurrente sobre el mismo slot: sin doble booking, funciona bien.
- **Objetivo declarado**: soportar ~15 profes × 20 alumnos (hasta 300 usuarios). **Bloqueante real hoy**: el techo de conexiones de Supavisor (15), no el `max_connections` de Postgres. Recomendación pendiente de decisión: `DATABASE_URL` a puerto 6543 (modo transacción).

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

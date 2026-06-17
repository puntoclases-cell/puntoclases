# CLAUDE.md — PuntoClases

Web de clases particulares. Continuás un proyecto **EN PRODUCCIÓN**.
Arrancá del estado de abajo; **no re-diagnostiques lo ✅**.

## Cómo trabajás conmigo (reglas fijas)
- Rioplatense, **output mínimo**. Tengo teclado complicado → **minimizá MI tecleo**: dame bloques para copiar y opciones para tildar.
- Antes de pedirme algo, **resolvelo vos con tus herramientas**: leé/editá/corré el código, `curl` para probar, Supabase CLI para datos. Pedime solo (a) un OK o (b) lo que tus herramientas no alcanzan (navegador/Dashboard).
- **CERO regresiones. Una cosa por vez. Evidencia ANTES de tocar; no asumas causas. Si errás, decilo.**
- **Writes a la base, credenciales y acciones irreversibles** (deploy a prod, borrar, permisos): mostrame el bloque, **NO ejecutes** — los corro yo. **Reads y diagnóstico: automatizalos.**

## Bitácora viva (regla fija)
- Después de CADA cambio que haga (código, deploy, migración, RPC, secrets), actualizá este archivo en la misma sesión: mover ítems a ✅, reescribir "TAREA ACTUAL" con lo que quede en curso, dejar la Cola al día. No esperes a que te lo pida.
- Si el cambio lo hizo alguien por fuera del código (David o Manuel en un dashboard de MP/Supabase) y me lo informan, registralo igual con fecha.
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
- MP test: vendedor de prueba `3462408456` (= el `MP_ACCESS_TOKEN`). Comprador de prueba `3462408458`. Tarjeta de prueba: `4509 9535 6623 3704`, titular **APRO APRO** (fuerza aprobado), 11/30, CVV 123, DNI 12345678. *(Las contraseñas de los test users están en el panel de MP, no acá.)*
- **NO pongas secretos en este archivo (se commitea a git).**
- **DB prod**: connection string en `DATABASE_URL` (archivo `.env.local`, ignorado por git). Para consultar: `psql $DATABASE_URL -c "SELECT ..."`.

## Esquema (ojo)
- La tabla `compras` **NO tiene columna `created_at`** (sí tiene `creado_en`). Leé las columnas reales antes de consultarla.
- `service_role` tiene: `SELECT` en `config` y `packs`; `EXECUTE` en `acreditar_compra`. Es todo lo necesario para el flujo actual.
- `acreditar_compra` es SECURITY DEFINER (owner postgres): inserta en `compras` y actualiza `alumnos` sin necesitar grants directos en esas tablas.

## TAREA ACTUAL — Estado al 2026-06-17

### ✅ Completado y verificado en prod
- Pagos end-to-end en TEST (webhook acredita, saldo sube, fila en compras OK)
- `crear_reserva`: valida fecha pasada + vencimiento de horas (live en DB)
- `acreditar_compra`: renueva vencimiento al comprar (live en DB)
- `profiles_self_update` eliminada → privilege escalation cerrada (verificado en DB)
- `mensajes` en `supabase_realtime` publication (chat en tiempo real activo)
- `mp-webhook` v7 deployado con validación HMAC-SHA256 (activación automática al cargar el secret)
- Fechas pasadas bloqueadas en UI y en servidor
- Chat: actualización optimista + dedup para sender y receiver
- alert() reemplazados por estados inline (errorPago, compraPendiente, errCancelar, errGuardado, adminMsg)
- Logs sensibles eliminados
- Profe nuevo: recibe email automático para establecer contraseña (sin contraseña temporal visible)

### ⏳ Pendiente — Task D (solo acciones en dashboards, sin código)
1. **MP Dashboard** → Tu app → Webhooks → copiá el "Secret" → guardalo.
2. **Supabase Dashboard** → Edge Functions → `mp-webhook` → Secrets → `MP_WEBHOOK_SECRET=<secret de MP>`.
3. **Supabase Dashboard** → Edge Functions → `crear-preferencia` → Secrets → `MP_ACCESS_TOKEN=<token producción MP>`.
4. MP Dashboard → crear credenciales de **producción real** (no test) → el token va en el paso 3.
5. (Opcional) Supabase → Settings → API → regenerar anon key si fue expuesta → actualizar `VITE_SUPABASE_ANON_KEY` en Vercel.

Después de cargar `MP_WEBHOOK_SECRET`, la validación de firma se activa sola (sin deploy).

## Cola (features para después de Task D)
- Google Calendar: sincronizar reservas al Calendar del alumno y del profe (requiere OAuth de Google).
- WhatsApp: notificaciones por WA Business (requiere verificación de cuenta Business de Meta).

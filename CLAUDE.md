# CLAUDE.md — PuntoClases

Web de clases particulares. Continuás un proyecto **EN PRODUCCIÓN**.
Arrancá del estado de abajo; **no re-diagnostiques lo ✅**.

## Cómo trabajás conmigo (reglas fijas)
- Rioplatense, **output mínimo**. Tengo teclado complicado → **minimizá MI tecleo**: dame bloques para copiar y opciones para tildar.
- Antes de pedirme algo, **resolvelo vos con tus herramientas**: leé/editá/corré el código, `curl` para probar, Supabase CLI para datos. Pedime solo (a) un OK o (b) lo que tus herramientas no alcanzan (navegador/Dashboard).
- **CERO regresiones. Una cosa por vez. Evidencia ANTES de tocar; no asumas causas. Si errás, decilo.**
- **Writes a la base, credenciales y acciones irreversibles** (deploy a prod, borrar, permisos): mostrame el bloque, **NO ejecutes** — los corro yo. **Reads y diagnóstico: automatizalos.**

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

## TAREA ACTUAL
✅ **Pagos end-to-end funcionando en TEST.** Webhook acredita, saldo sube, fila en compras OK.

**Pendiente antes de ir a PRODUCCIÓN REAL (Task D):**
El código de validación de firma HMAC ya está en `mp-webhook/index.ts` (bloque `if (webhookSecret)`). Solo falta que vos hagas estas 3 acciones manuales en los dashboards:

1. **MP Dashboard** → Tu app → Webhooks → copiá el "Secret" del webhook → guardalo.
2. **Supabase Dashboard** → Edge Functions → `mp-webhook` → Secrets → `MP_WEBHOOK_SECRET=<el secret de MP>`.
3. **Rotar MP_ACCESS_TOKEN**: en MP crear credenciales de producción reales (no las de test) y cargarlas en Supabase Secrets como `MP_ACCESS_TOKEN`.
4. **Rotar Supabase anon key** si fue expuesta: Dashboard → Settings → API → regenerar.

Después de cargar `MP_WEBHOOK_SECRET`, la validación de firma se activa sola (sin deploy).

## Cola
- Nada urgente. Ver tareas de producto/UX abajo si querés agregar features.

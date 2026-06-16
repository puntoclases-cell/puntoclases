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
- La tabla `compras` **NO tiene columna `created_at`**. Leé las columnas reales antes de consultarla.
- `service_role` hoy solo tiene `SELECT` en `config` y `packs` (se lo agregamos). Si algo server-side falla con permisos, revisá grants.

## TAREA ACTUAL (transitorio — actualizá o borrá cuando cierre)
**Arreglar pagos.**
- ✅ "Pagar con MP" no redirigía → faltaba `GRANT SELECT ON config,packs TO service_role` (Postgres 42501). Aplicado → redirige.
- ✅ Pago aprueba end-to-end con comprador de prueba + tarjeta de prueba.
- 🔴 **EN CURSO: el webhook NO acredita** (saldo sigue 0). Evidencia (Invocations de `mp-webhook`): la notif de pago en formato **NUEVO** (`?type=payment&data.id=<pid>`) da **500**; el formato viejo (`?id&topic`) da 200 pero tampoco acredita. El código no maneja bien la notif nueva (`data.id`). **NO es grants** (`acreditar_compra` es SECURITY DEFINER dueño postgres + `service_role` tiene EXECUTE; el webhook solo llama ese RPC).
  - **FIX:** leé `supabase/functions/mp-webhook/index.ts`; manejá la notif nueva (sacar paymentId de `data.id` → `GET /v1/payments/{id}` con `MP_ACCESS_TOKEN` → `acreditar_compra`) **sin romper lo que hoy da 200**. Mostrame el **diff** (único gate). Con mi OK: deploy por CLI + re-invocá el pago ya aprobado `163363540521` con curl y verificá 200 + acreditación (idempotente por `payment_id`).

## Cola (post-fix, en orden)
- **A)** Verificar acreditación real: ↑ saldo del alumno + fila en `compras` + desaparece la promo "1ra compra 2hs 50% OFF" (si sigue tras una compra real → **ES bug**; mirar lógica de la promo).
- **B)** Front: en "Horas sueltas", elegir 1/2/3 hs deja "Pagar con MP" gris (`disabled={!seleccion}`); esa pestaña no setea `seleccion`. Arreglar en `PuntoClasesApp.jsx`.
- **C)** Revertir la línea de diagnóstico en `crear-preferencia` (hoy filtra `cfgErr`/`serviceKeyPresent` → dejar error limpio).
- **D)** Producción: cargar `MP_WEBHOOK_SECRET` + validar firma; rotar el `MP_ACCESS_TOKEN` comprometido y el token de Supabase de prueba.
- **E)** Auditar otros GRANT faltantes de `service_role` (hoy solo `SELECT` en `config`/`packs`).

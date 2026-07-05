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
- Edge Functions: `crear-preferencia` (verify_jwt=true), `mp-webhook` (verify_jwt=false, público).
- MP test: vendedor de prueba `3462408456`. Comprador de prueba `3462408458`. Tarjeta: `4509 9535 6623 3704`, titular **APRO APRO**, 11/30, CVV 123, DNI 12345678.
- **NO pongas secretos en este archivo (se commitea a git).**
- **DB prod**: connection string en `DATABASE_URL` (`.env.local`, ignorado por git). Para consultar: `psql $DATABASE_URL -c "SELECT ..."`.

## Esquema (ojo)
- La tabla `compras` **NO tiene columna `created_at`** (sí tiene `creado_en`). Leé las columnas reales antes de consultarla.
- `service_role` tiene: `SELECT` en `config` y `packs`; `EXECUTE` en `acreditar_compra`, `registrar_compra_pendiente`, `aprobar_compra`. Ningún grant directo en `alumnos`, `compras`, `reservas`, `profiles`, `mensajes`.
- `acreditar_compra`, `registrar_compra_pendiente`, `aprobar_compra` son SECURITY DEFINER (owner postgres): operan sobre `compras` y `alumnos` sin grants directos.
- `registrar_compra_pendiente(alumno_id, horas, precio, pack_id)` → inserta fila con `estado_pago='pendiente'`, devuelve `id BIGINT`.
- `aprobar_compra(compra_id, payment_id)` → idempotente: si ya está `'aprobado'` devuelve saldo sin tocar nada; si no, actualiza `compras` y `alumnos` en un solo tx.

## ESTADO ACTUAL — al 2026-07-05

✅ Pagos prod — fix definitivo (2026-07-02): causa raíz real era que MP Checkout Pro **no propaga `metadata` de la preferencia al payment**. El webhook leía `payment.metadata` → vacío → devolvía 200 silencioso → nunca acreditaba. Fix: patrón "compra pendiente en DB" (Opción B): `crear-preferencia` llama a `registrar_compra_pendiente` antes de ir a MP y usa el id numérico de DB como `external_reference`; `mp-webhook` usa `external_reference` para llamar a `aprobar_compra` (idempotente). 500 en lugar de 200 silencioso cuando algo falla (MP reintenta).

✅ Regresiones cerradas: `getCompras` filtra `estado_pago='aprobado'` (filas pendientes no aparecen en UI ni afectan `esNuevoAlumno`). `crearCompra` eliminada (tenía columna incorrecta `precio` en lugar de `monto`).

✅ `MP_WEBHOOK_SECRET` rotado (2026-06-24): valor anterior pasó por chat; nuevo valor cargado en Supabase.

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
- **F1 ✅ 2026-07-04**: design system accesible + fixes front (tokens CSS, flash login, ← volver, progreso real, a11y, recurrente oculto, precio desde DB). Commits `13c0307`..`439bb62`. En prod.
- **F1.1 ✅ 2026-07-04**: hotfix 5 textos <16px (header badge ⏱, card saldo Inicio). Commit `470f2f9`.
- **F3 ✅ 2026-07-04**: wizard reserva 8 pasos — fix slotsCons (DB es horaria, no 30 min), tipo/modalidad en pasos separados, lenguaje humano en tipo, "Elegir otro día" en P6 sin horarios. Commit `42dffcb`. En prod.
  - **F3.1 ✅ 2026-07-04**: mini-calendario híbrido en P5 · días con nombre completo ("Miércoles 8 de julio") · singular/plural hora/horas. Commit `01bcb6d`.
- **F4 ✅ 2026-07-04**: agenda del alumno — `Historial` reescrito: card destacada próxima clase, mini-calendario híbrido (días con clase marcados, filtro por día), lista de cards grandes (≥16px, ≥48px targets), fechas en palabra completa (`fmtLarga`), botones Reprogramar/Cancelar separados, `fmtLarga` promovida a global. Commit `9f44049`. En prod.
- **F5 ✅ 2026-07-05**: grupal real — tabla `grupos`, advisory lock por slot, cupo en vivo (sin columna desnormalizada), `unirse_grupo` RPC (join-or-create atómico), `get_grupo_info` RPC. Migración `20260704000001_f5_grupal_real.sql` aplicada a prod. Commits `af489ab`..`6eb8d0d`. En prod.
  - **RADAR F6**: cancelar grupo → devolver saldo a todos los inscriptos · reconciliar tipo 'ambas' de disponibilidad con F6.
  - **LÍMITE CONOCIDO (no bloqueante)**: `unirse_grupo` NO valida solapamiento entre dos grupos del mismo profe a horas distintas (ej: grupo A 10:00-12:00 y grupo B 11:00-12:00 coexistirían). El chequeo individual-vs-grupal SÍ usa rango completo. Resolver en F6 si se necesita.
- **F6**: modelo tren + saldo simple — pago por clase (reserva pendiente_pago + MP + TTL); absorbe F2 (packs solo individual, sacar factor 0.8 del saldo).
- **F7** (opcional): carrito progresivo "Agregar otra clase".

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

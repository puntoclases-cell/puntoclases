# Overnight 2026-08-10 — sesión sin supervisión en vivo

Reglas seguidas en toda la sesión: evidencia antes de tocar, cero regresiones,
`ROLLBACK` test en transacción antes de aplicar cualquier cosa a la base
(aplicado y verificado post-apply contra prod real después). Todo lo de acá
es aditivo — nada le sacó acceso a un flujo legítimo existente.

---

## FASE B — Reprogramar del alumno vía RPC ✅ deploy directo a `main`

**Commits**: DB aplicada directo (`20260810000005_reprogramar_reserva_alumno.sql`) + `aa12fb2` (frontend).

**Problema confirmado** (ya estaba en la auditoría 2026-08-10): `Historial → ModalReprogramar`
hacía `UPDATE reservas` directo desde el cliente. Nunca existió policy RLS que
le diera `UPDATE` a un alumno sobre sus propias reservas (solo admin/profe) —
el `UPDATE` fallaba silencioso, el `catch(err=>console.error(...))` se tragaba
el error, y la UI mostraba "¡Clase reprogramada!" por estado local optimista
sin que la DB cambiara nada.

**Fix**: RPC `reprogramar_reserva_alumno(p_reserva_id, p_fecha, p_hora)`,
`SECURITY DEFINER`, mismo patrón que `confirmar_reserva_pago`. Valida:
- La reserva es de `auth.uid()`.
- Estado actual permite reprogramar (`pendiente`/`confirmada`; no `realizada`/`cancelada`/`expirada`/etc).
- Regla de 24hs (igual criterio que `devolver_horas`, ya lo anunciaba el front — ahora también server-side).
- Advisory lock del slot nuevo (mismo `hashtext(profe_id|fecha|hora)` que usan `crear_reserva_pendiente_pago`/`unirse_grupo`).
- Disponibilidad real del profe en el nuevo slot (`disponibilidad`, no confía en lo que ya filtró el front).
- Solapamiento con otras reservas activas del profe ahí.
- `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` explícito (lección de la sesión de seguridad: nunca depender del PUBLIC implícito de Postgres).

**Decisión de alcance, no ambigua**: la RPC solo reprograma `tipo='individual'`.
Reprogramar grupales tocaría `grupo_id`/cupo/reagrupación — lógica no
especificada, y el propio `CLAUDE.md` ya lo marca como límite conocido
("VERIFICAR pendiente: reprogramar una grupal pagada de extremo a extremo").
La RPC rechaza grupales con mensaje claro; el frontend dejó de ofrecer el
botón "Reprogramar" para `tipo==="grupal"` (antes se mostraba igual y fallaba
mudo). No se intentó adivinar la lógica de reagrupación.

**Frontend**: `db.js` — nueva `reprogramarReservaAlumno()` (llama la RPC). La
`reprogramarReserva()` existente (usada por `ModalReprogramarProfe`, el profe
reprogramando sus propias reservas) **no se tocó** — sigue funcionando por la
policy `reservas_profe_update` ya arreglada en la sesión de seguridad, es un
camino distinto y válido. `ModalReprogramar` (alumno): saca el catch mudo,
muestra el error real (`errReprogramar`), filtra el calendario/horarios para
solo ofrecer bloques `tipo IN ('individual','ambas')` (evita mostrar opciones
que la RPC va a rechazar igual — la RPC revalida esto de nuevo server-side,
esto es solo UX).

### Rollback test (antes de aplicar, contra prod, `ROLLBACK` al final)

| Caso | Resultado |
|---|---|
| Grants: `anon`/`PUBLIC` no pueden ejecutar la RPC | ✅ confirmado (`has_function_privilege` → `false`/`false`, `authenticated` → `true`) |
| Reprogramar propia, a slot con disponibilidad real y libre | ✅ funciona, devuelve la fila actualizada |
| Alumno ajeno intenta reprogramarla | 🔒 `No autorizado.` |
| Slot ocupado por otra reserva confirmada del mismo profe | 🔒 `Ya hay una reserva en ese horario.` |
| Slot sin disponibilidad real del profe (no está en `disponibilidad`) | 🔒 `El profe no tiene ese horario disponible.` |
| Reprogramar una reserva `tipo='grupal'` | 🔒 `Reprogramar clases grupales todavía no está soportado.` |
| Reprogramar una reserva que es en menos de 24hs | 🔒 `No podés reprogramar con menos de 24hs de anticipación.` |
| Reprogramar a una fecha pasada | 🔒 `No podés reprogramar a una fecha pasada.` |

Todo dentro de una única transacción con `ROLLBACK` — nada quedó aplicado en
ese test. Migración aplicada aparte, después, y verificada con `npm run build`
local antes de pushear a `main`.

**Pendiente / fuera de este alcance**: reprogramar grupales de punta a punta
(ya señalado en CLAUDE.md como límite conocido, requiere definir qué pasa con
el `grupo_id`/cupo del grupo viejo y el nuevo).

---

## FASE D — `profiles.mail`/`creado_en` auto-editables ✅ deploy directo

**Commit**: `51352e4` (migración `20260810000006_lock_profiles_mail_creado_en.sql`, aplicada).

**Fix**: mismo patrón que `alumnos_self_update` de la sesión de seguridad —
función `mis_campos_protegidos_perfil()` (`SECURITY DEFINER`, sin parámetro,
hardcodea `auth.uid()` adentro) + `WITH CHECK` en `profiles_update` que exige
`mail`/`creado_en` sin cambios salvo que quien escribe sea `mi_rol()='admin'`.
`rol` seguía bloqueado como ya estaba (sin cambios ahí).

**Sin cambios de frontend**: grep confirmó que ningún call site de
`actualizarPerfil()` pasa `mail` ni `creado_en` hoy — la UI nunca los edita,
solo cierra un hueco de API directa.

### Rollback test

| Caso | Resultado |
|---|---|
| Alumno cambia su propio `mail` | 🔒 rechazado por RLS |
| Alumno cambia su propio `creado_en` | 🔒 rechazado por RLS |
| Alumno cambia su `nombre` | ✅ sigue andando |
| Alumno cambia su `avatar_url` | ✅ sigue andando |
| Profe cambia su propio `mail`/`creado_en` | 🔒 rechazado por RLS (ambos) |
| Admin edita su propio `profiles` (`nombre`, no-op) | ✅ sigue andando |
| Admin toca su propio `mail` (escape hatch `mi_rol()='admin'`) | ✅ sigue andando |
| Alumno intenta editar el `profiles` de otro usuario | 0 filas (ya bloqueado antes por `auth.uid()=id` en `USING`, confirmado que sigue) |

---

## FASE E — Editor de packs en Finanzas ✅ deploy directo

**Commit**: `5030f0c` (migración `20260810000007_grant_packs_update_admin.sql`, aplicada).

**Causa raíz confirmada antes de tocar nada**: `normCfg()` (línea ~4286) tenía
el comentario "packs vienen de tabla separada (getPacks)" pero después
asignaba `packs: CONFIG_INIT.packs` — el fallback hardcodeado, nunca los
reales. Y `AppAdminMain` nunca llamaba `getPacks()` en absoluto (solo
`AppAlumno` lo hacía, para `Comprar()`). Sumado a que `authenticated` no
tenía ningún `GRANT` de escritura sobre `packs` — ni siquiera para admin — el
botón "Guardar cambios" de esa sección literalmente no tenía ningún camino
posible hacia la DB.

**Fix**:
- `GRANT UPDATE (descuento) ON packs TO authenticated` — columna mínima
  (mismo criterio que `reservas`/`alumnos`), protegido por `packs_admin`
  (ya existía, `mi_rol()='admin'` en `USING` y `WITH CHECK`, sin cambios).
- `db.js`: nueva `actualizarPack(packId, cambios)` — invalida el cache de
  `getPacks()` al guardar, para que `Comprar()` del alumno vea el precio
  nuevo sin esperar el TTL de 5min.
- `AppAdminMain`: ahora carga packs reales con `getPacks({skipCache:true})`
  en vez de depender del fallback.
- `Finanzas.guardar()`: además de `updateConfig`, persiste el `descuento` de
  cada pack en paralelo (`Promise.allSettled`), avisa si alguno falla sin
  romper el resto.

### Rollback test

| Caso | Resultado |
|---|---|
| Admin cambia `descuento` de un pack | ✅ persiste (confirmado leyendo la tabla real después) |
| Admin intenta cambiar otra columna (`activo`) | 🔒 `permission denied` — no está en el `GRANT` |
| Alumno intenta cambiar `descuento` | 🔒 0 filas (bloqueado por `packs_admin`) |

---

## FASE C — Carrito de reservas múltiples ✅ verificada y mergeada a `main` (2026-08-11)

**Historia**: armada en `feature/carrito` la noche del 2026-08-10 (commit
`c410a0f`), sin tocar prod. Verificada al día siguiente contra prod real con
una cuenta de alumno de prueba dedicada (checklist de 10 puntos, ver más
abajo) — mergeada a `main` (`d691bee`) y desplegada recién los 10 puntos
cerraron con evidencia. La rama `feature/carrito` ya fue borrada (local y
remota), está todo en `main`.

---

### ✅ VERIFICACIÓN DE CIERRE (2026-08-11)

**Metodología**: cuenta de alumno de prueba dedicada
(`carritotest_<timestamp>@puntoclases.test`), creada vía `supabase.auth.signUp`
real (mismo trigger `handle_new_user` que un alta real), con sesión real
(JWT real, no simulado con `SET LOCAL role`) para las llamadas RPC que en
producción corren vía PostgREST. **Operaciones REALES committeadas, no
`ROLLBACK`** — se necesitaba inspeccionar el estado persistido en cada paso.
Al final, TODO lo generado por la cuenta (reservas, compras, pagos_huerfanos,
grupos vacíos, la fila de alumnos/profiles/auth.users) se borró y se
verificó en `0` filas.

**Limitación de entorno, no de código — documentada, no ocultada**: no se
pudo hacer el checkout real de Mercado Pago por navegador ni pegarle al
webhook HTTP realmente desplegado, por dos motivos independientes y
anteriores a esta sesión:
1. `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` en Vercel son variables **solo de
   `Production`** (confirmado con `vercel env ls production`) — no existen en
   `Preview`. `MP_ACCESS_TOKEN` además está marcada `--sensitive`: ni
   `vercel env pull` la trae (se confirmó bajándola — el valor vino vacío,
   `""`, a propósito, es write-only).
2. Los deployments de `Preview` (donde SÍ vivía el código de Fase C antes de
   mergear) están detrás de **Vercel Deployment Protection** — cualquier
   request directo devuelve `401 Protected deployment` y pide login SSO de
   Vercel. Mismo límite que ya había encontrado la Fase 3 de escalabilidad
   contra estos mismos Preview.

Ninguna de las dos cosas es un bug de Fase C — es infraestructura de Vercel
ya configurada así antes de esta sesión. Se sustituyó con la evidencia más
rigurosa posible sin esas credenciales: réplica exacta, línea por línea, de
la lógica real (la misma que corre `api/crear-preferencia-reserva.js` y
`api/mp-webhook.js`) contra la base real, con datos reales committeados.

#### Resultado de los 10 puntos

| # | Punto | Resultado |
|---|---|---|
| 1 | `reprogramar_reserva_alumno` y `devolver_horas` sobre una reserva con `carrito_id` | ✅ se comportan idéntico a una reserva sin `carrito_id` — reprogramada, `carrito_id` intacto; cancelada, saldo devuelto |
| 2 | Pago mixto real (1 individual+saldo, 1 grupal+MP) | ✅ a nivel DB/RPC real: saldo descontado UNA vez (3.0→2.0), grupal quedó `confirmada` con `cupo_max=4`/`inscriptos=1` reales, `external_reference` con formato `cart_<uuid>` confirmado por código. Checkout MP por navegador: no posible (ver limitación arriba) |
| 3 | Carrito 100% saldo (monto MP = 0) | ✅ confirmado — cuando todo se cubre con saldo, el código (`if (paraMp.length === 0) return` antes de llamar `crearPreferenciaCarrito`) nunca llega a pedirle nada a MP; 0 filas `pendiente_pago` generadas |
| 4 | TTL vence a mitad de carrito | ✅ el ítem vencido devuelve `ttl_expirado` sin afectar al resto del carrito, que confirma normal; el slot vencido queda re-reservable (lazy expiry, mismo mecanismo pre-existente que ya usa RAMA A de una sola clase) |
| 5 | Tope de 10 ítems | ✅ por code review — el guard `carritoItems.length > MAX_ITEMS_CARRITO` corre ANTES de cualquier llamada a RPC/DB, un 11° ítem no crea ninguna fila. HTTP real bloqueado por Deployment Protection (ver limitación arriba) |
| 6 | Quitar un ítem antes de pagar | ✅ "Agregar otra clase" nunca llama al backend (solo hace `setCarrito` local) — un ítem quitado antes de "Pagar todo" nunca llegó a existir en la DB, no hace falta liberar nada |
| 7 | Huérfano parcial simulado (grupal pierde cupo mientras el individual del mismo carrito sí se paga) | ✅ individual `confirmada`, grupal `cupo_excedido` → `cancelada` automáticamente por la propia `confirmar_reserva_pago`; `pagos_huerfanos` recibe la clave sintética `<payment_id>_cart_r<reserva_id>`; reintento del mismo INSERT (idempotencia de MP) no duplica; saldo sin tocar en ningún momento |
| 8 | Regresión: flujo de 1 sola clase | ✅ `crear_reserva_pendiente_pago` sin `p_carrito_id` sigue igual, `carrito_id` queda `NULL`, `confirmar_reserva_pago` (RAMA A) sin tocar |
| 9 | Regresión: compra de packs | ✅ `registrar_compra_pendiente`/`aprobar_compra` vía `pg` (como corre el endpoint real) sin cambios, saldo +2hs correcto. De paso: confirmó que siguen bloqueadas para `authenticated` vía PostgREST (fix de la sesión de seguridad anterior sigue en pie) |
| 10 | Build + revisión UI | ✅ `npm run build` limpio. Se agregó una card "Cómo se paga cada clase" (desglose saldo vs. MP) visible ANTES de tocar "Pagar todo" — antes solo se sabía después de pagar. Botón "Quitar" agrandado (antes texto suelto, ahora con fondo/borde/`aria-label`, `min-height:32px`) |

Todos los datos de prueba (14 reservas, 1 compra, 1 fila en `pagos_huerfanos`,
2 grupos, la cuenta completa) se borraron al final — verificado con `SELECT
count(*)` en `0` para cada tabla.

### Cómo levantar la rama y probarla local

```bash
git fetch origin
git checkout feature/carrito
npm install   # por si acaso, no debería hacer falta
npm run build # ya se corrió acá, pasa limpio
```

Para probar de punta a punta hace falta, en ese orden:
1. Aplicar `supabase/migrations/20260810000008_carrito_reservas.sql` — **idealmente
   contra un proyecto/branch de Supabase de prueba, no contra prod directo**,
   hasta que decidas que está listo. Si querés probarlo contra prod porque no
   hay otro ambiente, es aditivo (`ADD COLUMN`, `CREATE INDEX`, `DROP
   FUNCTION`+`CREATE OR REPLACE` de una función que solo llama el propio
   flujo de reserva) — no borra nada existente, pero preferiría que lo
   aplicaras vos con los ojos puestos encima la primera vez.
2. Correr `npm run dev` local (o deployar la rama a un Preview de Vercel —
   Vercel arma un Preview automático por cada push a una rama que no es
   `main`, deberías tener uno esperando en el dashboard).
3. Loguearte como alumno, ir a Reservar, armar una clase, tocar "➕ Agregar
   otra clase" en el paso 8, armar una segunda (probá mezclando individual +
   grupal para ver el pago mixto), y "Pagar todo".
4. Si hay saldo suficiente para alguna individual, confirmá en Historial que
   quedó reservada sin pasar por MP. El resto debería mandarte a MP con
   **una sola preferencia** que lista todas las clases restantes como ítems
   separados — pagá con la tarjeta de test (ver credenciales en "Entorno" de
   este mismo archivo) y confirmá que las clases quedan `confirmada` al
   volver.

### Qué quedó armado

- **DB**: `ADD COLUMN reservas.carrito_id uuid NULL` + índice parcial.
  `crear_reserva_pendiente_pago` extendida con `p_carrito_id uuid DEFAULT
  NULL` — **requirió un `DROP FUNCTION` explícito de la firma vieja antes del
  `CREATE OR REPLACE`**: agregar un parámetro nuevo no reemplaza la función,
  Postgres la trata como una sobrecarga distinta y la llamada vieja (sin el
  parámetro nuevo) queda ambigua entre las dos. Esto rompía la compatibilidad
  hacia atrás — lo encontré con el propio `ROLLBACK` test, no lo asumí,
  y quedó corregido y confirmado antes de seguir.
- **Backend**: `api/crear-preferencia-reserva.js` acepta `reservaParams`
  (objeto, camino viejo, sin ningún cambio de comportamiento) o
  `carritoItems` (array, camino nuevo) — arma una preferencia de MP con un
  ítem por clase y `external_reference=cart_<uuid>`. Si una clase del medio
  del carrito falla al crearse (ej. el profe se quedó sin ese slot justo
  antes), las anteriores quedan como `pendiente_pago` reales (con su TTL de
  30min, se limpian solas) — no hay rollback conjunto de "todo o nada" en
  este primer pase.
- **Webhook**: `api/mp-webhook.js` suma una RAMA A0 (antes de la RAMA A
  existente) para `external_reference` que empieza con `cart_` — busca todas
  las reservas `pendiente_pago` de ese `carrito_id` y llama
  `confirmar_reserva_pago` en loop para cada una, **sin tocar esa función**.
- **Frontend**: `carrito` (array) + `errorCarrito` en el estado de `Reservar`.
  En el paso 8: card con el resumen del carrito (con "Quitar" por ítem),
  botón "➕ Agregar otra clase", y el bloque de pago cambia de los 2 botones
  de siempre (carrito vacío, **sin ningún cambio de comportamiento**) a un
  solo botón "Pagar todo" (carrito con algo) que reparte individuales/saldo
  vs. grupales+resto/MP como se pidió. Polling de retorno de MP para carritos
  en `AppAlumno` (`carritoPagoEstado`), calcado del que ya existía para una
  sola clase.

### Rollback test (DB/RPC, contra prod real, todo revertido)

| Caso | Resultado |
|---|---|
| Llamada vieja a `crear_reserva_pendiente_pago` (sin `p_carrito_id`) | ✅ sigue funcionando, `carrito_id` queda `NULL` — **después de corregir el bug del `CREATE OR REPLACE`** (antes de corregirlo, esta misma prueba daba `function ... is not unique`) |
| Dos ítems con el mismo `p_carrito_id` | ✅ ambos se crean, `pendiente_pago`, mismo `carrito_id` en la tabla real |
| `confirmar_reserva_pago` en loop sobre esas 2 filas (lo que hará el webhook) | ✅ ambas quedan `confirmada` con el mismo `payment_id` |

**No probado** (no es posible desde acá, sin browser ni sandbox de MP en
vivo): el checkout real de Mercado Pago con una preferencia multi-ítem, el
webhook recibiendo una notificación real de un pago de carrito, y el click-
through completo del wizard en un navegador. Eso queda para tu prueba local.

### Decisiones de negocio sin resolver — anotadas, no adivinadas

1. **Reembolso/huérfanos parciales de un carrito**: si el pago del carrito se
   aprueba pero UNA de las clases queda huérfana (cupo se llenó o TTL venció
   mientras se pagaba), el pago fue por el carrito ENTERO con un solo
   `payment_id` y un solo monto — no está definido si corresponde reembolsar
   solo la parte de esa clase (¿cómo se prorratea el monto?), el total, o
   reprogramar esa clase sin costo. Por ahora el webhook **no** dispara el
   refund automático que sí existe para una reserva suelta — solo deja
   registro en `pagos_huerfanos` (con una clave sintética
   `payment_id_cart_r<reserva_id>`, porque la columna `payment_id` es
   `UNIQUE` y un mismo pago puede generar más de un huérfano) para revisión
   manual.
2. **Reintento tras un fallo parcial**: si algunas clases ya se pagaron con
   saldo y la creación de la preferencia de MP para el resto falla, el
   frontend no intenta un retry prolijo (evalué la lógica y el riesgo de
   re-cobrar saldo dos veces en un retry automático es real) — le pide al
   alumno que recargue la página antes de reintentar. Es una simplificación
   deliberada, no un bug no visto; si te importa una UX más fina acá, es un
   punto concreto para pulir antes de mergear.
3. **`crearPreferenciaReserva` (una sola clase) no adopta `carrito_id`
   todavía** — sigue exactamente como estaba, sin pasar `p_carrito_id`
   (queda `NULL`). Dejé la función lista para que lo haga (un solo ítem, un
   `carrito_id` de uno), lo que unificaría el webhook a un solo camino de
   confirmación en vez de dos (RAMA A y RAMA A0 separadas) — no lo hice
   porque tocaría el flujo que ya está probado y andando en `main`, y vos
   pediste explícitamente no reescribirlo. Si después de revisar esto te
   convence unificar, es un cambio chico y bien acotado.
4. **Reprogramar/cancelar una clase que vino de un carrito**: no se revisó
   si `reprogramar_reserva_alumno` (Fase B) o `devolver_horas` tratan
   distinto una reserva con `carrito_id` no nulo — en principio no debería
   importarles (no lo leen), pero no se probó explícitamente ese cruce.
5. **Límite de items por carrito**: puse un tope defensivo de 10 clases por
   carrito en el backend (no pedido explícitamente, para que un error de
   front no mande un carrito gigante a MP) — cambialo si te parece mal.

---

## FASE F — Limpieza de compras pendientes colgadas ✅ deploy directo (opcional, hecha igual)

**Commit**: `788c9e9` (migración `20260810000009_marcar_compra_fallida.sql`, aplicada).

Ya documentado en CLAUDE.md ("A futuro"): cada pago que terminaba en
`pending`/`failure` dejaba una fila en `compras` con `estado_pago='pendiente'`
que nunca se actualizaba — no rompía nada (`getCompras` filtra `'aprobado'`),
pero acumulaba basura.

**Fix**: RPC `marcar_compra_fallida(p_compra_id)`, `SECURITY DEFINER` — valida
dueño, solo transiciona `pendiente → fallido` (nunca pisa un `aprobado` real,
por si el webhook ganó la carrera con el redirect del alumno). `crearPreferencia()`
ahora guarda `compra_id` en `pc_compra_pendiente` (localStorage) antes de
redirigir a MP — antes solo guardaba `horas`/`precio`. Al volver con `failure`
real (no con `pending` — todavía puede aprobarse después) se llama la RPC.
Solo higiene, no cambia comportamiento de negocio ni toca saldo.

### Rollback test

| Caso | Resultado |
|---|---|
| Dueño marca su compra `pendiente` como fallida | ✅ pasa a `fallido` |
| Otro alumno intenta marcar una compra ajena | 🔒 `No autorizado.` |
| Intentar marcar una ya `aprobado` como fallida | ✅ no la toca, sigue `aprobado` |
| `compra_id` inexistente | ✅ no tira error (idempotente) |
| `anon`/`PUBLIC` no pueden ejecutar la RPC | ✅ confirmado |

---

## FASE OPCIONAL (2026-08-11, post-cierre de Fase C)

### Cron de limpieza de compras colgadas ✅ en prod

`api/admin/limpiar-compras-colgadas.js` + `vercel.json` → `crons` (`17ab9a2`).
Diario 6am UTC, protegido con `CRON_SECRET` (Vercel lo manda automático como
`Authorization: Bearer $CRON_SECRET` en la invocación real del cron).

**Probado en vivo contra prod** (no simulado):

| Caso | Resultado |
|---|---|
| Sin `Authorization` | 🔒 401 |
| Con secreto incorrecto | 🔒 401 |
| Con `CRON_SECRET` real (primera corrida) | ✅ `{"candidatas":1,"marcadas":1,"errores":0,"ids_marcadas":["5"]}` — la única compra `pendiente` real que había en prod (id=5, del 23-jul, resto de un smoketest viejo) pasó a `fallido` |
| Estado real después | ✅ las 2 `aprobado` (id 1, 3) y la 1 `fallido` que ya existía (id 4) quedaron sin tocar |
| Segunda corrida (idempotencia) | ✅ `{"candidatas":0,"marcadas":0,"errores":0,"ids_marcadas":[]}` |
| Cron registrado | ✅ `vercel crons ls` → `/api/admin/limpiar-compras-colgadas` cada `0 6 * * *` |

### Overlap de grupos del mismo profe 🔍 diagnosticado, sin arreglar (pendiente OK)

Confirmado con el código real (`pg_get_functiondef`) de `unirse_grupo` y la
rama grupal de `crear_reserva_pendiente_pago`: ambas chequean solapamiento
contra reservas `individual` del profe, pero **nunca entre dos `grupos`
distintos** del mismo profe en horarios que se pisan — el matching de grupo
es por `(profe_id, fecha, hora)` exacto, así que un grupo a las 10:00 (2hs) y
otro a las 11:00 (1hs) del mismo profe son grupos completamente separados,
sin ningún chequeo cruzado entre ellos. Ya estaba anotado como límite
conocido en la sección REDISEÑO de `CLAUDE.md`, ahora con la causa exacta
confirmada en código.

**Fix propuesto (no aplicado)** — mismo patrón que ya usan ambas funciones
para individual-vs-individual, agregado antes del find-or-create del grupo:

```sql
IF EXISTS (
  SELECT 1 FROM reservas r
  WHERE r.profe_id = p_profe_id
    AND r.fecha    = p_fecha
    AND r.tipo     = 'grupal'
    AND r.hora     <> p_hora  -- no confundir con el propio grupo que se está por unir/crear
    AND r.estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
    AND (r.expira_en IS NULL OR r.expira_en > now())
    AND r.hora::time < (p_hora::time + p_horas * interval '1 hour')
    AND (r.hora::time + r.horas * interval '1 hour') > p_hora::time
) THEN
  RAISE EXCEPTION 'El profe ya tiene otro grupo en ese horario.';
END IF;
```

Habría que agregarlo en las dos funciones (`unirse_grupo` y la rama grupal de
`crear_reserva_pendiente_pago`) para que ambos caminos de pago queden
protegidos por igual. **No aplicado** — toca lógica de cupo compartida en
vivo, queda para que lo revises antes.

---

## Resumen de la noche

| Fase | Estado | Dónde |
|---|---|---|
| B — reprogramar del alumno | ✅ en prod | `main`, migración aplicada |
| D — `profiles.mail`/`creado_en` | ✅ en prod | `main`, migración aplicada |
| E — editor de packs persiste | ✅ en prod | `main`, migración aplicada |
| C — carrito de reservas múltiples | 🚧 WIP, para revisar | `feature/carrito` (pusheada, no mergeada), nada en prod |
| F — limpieza de compras colgadas | ✅ en prod | `main`, migración aplicada |

Todo lo marcado ✅ pasó por `ROLLBACK` test contra prod real antes de
aplicarse, y se verificó post-apply contra el estado real ya aplicado (no
solo simulado) en B, D y E — el detalle de cada verificación está en su
sección de arriba y en `CLAUDE.md`. Fase C es la única que no tocó nada de
producción — motivo explícito del pedido ("queda para que yo revise antes de
que toque producción real").

Nada quedó "genuinamente destructivo o ambiguo" sin marcar — las decisiones
de negocio sin resolver (todas dentro de Fase C, ver arriba) están anotadas,
no adivinadas. No hubo ningún punto donde me haya bloqueado por completo:
cuando encontré el bug del `CREATE OR REPLACE` con parámetro nuevo (Fase C),
lo diagnostiqué con el propio `ROLLBACK` test, lo corregí, y seguí.

Buen día — quedo atento a tu revisión de `feature/carrito` y a las 3 dudas de
negocio de esa fase.

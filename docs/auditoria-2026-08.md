# Auditoría PuntoClases — 2026-08-10

Informe de solo lectura. No se tocó código, no se hicieron deploys ni migraciones.
Evidencia levantada en vivo contra prod (`ihwtdblkrxgzhdnzhzsh`) vía `psql`-equivalente
(`pg` + `DATABASE_URL`), Vercel CLI, y lectura de `src/PuntoClasesApp.jsx` (6722
líneas, todo el frontend) + `src/db.js` + `api/*.js` + `supabase/migrations/*.sql`.

## 🔴 Resumen ejecutivo — lo más urgente

El hallazgo más severo de esta auditoría **no estaba en el pedido original**: apareció
al cruzar los flujos de profe/admin con las RLS reales. Tres RPCs de dinero
(`acreditar_compra`, `aprobar_compra`, `registrar_compra_pendiente`) tienen
`EXECUTE` otorgado a `PUBLIC` (además de a `service_role`) — es decir, **cualquier
usuario autenticado (y posiblemente `anon`) puede invocarlas directo por
PostgREST**, sin pasar por MercadoPago ni por el webhook. Ver [§7](#7-hallazgo-crítico-no-pedido---rpcs-de-pago-invocables-directo-por-cualquier-usuario).

También: la tabla `reservas` acepta `UPDATE`/`INSERT` directo del cliente sin que
la política RLS valide columnas de negocio (`monto`, `costo_saldo`, `alumno_id`,
`estado`), y `alumnos` acepta `UPDATE` de `saldo`/`vencimiento`/`suspendido` sin
restricción de columna. Ver [§3](#3-flujo-profe) y [§7](#7-hallazgo-crítico-no-pedido---rpcs-de-pago-invocables-directo-por-cualquier-usuario).

> **Actualización 2026-08-10 (mismo día, sesión posterior)**: los 2 hallazgos de
> RLS de profe en §3 (fuga de `profiles_profe_publico`/`profes_select` e
> integridad de `reservas_profe_update`) **ya se arreglaron y están en prod**
> (migración `20260810000001_fix_rls_profe_leaks.sql`). El hallazgo de §7 (RPCs
> de pago abiertas a `PUBLIC`) **sigue sin arreglar**. Al verificar el fix de
> profe apareció un bug nuevo, no relacionado: el "reprogramar" del lado alumno
> ya estaba roto de antes (ver nota al final de §3).

Nada de esto se explotó contra prod (solo se probó con `SELECT`, `EXPLAIN` de
policies, y en el caso de profe, `UPDATE`s reales **dentro de una transacción con
`ROLLBACK`**, nunca commiteados). Todo verificado con evidencia, nada asumido.

---

## 1) Estado del webhook (mp-webhook)

**Diagnóstico vigente: el P0 cerrado el 2026-07-29 sigue cerrado.** El código en
`main` (`api/mp-webhook.js:70-81`) soporta ambos formatos de notificación de MP
(query params `?type=payment&data.id=` y body JSON `{type,data:{id}}`) desde el
commit `dd42dd8` (2026-07-22), heredado del fix original en la Edge Function
(`4d38a8e`, 2026-06-17).

**Evidencia fresca de hoy (2026-08-10):**
- Vercel MCP (`get_runtime_logs`/`get_runtime_errors`) devolvió `403 Forbidden` —
  la cuenta conectada al MCP no tiene acceso a este proyecto/team de Vercel
  (`list_projects` devolvió `[]`). `vercel logs` por CLI (autenticado como
  `puntoclases-cell`, confirmado con `vercel whoami`) no devolvió líneas para
  ningún filtro probado (con/sin query, con/sin `--since`) — no hay acceso a logs
  históricos por esta vía en este plan/CLI.
- **Probé el endpoint en vivo** con `curl` (firma inválida a propósito, sin
  `payment_id` real, sin tocar la DB):
  - `POST ?type=payment&data.id=999999` (formato nuevo) → `401`
  - `POST` body `{"type":"payment","data":{"id":"999999"}}` (formato viejo) → `401`
  - Sin firma → `401`
  - `GET` → `200` (no-op, como espera el código línea 68)
  - **Los tres casos de firma llegan al mismo código de validación HMAC y son
    rechazados de forma idéntica** — confirma que ambos formatos de notificación
    se parsean antes de la validación de firma (líneas 75-81) y no hay
    divergencia de comportamiento entre uno y otro.
- **Evidencia en DB (más concluyente que los logs)**: no hay tráfico real de
  pagos desde que se desplegó el webhook unificado. Última `compras` con
  `estado_pago='aprobado'` es del **2026-07-03** (antes de que existiera
  `api/mp-webhook.js`, que nació el 22-jul). `reservas` con `payment_id` no
  nulo: **0 filas** (el flujo de pago-por-clase F6 nunca se usó con un pago real
  en prod). `pagos_huerfanos`: **0 filas**. Las únicas entradas en `rate_limits`
  con clave `webhook:ip:*` son del **2026-07-29/30** — coinciden exactamente con
  la ventana del test con el simulador real de MP que cerró el P0, no con tráfico
  orgánico posterior.
- La Edge Function vieja (`supabase/functions/mp-webhook/index.ts`) sigue sin
  tocarse desde el 2026-07-15 (confirmado por `git log`), intacta como rollback.

**Conclusión:** el fix del P0 sigue vigente a nivel de código y responde
correctamente hoy, pero **no hay evidencia de que un pago real de un usuario haya
pasado por el webhook desde el 22-jul** — la única confirmación real es el test
controlado del 29/30-jul. No es una regresión ni una duda sobre el fix; es una
ausencia de tráfico orgánico, esperable si la app todavía no tiene usuarios reales
pagando. Vale la pena confirmar el mismo diagnóstico ni bien haya el primer pago
real post-fix.

---

## 2) Flujo alumno

Todo vive en `src/PuntoClasesApp.jsx`. Backend en `src/db.js` + `api/crear-preferencia-pack.js` / `api/crear-preferencia-reserva.js`.

### Reservar — wizard de 8 pasos (líneas 210-696)

| Paso | Pregunta | Qué setea |
|---|---|---|
| 1 | ¿Qué materia necesitás? | `materia` |
| 2 | ¿Cómo querés la clase? | `tipo` (individual/grupal) |
| 3 | ¿Presencial o virtual? | `modalidad` |
| 4 | ¿Con qué profe? | `profeId`, `nombreProfeElegido` |
| 5 | Fecha | `fecha` (calendario, `mes`/`calYear`) |
| 6 | Horario | `horaInicio`, `duracionHoras`, cupo grupal en vivo |
| 7 | ¿Qué necesitás trabajar? | `necesidad` |
| 8 | Confirmá tu reserva | dispara pago/reserva |
| 9 | (no es un paso, es la pantalla de éxito) | — |

Llamadas a backend: `getDisponibilidad` (profe), `getReservasDelDia`/RPC
`verificar_disponibilidad` (slots ocupados), `getMisReservasDelDia` (detectar "ya
estás anotado" en grupal), y en paso 6 para grupal, `getGrupoInfo`/RPC
`get_grupo_info` por cada horario visible (cupo en vivo). Confirmar dispara
`crearReserva`/RPC `crear_reserva` (paga con saldo) o
`crearPreferenciaReserva` → `POST /api/crear-preferencia-reserva` (paga con MP,
crea `pendiente_pago` con TTL 30min).

**Bug encontrado (no pedido) — grupal nunca puede pagarse con saldo**: el botón
"Usar saldo" (línea 652) tiene `tipo !== "grupal"` en su condición de render, así
que **nunca aparece para clases grupales**, aunque el handler que dispara
(líneas 658-659) sí tiene la rama `if (tipo === "grupal") unirseGrupo(...)` —
código hoy inalcanzable. Contradice el copy del paso 2 (línea 399): "Compartís la
clase con otros alumnos. **20% más barata en saldo**" — el alumno lee que grupal
es más barata en saldo pero el wizard lo obliga a pagar por MP igual. Confirmar
con David si es decisión de negocio o regresión.

### Comprar — packs y horas sueltas (líneas 962-1180)

**Re-diagnóstico del bug de "Horas sueltas" (pedido explícito):**

**El bug que describe CLAUDE.md ya no existe — se arregló hace casi dos meses**, en
el commit `2d55c46` (2026-06-16, "fix: Task A/B/C/0 — promo, horas sueltas,
webhook migration"), confirmado con `git log -p`. El diff de esa fecha:
```diff
- : sel==="sueltas" ? {horas:cantSueltas, precio:precioSuelto} : null;
+ : {horas:cantSueltas, precio:precioSuelto};
```
En el código de HEAD (línea 1004-1006):
```js
const seleccion = tab==="packs"
  ? packs.find(p=>p.id===sel)
  : {horas:cantSueltas, precio:precioSuelto};
```
Para `tab==="sueltas"`, `seleccion` es siempre un objeto válido — no depende de
`sel` en absoluto. El botón de pago (`disabled={!seleccion || pago==="procesando"}`,
línea 1135) nunca queda deshabilitado en esa pestaña. **La persona que dudó del
diagnóstico original de CLAUDE.md tenía razón: estaba desactualizado.**

Se verificó también la hipótesis alternativa (`PRECIO_HS`/`cfgEfectiva` en el
primer render) trazando la cadena completa `AppAlumno.cfgLive` (arranca `null`,
línea 2089) → prop `cfg` → `Comprar` línea 971 `cfgEfectiva = cfgProp || CFG`
(fallback hardcodeado con `precioInd:20000`, siempre numérico) → línea 4256
`normCfg` usa `??` en cada campo. **No hay ventana de `undefined`/`NaN` en
ningún momento.** Tampoco es la causa.

**Si el bug se sigue viendo en producción hoy**, las hipótesis con más sustento
(no verificables solo leyendo código) son:
- Rate limit del endpoint (`api/crear-preferencia-pack.js`, `RL_ALUMNO={limite:5,ventanaSeg:300}`) — reintentos rápidos cortan con 429, el front lo muestra como error genérico de conexión.
- PWA con service worker sirviendo un build cacheado anterior al fix de junio — vale preguntarle a David si el celular/navegador donde vio el bug tiene la PWA reinstalada recientemente.

**Bug relacionado, pero en la pestaña "Packs" (no en "Horas sueltas")**: si
`getPacks()` falla o devuelve vacío, el front cae a `CFG.packs` hardcodeado
(ids `"p4"`,`"p8"`,`"p12"`,`"prueba"`, líneas 978-980). Si el alumno compra un
pack de ese fallback, `api/crear-preferencia-pack.js` hace `SELECT ... FROM
packs WHERE id=$1` contra la tabla real — esos ids sí existen hoy en prod (se
verificó: `p4`,`p8`,`p12`,`prueba` están en la tabla), así que hoy no
dispara, pero es un acoplamiento frágil: si algún día se renombran los ids en
`config`/`packs` sin actualizar el fallback hardcodeado, el error se mostraría
como "no se pudo iniciar el pago, revisá tu conexión" — engañoso.

### Profes (líneas 1183-1222)

Sin estado propio, sin llamadas a backend — lista `profesData` (cargado en
`AppAlumno` vía `getProfes()` → `SELECT * FROM profes_publicos`, la vista
pública sin datos sensibles). Botón "Reservar clase" solo navega a la pantalla
Reservar, **sin preseleccionar profe/materia** — el wizard arranca de cero.

### Historial (líneas 699-959)

No hace fetch propio — recibe `reservas` como prop. Acciones: "Borrar reserva
pendiente" → `devolverHoras`/RPC `devolver_horas`; calificar clase → `crearResenia`
(insert directo a `resenias`); reprogramar → delega a `ModalReprogramar`.

**Inconsistencia encontrada**: el cache de reseñas ya hechas (`resenias`, línea
704) es puramente local al componente — si el alumno recarga la página, una
clase ya calificada vuelve a mostrar el botón "Calificar clase" (el insert real
fallaría por constraint en DB si reintenta, no verificado, pero la UI no lo
previene).

### Perfil (líneas 1306-1599)

Edición de nombre/tel (`actualizarPerfil`+`actualizarAlumno`), subida de avatar
(`subirAvatar` → Storage bucket `avatars`). Sin hallazgos de bug funcional; nota
de estilo: `errorFotoAlumno` (línea 1371) se referencia en un handler declarado
antes (línea 1335) — funciona por closures de JS, pero es un orden de
declaración confuso de mantener.

### Chat (líneas 1604-1809)

**Inconsistencia encontrada**: el badge "sin leer" y el preview del último
mensaje en la lista de conversaciones no reflejan el estado real — `mensajes`
arranca vacío y solo se llena cuando se abre esa conversación puntual en la
sesión actual. No hay tracking de "leído" server-side; el punto rojo es más
"el profe escribió algo alguna vez y yo ya entré a verlo esta sesión" que
"tenés un mensaje nuevo".

### AppAlumno (líneas 2035-2333) — contenedor

Orquesta toda la carga inicial (`getAlumno`, `getReservasAlumno`, `getCompras`,
`getProfes`, `getConfig`, `getPacks`) y el polling de retorno de MP (cada 3s,
hasta ~60s, para pago-por-clase). El efecto de `reservasAlumno` también hace
limpieza lazy de `pendiente_pago` vencidas llamando `devolverHoras` en loop.
Sin condiciones de carrera detectadas (los efectos de compra-de-horas y de
reservas corren en paralelo pero no comparten estado mutuamente exclusivo).

---

## 3) Flujo profe

Componentes activos: `Reservas` (:2630), `Disponibilidad` (:2779), `Alumnos`
(:2905), `Ingresos` (:3056, 100% cálculo client-side, sin red), `PerfilProfe`
(:3384), `ChatProfe` (:3776), orquestados por `AppProfeMain` (:4036).
**`ProfeReservas`(:2349) y `ProfeDisponibilidad`(:2411) son código muerto** —
definidos pero sin ninguna referencia fuera de sí mismos; `AppProfeMain` usa
`Reservas`/`Disponibilidad` en su lugar.

### Acciones del profe → función db.js → tabla/RPC

| Acción | db.js | Query real |
|---|---|---|
| Marcar clase realizada/ausente/cancelada | `marcarReserva` | `UPDATE reservas SET estado,marcada_en WHERE id=...` (directo, no RPC) |
| Cargar devolución | `cargarDevolucion` | `UPDATE reservas SET devolucion,avance` (directo) |
| Reprogramar | `reprogramarReserva` | `UPDATE reservas SET fecha,hora,estado` (directo) |
| Tocar disponibilidad | `setBloque`/`borrarBloque` | `UPSERT`/`DELETE` en `disponibilidad`, scoped a `profe_id` propio |
| Guardar perfil | `actualizarMiPerfilProfe` | **RPC** `actualizar_mi_perfil_profe` (SECURITY DEFINER, `WHERE id=auth.uid()` interno — no acepta `profe_id` como parámetro) |
| Cargar "mis datos" al entrar | `getProfesAdmin()` | **Sin filtro de id** — trae los primeros 50 profes completos (pensada para el panel admin) y filtra client-side `find(p=>p.id===user.id)`. Funciona, pero es la función equivocada para este uso — de paso expone que cualquier profe puede pedir por API directa la lista completa de profes con mail incluido (ver hallazgo abajo). |

### RLS — hallazgos (verificados en vivo, dentro de transacciones con `ROLLBACK`, con el JWT simulado de un profe real de prod)

**🔴 Un profe puede leer datos de negocio de CUALQUIER otro profe, no solo el
suyo.** Policy `profiles_profe_publico` (tabla `profiles`) y `profes_select`
(tabla `profes`) solo exigen `auth.role()='authenticated'`, sin scoping por
dueño. Confirmado en vivo: la sesión de un profe real leyó `mail`/`nombre` de
otros dos profes con los que nunca compartió una reserva. Cualquiera con su JWT
puede pedir `GET /rest/v1/profes?select=*,profiles(nombre,mail,avatar_url)`
directo y traerse `mail`, `titulo`, `bio`, `monotributo`, `ubicacion`,
`instagram` de todos los profes. El **UPDATE** sí está bien protegido
(`profes_update_admin`, confirmado con un UPDATE real en rollback → 0 filas).

**🔴 Un profe puede reescribir cualquier columna de sus propias reservas, no
solo `estado`/`devolucion`.** Policy `reservas_profe_update`: `USING
(mi_rol()='profe' AND profe_id=auth.uid())`, **sin `WITH CHECK` explícito**
(Postgres reutiliza el `USING` como check, que solo valida `profe_id`, no
ninguna otra columna). Confirmado en vivo sobre una reserva real (id 65, del
profe dueño real, dentro de una transacción con rollback):
```sql
UPDATE reservas SET monto = 999999999, alumno_id = '<otro-alumno>' WHERE id = 65;
-- 1 fila afectada, sin error
```
El front nunca manda esos campos (`marcarReserva`/`cargarDevolucion` solo tocan
columnas específicas), pero eso es una restricción del cliente, no de la base:
un profe con su JWT real y curl puede inflar el `monto` de su propia clase
(afecta cálculos de Finanzas) o reasignarle la reserva a otro alumno. No se
pudo probar el caso "reserva de OTRO profe" con datos reales (en prod solo hay
un profe con filas en `reservas` hoy), pero la policy en sí (`profe_id=auth.uid()`
en ambos lados) indica que ese caso específico sí está bloqueado.

**Verificado como correcto, sin hallazgos:** `alumnos` (SELECT scoped
correctamente vía reserva compartida), `config`/`packs` (protegidos por
`mi_rol()='admin'`), `mensajes` (scoped a participante), `disponibilidad`
(lectura abierta a propósito — necesaria para que alumnos vean franjas de
cualquier profe —, escritura scoped con `USING`+`WITH CHECK` explícitos),
Storage `avatars` (policies exigen que el primer segmento del path sea el
propio `auth.uid()`).

> **✅ Arreglado (2026-08-10, migración `20260810000001_fix_rls_profe_leaks.sql`,
> aplicada y verificada en prod)**: los 2 hallazgos de arriba (fuga de
> `profiles_profe_publico`/`profes_select`, e integridad de
> `reservas_profe_update`). Detalle del fix y su verificación en `CLAUDE.md`.
>
> 🔴 **Bug nuevo encontrado al verificar el fix (no arreglado, fuera de este
> alcance)**: el "reprogramar" del lado **alumno** (`ModalReprogramar` dentro de
> `Historial`, `PuntoClasesApp.jsx:6418`) llama `reprogramarReserva()` — un
> `UPDATE` directo a `reservas`, no una RPC. Nunca existió una policy RLS que le
> diera `UPDATE` a un alumno sobre sus propias reservas (solo había para
> admin/profe) — así que ese `UPDATE` **ya fallaba antes de esta migración**.
> El error se traga en un `catch(err=>console.error(...))` (línea 6418) sin
> propagarse, y la UI igual muestra "reprogramación confirmada ✓" por estado
> local optimista (`AppAlumno`, línea 2224-2228) — la clase nunca se mueve en
> la DB pero el alumno ve éxito. Confirmado con RLS real (`pg_policies` sobre
> `reservas`: solo `reservas_admin_update` y `reservas_profe_update` existen
> para `UPDATE`). Pendiente: agregar `reservas_alumno_update` (columnas
> `fecha`,`hora`,`estado` únicamente, mismo criterio que profe) + que el catch
> de la UI deje de tragarse el error.

---

## 4) Flujo admin

Componentes: `Dashboard` (:4289, solo lectura), `Personas` (:4433, alumnos y
profes), `Operaciones` (:4867, solo lectura con paginación server-side),
`Finanzas` (:4947), orquestados por `AppAdminMain` (:5151).

### Acciones del admin → función db.js → tabla/RPC

| Acción | db.js | Toca |
|---|---|---|
| Agregar 1hs de saldo | `addHorasAdmin` | **RPC** `add_horas_admin` (chequea `profiles.rol='admin'` internamente) → `alumnos.saldo` |
| Extender vencimiento / suspender / dar de baja alumno | `actualizarAlumno` | `UPDATE alumnos` directo |
| Registrar pago / aprobar / pausar / suspender profe | `actualizarProfe` | `UPDATE profes` directo |
| Agregar profe nuevo | `registrarProfe` (`auth.signUp`) + `actualizarProfe` | crea usuario auth + `UPDATE profes` |
| Guardar configuración (precios, cowork, vencimiento, penalización) | `updateConfig` | `UPDATE config WHERE id=1` directo |
| Reportes de Finanzas | `getFinanzasPeriodo` | **RPC** `get_finanzas_periodo` (chequea admin internamente) |
| `GET /api/admin/reconciliar-huerfanos` | — | Vercel endpoint, verifica JWT contra Supabase Auth + `SELECT rol FROM profiles` vía pool `postgres` — **bien anclado server-side**, no confía en nada que mande el front |

**Nota**: el editor de "Packs con descuento %" en Finanzas solo cambia estado
local (`cfg.packs`) — no hay ningún escritor real de la tabla `packs` en el
repo (documentado también en un comentario de `db.js:74-77`). Los cambios de
descuento no persisten.

### Cómo se determina "es admin" — anclaje server-side

Función central `mi_rol()` (`SECURITY DEFINER`, lee `profiles.rol` a partir de
`auth.uid()` real del JWT verificado por Supabase Auth — no de nada que mande
el cliente):
```sql
CREATE FUNCTION public.mi_rol() RETURNS rol_usuario
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select rol from public.profiles where id = auth.uid(); $$
```
Todas las policies admin (`alumnos_admin_*`, `profes_update_admin`,
`profiles_admin`, `config_admin`, `packs_admin`, `reservas_admin_update`) usan
`mi_rol()='admin'` en `USING`/`WITH CHECK`. El front (`if (user.rol==="admin")`,
línea 6720) decide solo qué se renderiza — **la restricción real está en RLS,
no en el front**, verificado: cada UPDATE que dispara el panel admin pasa por
una policy con `mi_rol()='admin'`, y las dos RPCs admin-only tienen su propio
`RAISE EXCEPTION` si `auth.uid()` no es admin. Un usuario no-admin que fuerce
esas mismas llamadas por curl es bloqueado por la DB, no por el front.

**No se encontró ningún caso donde una acción del panel admin dependa solo del
front sin respaldo real en RLS/RPC.** El panel admin en sí está bien
construido. El problema grave que sí apareció (§7) no es "admin mal protegido"
— es "RPCs de dinero abiertas a cualquiera", un nivel más profundo.

---

## 5) Esquema real (vía `information_schema`/`pg_catalog` en vivo, no MCP)

### `compras`
| Columna | Tipo | Null | Default |
|---|---|---|---|
| id | bigint | NO | — |
| alumno_id | uuid → `alumnos.id` | NO | — |
| pack_id | text → `packs.id` | YES | — |
| horas | numeric | NO | — |
| monto | integer | NO | — |
| metodo | text | YES | — |
| **mp_payment_id** | text | YES | — |
| vencimiento | date | YES | — |
| creado_en | timestamptz | NO | `now()` |
| estado_pago | text | NO | `'aprobado'` |
| **payment_id** | text | YES | — |

⚠️ **Dos columnas de payment id**: `mp_payment_id` y `payment_id`. Grep sobre
todo el repo: `mp_payment_id` no aparece en ningún lado del código —
**columna muerta**, legado de un patrón anterior. El campo real usado por todo
el código actual es `payment_id` (con índice único `compras_payment_id_uniq`).

### `reservas`
id·bigint, alumno_id·uuid→alumnos, profe_id·uuid→profes, materia·text,
fecha·date, hora·text, horas·numeric(default 1), modalidad·enum(`Presencial`,`Virtual`),
tipo·enum(`individual`,`grupal`), alumnos_grupo·int, estado·enum(`pendiente`,
`confirmada`,`realizada`,`cancelada`,`rechazada`,`ausente`,`pendiente_pago`,`expirada`),
costo_saldo·numeric(default 0), monto·integer(default 0), necesidad·text,
devolucion·text, avance·text, marcada_en·timestamptz, creado_en·timestamptz,
grupo_id·bigint→grupos, expira_en·timestamptz, payment_id·text.
Check constraint: no permite `modalidad='Virtual' AND tipo='grupal'`.
Índices únicos parciales: 1 reserva individual activa por profe+fecha+hora;
1 reserva activa por alumno+grupo.

### `profes`
id·uuid→profiles, tel, titulo, bio, materias·text[], niveles·text[],
modalidad·text[], clases_dadas·int, horas_dadas·numeric, activo·bool(default
false), suspendido·bool(default false), pagado_mes·bool, monotributo·bool,
categoria_monotributo·text, creado_en, años_experiencia·int, ubicacion·text,
instagram·text. (Vista pública `profes_publicos`: solo `id, activo, materias,
suspendido, nombre` — sin mail ni datos sensibles, a diferencia de `profes`.)

### **No existe tabla `materias`** — es una columna:
`profes.materias` (`text[]`, catálogo por profe), `reservas.materia` (`text`,
libre) y `grupos.materia` (`text`). No hay tabla de catálogo normalizada de
materias en ningún lado — son strings libres, sin FK ni check constraint que
valide contra una lista cerrada. Importante si se diseña el carrito: no hay
forma de validar server-side que una "materia" sea una de las reales sin
comparar contra `profes.materias` del profe elegido.

### `packs`
id·**text** (no uuid — valores reales hoy: `prueba`, `p4`, `p8`, `p12`),
horas·int, descuento·int, tag·text, solo_nuevos·bool, activo·bool(default
true), orden·int. `compras.pack_id` es `text` y referencia esto — pero
`acreditar_compra.p_pack_id` es tipado `uuid` en la firma de la función (cast a
`::text` al insertar) — inconsistencia de tipos tolerada porque siempre se
pasa `NULL` desde el código actual salvo en la rama legado del webhook, que
además valida con un regex UUID que **nunca matchea contra los ids reales de
`packs`** (`p4` no es un UUID) — esa rama legado (RAMA C en `mp-webhook.js`)
está efectivamente muerta para packs reales de hoy.

### `config` (fila única, `id=1`)
precio_ind·int, factor_grupal·numeric, tarifa_profe_ind·int, tarifa_profe_grp·int,
cowork_por_alumno·int, vencimiento_dias·int, penalizacion_pct·int,
cupo_grupal·int(default 4). Valores actuales en prod: precio_ind=20000,
factor_grupal=0.80, tarifa_profe_ind=10000, tarifa_profe_grp=8000,
cowork_por_alumno=2000, vencimiento_dias=45, penalizacion_pct=50, cupo_grupal=4.

### Otras tablas relevantes
`alumnos` (id·uuid→profiles, tel, nivel, foto, saldo·numeric, saldo_residual·numeric,
vencimiento·date, suspendido·bool, activo·bool), `profiles` (id·uuid, rol·enum
`alumno`/`profe`/`admin`, nombre, mail, avatar_url), `disponibilidad`
(profe_id, fecha, hora, tipo·enum `individual`/`grupal`/`ambas`), `grupos`
(profe_id, materia, fecha, hora, horas, modalidad, cupo_max, estado),
`mensajes` (reserva_id, emisor·enum, emisor_id, texto), `resenias` (reserva_id,
alumno_id, profe_id, estrellas 1-5, comentario), `pagos_huerfanos` (payment_id
único, reserva_id, monto_ars, motivo), `rate_limits` (clave PK, contador,
ventana_inicio — **ojo**: la columna se llama `ventana_inicio`, no
`actualizado_en`).

---

## 6) Otros bugs/inconsistencias encontrados al pasar (sin arreglar)

1. **Reservar (alumno), línea 652**: grupal no puede pagarse con saldo pese a que el copy lo promete — ver §2.
2. **Comprar (alumno)**: fallback de packs hardcodeados (`CFG.packs`) frágil si se desincroniza de la tabla real — ver §2.
3. **Chat (alumno), líneas 1741-1763**: badge "sin leer" y preview no reflejan estado real, sin tracking de "leído" server-side.
4. **Historial (alumno), línea 704**: cache de reseñas ya hechas es local, no lee de DB al montar — permite reintentar calificar visualmente.
5. **`compras.mp_payment_id`**: columna muerta, sin uso en código — candidata a limpieza (destructiva, requiere OK explícito).
6. **`crearProfe` en `db.js:238-247`**: INSERT directo a `profes` sin crear el usuario auth — stub muerto, el flujo real de alta de profe usa `registrarProfe` + `actualizarProfe`.
7. **`ProfeReservas`/`ProfeDisponibilidad`** (líneas 2349-2548): componentes completos sin ninguna referencia — código muerto.
8. **RAMA C (legado) de `mp-webhook.js`**: el regex UUID para `pack_id` nunca matchea contra los ids reales de `packs` (`p4`, `p8`, etc. no son UUIDs) — rama efectivamente inalcanzable para packs actuales.
9. **`getProfesAdmin()` usada por un profe para traer sus propios datos** (`AppProfeMain` línea ~4071): función pensada para el panel admin, sin filtro por id, trae los primeros 50 profes completos y filtra client-side — funciona pero es la función equivocada, y de paso ilustra el hallazgo de RLS de §3 (esos 50 profes completos, con mail, se pueden pedir igual por API directa).

---

## 7) Hallazgo crítico (no pedido) — RPCs de pago invocables directo por cualquier usuario

Verificado leyendo `pg_proc`/`information_schema.role_routine_grants` y el
cuerpo completo de cada función (no es una hipótesis — se leyó el código SQL
real en prod):

| Función | `EXECUTE` otorgado a | Chequeo interno de identidad |
|---|---|---|
| `acreditar_compra(alumno_id, horas, precio, payment_id, pack_id)` | **PUBLIC**, postgres, service_role | `IF p_alumno_id != auth.uid() THEN RAISE EXCEPTION` — exige que sea tu propio id, **pero no valida que el pago sea real** |
| `aprobar_compra(compra_id, payment_id)` | **PUBLIC**, postgres, service_role | **Ninguno** — no compara nada contra `auth.uid()` |
| `registrar_compra_pendiente(alumno_id, horas, precio, pack_id)` | **PUBLIC**, postgres, service_role | **Ninguno** — `p_alumno_id` puede ser cualquier UUID |
| `confirmar_reserva_pago(reserva_id, payment_id)` | postgres, service_role (sin PUBLIC) | — (no expuesto a clientes, correcto) |

`CLAUDE.md` (sección Esquema) dice *"service_role tiene: ... EXECUTE en
acreditar_compra, registrar_compra_pendiente, aprobar_compra"* — es cierto pero
**incompleto**: también las tiene `PUBLIC`, que en Postgres es el grant
implícito por defecto al crear una función si nunca se hace `REVOKE EXECUTE
FROM PUBLIC` — típico descuido de migración. Como PostgREST expone toda función
del schema `public` a la que el rol tenga `EXECUTE`, y `anon`/`authenticated`
heredan de `PUBLIC`, esto las deja llamables por `POST
/rest/v1/rpc/<función>` desde el front sin ningún JWT especial.

> **✅ Arreglado (2026-08-10, mismo día, sesión posterior — migración
> `20260810000002_revoke_public_rpcs_pago.sql`, aplicada)**. Antes de arreglarlo
> se confirmó la cadena de abajo **con ejecución real** en una transacción con
> `ROLLBACK` (no teórica): un alumno real se acreditó 999hs falsas a sí mismo
> con `acreditar_compra` + `payment_id` inventado (saldo 0.0→999.0); y **sin
> ninguna sesión** (rol `anon`, sin login) se le acreditaron horas a la cuenta
> de otro alumno encadenando `registrar_compra_pendiente`+`aprobar_compra`, y
> también con `acreditar_compra` directo — el chequeo `p_alumno_id !=
> auth.uid()` no frena cuando `auth.uid()` es `NULL` (comparación con `NULL` no
> es `true` en SQL). Todo revertido con `ROLLBACK`, verificado después que no
> quedó nada aplicado. Forense de la tabla `compras` real (4 filas, completa):
> sin indicios de que esto se haya explotado contra datos reales — las 2 filas
> `aprobado` tienen `payment_id` numérico puro de 12 dígitos (formato típico
> MP), misma cuenta, fechas ya documentadas. No se pudo cruzar contra emails/
> panel de MP (sin acceso desde acá). El fix también dejó a `authenticated` sin
> acceso de rebote (nunca tuvo grant propio, solo heredaba de `PUBLIC`) — quedan
> solo `service_role`/`postgres`, que es como corren los callers reales
> (`api/mp-webhook.js`, `api/crear-preferencia-pack.js`, la Edge Function vieja).
> Detalle completo en `CLAUDE.md`.

**Cadena de explotación (confirmada con ejecución real en `ROLLBACK`, ver nota de arriba):**
```
registrar_compra_pendiente(<mi_alumno_id>, 99999, 1, null)   -- nadie valida alumno_id=auth.uid()
  → devuelve compra_id
aprobar_compra(compra_id, 'cualquier-string')                 -- nadie valida nada
  → acredita 99999 horas de saldo, gratis
```
o más directo aún:
```
acreditar_compra(auth.uid(), 99999, 0, 'fake-'||random(), null)
  → acredita 99999 horas al toque (sí valida que sea tu propio id, no valida el pago)
```
Esto rompía el invariante #1 del propio `CLAUDE.md` ("Dinero y saldo solo se
mueven server-side en RPCs atómicas e idempotentes... El front jamás confirma
pagos ni descuenta saldo") — la RPC en sí era la puerta, no hacía falta tocar
el front.

**Relacionado, mismo patrón, tablas en vez de funciones:**
- `reservas`: `authenticated` tenía `INSERT` de tabla completa; policy
  `reservas_insert` solo exigía `with_check: (alumno_id=auth.uid()) OR admin` —
  no validaba `estado`, `costo_saldo` ni `monto`. `compras` mismo patrón vía
  `compras_ins`. `resenias_ins` relacionado (no financiero): solo exigía
  `alumno_id=auth.uid()`, sin validar que `reserva_id`/`profe_id` tuvieran
  relación real entre sí ni con la clase.
- `alumnos`: `authenticated` tenía `UPDATE` de tabla completa; las policies
  `alumnos_self_update`/`alumnos_upd` no tenían `WITH CHECK` que restrinja
  columnas — un alumno podía `PATCH` directo su propia fila (`saldo`,
  `vencimiento`, `suspendido`) sin pasar por ninguna RPC.

> **✅ Arreglado (2026-08-10, mismo día, sesión posterior — migración
> `20260810000003_fix_rls_alumnos_saldo.sql`, aplicada)**. Confirmado
> explotable con ejecución real en `ROLLBACK` antes del fix: `UPDATE alumnos
> SET saldo=9999.9 WHERE id=auth.uid()` → 1 fila, pasaba tal cual. Fix:
> `saldo`/`saldo_residual` fuera del `GRANT` de `authenticated` (solo las
> tocan las RPCs `SECURITY DEFINER`); `alumnos_self_update` con `WITH CHECK`
> explícito que exige que `suspendido`/`activo`/`vencimiento` no cambien
> cuando escribe un alumno (comparado contra una función `SECURITY DEFINER`
> sin parámetro, mismo patrón que `mi_rol()`, para evitar la recursión de RLS
> y sin abrir un canal de lectura de otro alumno); `alumnos_admin_update` sin
> cambios; se dropeó `alumnos_upd` (legacy, confirmado 100% redundante contra
> los datos reales de hoy). Verificado post-apply: alumno bloqueado en
> `saldo`/`saldo_residual`/`suspendido`/`vencimiento`/`activo`, sigue pudiendo
> cambiar su `tel`, admin sigue pudiendo tocar `suspendido`/`vencimiento`/
> `activo` de cualquier alumno. Detalle completo en `CLAUDE.md`.

> **✅ Arreglado (2026-08-10, mismo día, barrido posterior — migración
> `20260810000004_close_inserts_reservas_compras_resenias.sql`, aplicada)**.
> Antes de arreglarlo se confirmó en `ROLLBACK`: un alumno podía `INSERT`
> directo una reserva `estado='confirmada', costo_saldo=0, monto=0` —
> **visible para el profe en su agenda** (probado simulando su sesión, la ve
> igual que una clase real), sin pasar por ninguna validación de saldo,
> disponibilidad, cupo ni solapamiento. Mismo patrón con `compras_ins`
> (genera un recibo `aprobado` falso, no acredita saldo porque no hay
> trigger, pero ensucia el historial). Grep completo de `src/` confirmó
> **cero** `.insert()` directo contra `reservas`/`compras` en todo el
> cliente — toda la creación real pasa por RPCs `SECURITY DEFINER`
> (`crear_reserva`, `crear_reserva_pendiente_pago`, `unirse_grupo`,
> `registrar_compra_pendiente`), que corren como `postgres` y no dependen de
> este grant. Fix: `REVOKE INSERT ... FROM authenticated` en las dos.
> `resenias_ins` reescrita con `WITH CHECK` que exige una reserva propia, con
> ese `profe_id`, `estado='realizada'` (confirmado en código,
> `PuntoClasesApp.jsx:916`, no asumido). Verificado post-apply: el flujo real
> de `crear_reserva()` sigue funcionando de punta a punta; `INSERT` directo a
> `reservas`/`compras` → `permission denied`; reseña de clase propia
> `realizada` → sigue andando; reseña con `profe_id` ajeno o clase no
> `realizada` → rechazada. Detalle completo en `CLAUDE.md`.

**Recomendación** — el patrón correcto ya existe en el propio repo: `profes`
tiene `UPDATE` otorgado a `authenticated` a nivel tabla pero **sin** ninguna
policy de self-update, así que en la práctica solo se puede escribir vía la
RPC `actualizar_mi_perfil_profe` (que sí valida todo internamente). Con los 4
fixes de esta sesión (RPCs de pago, `reservas` UPDATE, `alumnos` UPDATE,
`reservas`/`compras` INSERT + `resenias`) quedan cerrados todos los huecos de
RLS/grants encontrados en esta auditoría y su barrido posterior. Sin
pendientes de este tipo por ahora — lo que queda abierto (bug de reprogramar
del alumno, `profiles.mail`/`creado_en` auto-editables) está anotado en
`CLAUDE.md`, sin prioridad urgente.

---

## Pendiente de tu decisión

- ¿El bug de "Horas sueltas" se sigue viendo hoy en producción, en qué
  dispositivo/navegador? (para descartar caché de PWA vs. algo que no se ve en
  código estático).
- ¿Grupal sin poder pagar con saldo (§2) es intencional?
- Priorizar el hallazgo de §7 (RPCs abiertas) — es el más severo de todo el
  informe, aunque no estaba en el pedido original.

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

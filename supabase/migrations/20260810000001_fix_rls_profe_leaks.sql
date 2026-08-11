-- ════════════════════════════════════════════════════════════════════════════
-- Fix RLS: 2 hallazgos de la auditoría 2026-08-10 (docs/auditoria-2026-08.md §3)
-- Verificado en ROLLBACK contra prod antes de escribir esto. No aplicado aún.
-- ════════════════════════════════════════════════════════════════════════════

-- ── HALLAZGO 1 — fuga de datos ──────────────────────────────────────────────
-- profiles_profe_publico exigía solo "el id existe en profes" (sin relación
-- con quien pregunta); profes_select exigía solo "estás logueado". Cualquier
-- authenticated podía leer mail/monotributo/categoria_monotributo/ubicacion/
-- instagram/tel/pagado_mes de CUALQUIER profe.
--
-- Uso real verificado antes de tocar nada (grep completo de src/):
--   - profes_publicos (vista, dueña `postgres`, bypassea RLS de profes/profiles
--     por completo porque el owner de una tabla no está sujeto a sus propias
--     RLS policies) es lo ÚNICO que usa el buscador de profes del alumno
--     (componentes Profes y Reservar, vía getProfes()/db.js:209) —
--     id/activo/materias/suspendido/nombre. Esta migración no la toca: sigue
--     funcionando idéntico.
--   - getProfesAdmin() (db.js:215, `profes.*, profiles(nombre,mail,avatar_url)`)
--     la usa el panel admin (Personas > Profes, necesita mail de TODOS los
--     profes) y, como bug ya anotado en la auditoría (no se toca acá), también
--     AppProfeMain para traer el propio perfil del profe — sin filtrar por id,
--     filtrando client-side. Con este fix, un profe no-admin que la invoque
--     sigue encontrándose a sí mismo (RLS le devuelve solo su propia fila en
--     vez de las 50), sin ver ya a nadie más.
--   - getReservasAlumno() (db.js:130, `reservas...profes(profiles(nombre))`) es
--     el único lugar donde un ALUMNO necesita leer `profiles` de un profe —
--     para mostrarle el nombre en su Historial, de un profe con el que
--     REALMENTE tiene una reserva. Se cubre con la policy nueva
--     profiles_profe_para_alumno, espejo exacto de profiles_alumno_para_profe
--     (que ya existía para la dirección profe→alumno, sin tocar).

DROP POLICY IF EXISTS profiles_profe_publico ON profiles;

CREATE POLICY profiles_profe_para_alumno ON profiles
  FOR SELECT TO authenticated
  USING (
    mi_rol() = 'alumno'::rol_usuario
    AND EXISTS (
      SELECT 1 FROM reservas
      WHERE reservas.profe_id = profiles.id
        AND reservas.alumno_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS profes_select ON profes;

CREATE POLICY profes_select ON profes
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR mi_rol() = 'admin'::rol_usuario
  );

-- ── HALLAZGO 2 — integridad ─────────────────────────────────────────────────
-- reservas_profe_update no tenía WITH CHECK explícito (Postgres reusaba el
-- USING, que solo valida profe_id — no columnas), y el GRANT UPDATE era de
-- tabla completa: un profe podía pisar monto/alumno_id/costo_saldo/
-- payment_id/horas/materia/tipo/modalidad/grupo_id/expira_en de sus propias
-- reservas por API directa. El frontend (marcarReserva/cargarDevolucion/
-- reprogramarReserva, db.js) solo escribe estado, marcada_en, devolucion,
-- avance, fecha, hora — riesgo ya documentado como residual en el comentario
-- de 20260716000002_rls_reservas_rpc.sql. Es el que se cierra acá.
--
-- OJO (para quien aplique esto): el REVOKE de abajo es de tabla completa —
-- afecta también a reservas_admin_update. Hoy no hay ningún UPDATE directo a
-- reservas desde el panel admin en el código (Operaciones es solo lectura;
-- las únicas 3 funciones que hacen UPDATE de reservas son las de arriba, y
-- ninguna la llama el admin) — cero regresión verificada. Si en el futuro se
-- necesita que el admin edite otra columna de reservas directo por API, hay
-- que sumarla al GRANT column-level de abajo (o mejor, crear una RPC
-- SECURITY DEFINER admin-only, como ya se hace con add_horas_admin).

ALTER POLICY reservas_profe_update ON reservas
  WITH CHECK (
    mi_rol() = 'profe'::rol_usuario
    AND profe_id = auth.uid()
  );

REVOKE UPDATE ON public.reservas FROM authenticated;
GRANT UPDATE (estado, devolucion, avance, marcada_en, fecha, hora)
  ON public.reservas TO authenticated;

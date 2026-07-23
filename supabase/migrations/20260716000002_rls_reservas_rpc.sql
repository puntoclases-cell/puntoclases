-- ════════════════════════════════════════════════════════════════════════════
-- Corrección 2: verificar_disponibilidad RPC + reservas_select restringida
-- ════════════════════════════════════════════════════════════════════════════

-- 1. RPC verificar_disponibilidad
--    Devuelve SOLO hora, horas, tipo (sin alumno_id ni payment_id).
--    hora es text en la DB, tipo es enum tipo_clase.
CREATE OR REPLACE FUNCTION verificar_disponibilidad(
  p_profe_id uuid,
  p_fecha date
)
RETURNS TABLE(hora text, horas numeric, tipo tipo_clase)
LANGUAGE sql
STABLE
AS $$
  SELECT r.hora, r.horas, r.tipo
  FROM reservas r
  WHERE r.profe_id = p_profe_id
    AND r.fecha = p_fecha
    AND r.estado IN ('confirmada'::estado_reserva, 'pendiente'::estado_reserva)
$$;

REVOKE ALL ON FUNCTION verificar_disponibilidad(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verificar_disponibilidad(uuid, date) TO authenticated;

-- 2. Policy reservas_select restringida
DROP POLICY IF EXISTS reservas_read ON reservas;
CREATE POLICY reservas_select ON reservas
  FOR SELECT TO authenticated
  USING (
    alumno_id = auth.uid()
    OR profe_id = auth.uid()
    OR mi_rol() = 'admin'::rol_usuario
  );

-- 3. Policy reservas_insert restringida
DROP POLICY IF EXISTS reservas_ins ON reservas;
CREATE POLICY reservas_insert ON reservas
  FOR INSERT TO authenticated
  WITH CHECK (
    alumno_id = auth.uid()
    OR mi_rol() = 'admin'::rol_usuario
  );

-- 4. Policy reservas_update: admin + profe
--    Riesgo residual documentado: el frontend tiene 3 funciones que UPDATE reservas
--    como profe sobre sus propias reservas:
--      - marcarReserva(): cambia 'estado' + 'marcada_en'
--      - cargarDevolucion(): cambia 'devolucion' + 'avance'
--      - reprogramarReserva(): cambia 'fecha' + 'hora' + fuerza 'estado'='confirmada'
--    Ninguna toca 'alumno_id' ni 'payment_id'. Son functions de negocio legítimas.
--    reprogramarReserva fuerza estado=confirmada implícitamente (riesgo de negocio, no de datos).
DROP POLICY IF EXISTS reservas_admin_update ON reservas;
DROP POLICY IF EXISTS reservas_profe_update ON reservas;

CREATE POLICY reservas_admin_update ON reservas
  FOR UPDATE TO authenticated
  USING (mi_rol() = 'admin'::rol_usuario);

CREATE POLICY reservas_profe_update ON reservas
  FOR UPDATE TO authenticated
  USING (
    mi_rol() = 'profe'::rol_usuario
    AND profe_id = auth.uid()
  );

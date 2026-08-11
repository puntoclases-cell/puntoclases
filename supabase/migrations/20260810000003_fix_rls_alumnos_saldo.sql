-- ════════════════════════════════════════════════════════════════════════════
-- Fix: alumnos podía auto-acreditarse saldo por UPDATE directo, sin pasar por
-- ninguna RPC (docs/auditoria-2026-08.md §7, confirmado con ROLLBACK real:
-- UPDATE alumnos SET saldo=9999.9 WHERE id=auth.uid() → pasaba, 1 fila).
-- Mismo patrón que reservas_profe_update (20260810000001): 3 policies de
-- UPDATE con with_check NULL + GRANT de tabla completa a `authenticated`.
--
-- Objetivo:
--   - authenticated NUNCA escribe saldo/saldo_residual por UPDATE directo
--     (columna ni siquiera otorgada — solo RPCs SECURITY DEFINER, como ya es
--     hoy: acreditar_compra, aprobar_compra, add_horas_admin, devolver_horas).
--   - Alumno (mi_rol()='alumno', id=auth.uid()) solo puede cambiar su tel.
--   - Admin (mi_rol()='admin') sigue pudiendo tocar suspendido/vencimiento/
--     activo de cualquier alumno, sin cambios de comportamiento.
--   - alumnos_upd (legacy) se DROPea — confirmado antes (ver sesión) que
--     alumnos_self_update ∪ alumnos_admin_update cubren el 100% de lo que
--     permitía: ninguna fila real de `alumnos` tiene profiles.rol distinto de
--     'alumno' ni le falta profiles — el `mi_rol()='alumno'` que le faltaba a
--     alumnos_upd nunca hacía diferencia con los datos reales de hoy.
--
-- Cómo se bloquea que un alumno cambie suspendido/vencimiento/activo (columnas
-- que SÍ tiene que poder tocar el admin, así que no se pueden sacar del GRANT
-- sin romper a admin): WITH CHECK explícito que exige que esas 3 columnas
-- queden IGUAL a como estaban. Para leer el valor viejo sin caer en la misma
-- recursión de RLS que documenta este repo para mi_rol() (por eso es
-- SECURITY DEFINER), se usa una función SECURITY DEFINER análoga que además
-- hardcodea `WHERE id = auth.uid()` (sin parámetro) para que no se pueda
-- invocar para leer el estado de otro alumno — no abre un canal nuevo de
-- fuga de datos.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mis_campos_protegidos_alumno()
RETURNS TABLE(suspendido boolean, activo boolean, vencimiento date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT suspendido, activo, vencimiento
  FROM public.alumnos
  WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.mis_campos_protegidos_alumno() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mis_campos_protegidos_alumno() TO authenticated;

-- Policy de self-update: antes solo exigía "sos vos"; ahora además exige que
-- suspendido/activo/vencimiento no cambien (saldo/saldo_residual ni siquiera
-- están en el GRANT de abajo, no hace falta chequearlos acá también).
DROP POLICY IF EXISTS alumnos_self_update ON alumnos;

CREATE POLICY alumnos_self_update ON alumnos
  FOR UPDATE TO authenticated
  USING (
    mi_rol() = 'alumno'::rol_usuario
    AND id = auth.uid()
  )
  WITH CHECK (
    mi_rol() = 'alumno'::rol_usuario
    AND id = auth.uid()
    AND suspendido  IS NOT DISTINCT FROM (SELECT suspendido  FROM public.mis_campos_protegidos_alumno())
    AND activo      IS NOT DISTINCT FROM (SELECT activo      FROM public.mis_campos_protegidos_alumno())
    AND vencimiento IS NOT DISTINCT FROM (SELECT vencimiento FROM public.mis_campos_protegidos_alumno())
  );

-- alumnos_admin_update queda intacta — admin sigue igual, no se toca.

-- Legacy duplicada, confirmado que no cubre ningún caso real que las otras
-- dos no cubran (ver nota arriba).
DROP POLICY IF EXISTS alumnos_upd ON alumnos;

-- Cierre real: columnas que puede escribir authenticated por UPDATE directo.
-- Unión de lo que necesitan alumno-self (tel) + admin (suspendido, vencimiento,
-- activo). saldo/saldo_residual quedan fuera — solo las tocan las RPCs
-- SECURITY DEFINER (corren como postgres, no dependen de este GRANT).
REVOKE UPDATE ON public.alumnos FROM authenticated;
GRANT UPDATE (tel, suspendido, vencimiento, activo) ON public.alumnos TO authenticated;

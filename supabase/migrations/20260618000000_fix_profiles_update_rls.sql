-- Fix recursión infinita (42P17) en profiles_update.
-- El WITH CHECK original leía profiles en un subquery directo → la policy
-- se re-evaluaba al leer la tabla → infinite recursion.
-- Solución canónica Supabase: reemplazar subquery por mi_rol() que ya es
-- SECURITY DEFINER + STABLE y lee profiles saltando RLS (sin recursión).
-- Semántica idéntica: usuario solo puede actualizar su propia fila y no puede cambiar su rol.

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK ((auth.uid() = id) AND (rol = mi_rol()));

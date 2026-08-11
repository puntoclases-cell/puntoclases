-- ════════════════════════════════════════════════════════════════════════════
-- FASE D (overnight 2026-08-10): profiles.mail / creado_en auto-editables
--
-- profiles_update ya bloqueaba `rol` (WITH CHECK rol=mi_rol()) pero no `mail`
-- ni `creado_en` — cualquiera podía reescribir su propio mail "de display"
-- (no toca auth.users.email real, no es account takeover) o falsear su fecha
-- de alta. Señalado como menor en la auditoría 2026-08-10, sin flujo sensible
-- que dependa de esto hoy — se cierra igual, mismo patrón ya usado en
-- alumnos_self_update (función SECURITY DEFINER sin parámetro, hardcodea
-- auth.uid() adentro, para leer el valor viejo sin recursión de RLS y sin
-- abrir un canal de lectura de otro usuario).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mis_campos_protegidos_perfil()
RETURNS TABLE(mail text, creado_en timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT mail, creado_en
  FROM public.profiles
  WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.mis_campos_protegidos_perfil() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mis_campos_protegidos_perfil() TO authenticated;

DROP POLICY IF EXISTS profiles_update ON profiles;

CREATE POLICY profiles_update ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND rol = mi_rol()
    AND (
      mi_rol() = 'admin'::rol_usuario
      OR (
        mail      IS NOT DISTINCT FROM (SELECT mail      FROM public.mis_campos_protegidos_perfil())
        AND creado_en IS NOT DISTINCT FROM (SELECT creado_en FROM public.mis_campos_protegidos_perfil())
      )
    )
  );

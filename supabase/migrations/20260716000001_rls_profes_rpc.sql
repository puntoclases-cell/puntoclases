-- ══════════════════════════════════════════════════════════════════════
-- CORRECCIÓN 3: profes — RPC para auto-edición, policy admin directa
-- ══════════════════════════════════════════════════════════════════════

-- 1. RPC: profe actualiza su propio perfil (campos públicos)
-- ┌─────────────────────────────────────────────────────────────────┐
-- │ ADVERTENCIA: Esta RPC NUNCA debe aceptAR activo, suspendido ni │
-- │ pagado_mes como parámetro. Esos campos son exclusivos del admin.│
-- │ Si necesitás agregar un campo, verificá que no sea de control.  │
-- └─────────────────────────────────────────────────────────────────┘
CREATE OR REPLACE FUNCTION public.actualizar_mi_perfil_profe(
  p_materias         text[],
  p_monotributo      boolean,
  p_titulo           text,
  p_bio              text,
  p_modalidad        text,
  p_anos_experiencia integer,
  p_ubicacion        text,
  p_instagram        text,
  p_niveles          text[]
)
RETURNS public.profes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result public.profes;
BEGIN
  UPDATE public.profes
  SET materias           = p_materias,
      monotributo        = p_monotributo,
      titulo             = p_titulo,
      bio                = p_bio,
      modalidad          = p_modalidad,
      "años_experiencia" = p_anos_experiencia,
      ubicacion          = p_ubicacion,
      instagram          = p_instagram,
      niveles            = p_niveles
  WHERE id = auth.uid()
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil de profe para el usuario actual.';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.actualizar_mi_perfil_profe(
  text[], boolean, text, text, text, integer, text, text, text[]
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.actualizar_mi_perfil_profe(
  text[], boolean, text, text, text, integer, text, text, text[]
) TO authenticated;

-- 2. Policies
DROP POLICY IF EXISTS profes_select ON profes;
DROP POLICY IF EXISTS profes_insert ON profes;
DROP POLICY IF EXISTS profes_update ON profes;

CREATE POLICY profes_select ON profes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY profes_insert ON profes
  FOR INSERT WITH CHECK (mi_rol() = 'admin');

CREATE POLICY profes_update_admin ON profes
  FOR UPDATE USING (mi_rol() = 'admin')
  WITH CHECK (mi_rol() = 'admin');

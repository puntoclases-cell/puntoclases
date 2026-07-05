-- Fix: p_reserva_id era uuid pero reservas.id es BIGINT.
-- En Postgres la firma incluye los tipos de args → CREATE OR REPLACE con tipo distinto
-- crea una SEGUNDA función, deja la uuid colgando y NO hereda GRANTs.
-- Solución: DROP explícito de la uuid primero, luego CREATE + GRANT.
--
-- Grants originales de devolver_horas(uuid,...): PUBLIC, authenticated.
-- Verificado: SELECT grantee FROM information_schema.routine_privileges
--             WHERE specific_schema='public' AND routine_name='devolver_horas';

-- 1. Eliminar la firma vieja (uuid)
DROP FUNCTION IF EXISTS public.devolver_horas(uuid, numeric, numeric);

-- 2. Crear con firma correcta (bigint)
CREATE OR REPLACE FUNCTION public.devolver_horas(
  p_reserva_id       bigint,
  p_factor_grupal    numeric DEFAULT 0.8,
  p_penalizacion_pct numeric DEFAULT 50
)
RETURNS TABLE(saldo_nuevo numeric, horas_devueltas numeric)
LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_reserva    RECORD;
  v_horas_orig NUMERIC;
  v_devolver   NUMERIC;
  v_con_costo  BOOLEAN;
  v_saldo      NUMERIC;
BEGIN
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_reserva_id;
  END IF;

  IF v_reserva.alumno_id != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_reserva.estado NOT IN ('confirmada', 'pendiente') THEN
    RAISE EXCEPTION 'La reserva ya está en estado "%": no se puede cancelar.', v_reserva.estado;
  END IF;

  v_horas_orig := CASE
    WHEN v_reserva.tipo = 'grupal' THEN v_reserva.horas * p_factor_grupal
    ELSE v_reserva.horas
  END;

  v_con_costo := (
    (v_reserva.fecha::TEXT || ' ' || v_reserva.hora)::TIMESTAMP
      AT TIME ZONE 'America/Argentina/Buenos_Aires'
    - NOW()
  ) < INTERVAL '24 hours';

  IF v_con_costo THEN
    v_devolver := ROUND(v_horas_orig * (1.0 - p_penalizacion_pct / 100.0), 2);
  ELSE
    v_devolver := v_horas_orig;
  END IF;

  UPDATE reservas
  SET estado = 'cancelada', marcada_en = NOW()
  WHERE id = p_reserva_id;

  UPDATE alumnos
  SET saldo = saldo + v_devolver
  WHERE id = v_reserva.alumno_id
  RETURNING saldo INTO v_saldo;

  RETURN QUERY SELECT v_saldo, v_devolver;
END;
$function$;

-- 3. Restaurar grants (idénticos a los que tenía la versión uuid)
GRANT EXECUTE ON FUNCTION public.devolver_horas(bigint, numeric, numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.devolver_horas(bigint, numeric, numeric) TO authenticated;

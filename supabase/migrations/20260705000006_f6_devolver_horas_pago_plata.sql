-- ============================================================
-- F6 ETAPA 2c: devolver_horas — 3 casos según origen del pago
--
-- Antes (migración 003): v_horas_orig := v_reserva.costo_saldo siempre.
-- Ahora:
--   a) costo_saldo > 0  → pagada con SALDO: devuelve costo_saldo × política. Sin cambio.
--   b) costo_saldo = 0 AND payment_id IS NOT NULL → pagada con PLATA:
--      devuelve v_reserva.horas como saldo individual (sin refund MP).
--   c) costo_saldo = 0 AND payment_id IS NULL → pendiente_pago sin pagar: devuelve 0.
--
-- Resto intacto: lock FOR UPDATE, autorización, idempotencia, regla 24hs.
-- CREATE OR REPLACE misma firma → grants se re-aplican al final.
-- ============================================================

CREATE OR REPLACE FUNCTION public.devolver_horas(
  p_reserva_id       bigint,
  p_factor_grupal    numeric DEFAULT 0.8,
  p_penalizacion_pct numeric DEFAULT 50
) RETURNS TABLE(saldo_nuevo numeric, horas_devueltas numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_reserva    RECORD;
  v_horas_orig NUMERIC;
  v_devolver   NUMERIC;
  v_con_costo  BOOLEAN;
  v_saldo      NUMERIC;
BEGIN
  SELECT * INTO v_reserva FROM reservas WHERE id = p_reserva_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_reserva_id;
  END IF;

  IF v_reserva.alumno_id != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_reserva.estado NOT IN ('confirmada', 'pendiente', 'pendiente_pago') THEN
    RAISE EXCEPTION 'La reserva ya está en estado "%": no se puede cancelar.', v_reserva.estado;
  END IF;

  -- Base de devolución según origen del pago:
  IF v_reserva.costo_saldo > 0 THEN
    -- (a) Pagada con saldo: devolvé exactamente lo que se descontó.
    v_horas_orig := v_reserva.costo_saldo;
  ELSIF v_reserva.payment_id IS NOT NULL THEN
    -- (b) Pagada con plata (confirmada vía webhook): devolución en saldo individual
    --     = horas reales de la clase. NUNCA refund a tarjeta (ese camino es solo para huérfanos).
    v_horas_orig := v_reserva.horas;
  ELSE
    -- (c) pendiente_pago sin pagar todavía: nada que devolver al saldo.
    v_horas_orig := 0;
  END IF;

  -- Regla 24hs: clase en menos de 24hs → aplica penalización
  v_con_costo := (
    (v_reserva.fecha::TEXT || ' ' || v_reserva.hora)::TIMESTAMP
      AT TIME ZONE 'America/Argentina/Buenos_Aires'
    - NOW()
  ) < INTERVAL '24 hours';

  v_devolver := CASE
    WHEN v_con_costo THEN ROUND(v_horas_orig * (1.0 - p_penalizacion_pct / 100.0), 2)
    ELSE v_horas_orig
  END;

  UPDATE reservas SET estado = 'cancelada', marcada_en = NOW() WHERE id = p_reserva_id;

  UPDATE alumnos SET saldo = saldo + v_devolver
  WHERE id = v_reserva.alumno_id RETURNING saldo INTO v_saldo;

  RETURN QUERY SELECT v_saldo, v_devolver;
END;
$$;

GRANT EXECUTE ON FUNCTION public.devolver_horas(bigint, numeric, numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.devolver_horas(bigint, numeric, numeric) TO authenticated;

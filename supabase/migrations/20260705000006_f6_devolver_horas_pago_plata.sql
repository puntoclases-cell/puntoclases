-- ============================================================
-- F6 ETAPA 2c: devolver_horas — 4 casos según origen y tipo del pago
--
-- Antes (migración 003): v_horas_orig := v_reserva.costo_saldo siempre.
-- Ahora:
--   a)  costo_saldo > 0                              → pagada con SALDO: devuelve costo_saldo × política.
--   b1) costo_saldo = 0, payment_id NOT NULL, individual → devuelve horas reales como saldo.
--   b2) costo_saldo = 0, payment_id NOT NULL, grupal → NO reembolsa (el alumno reprograma).
--   c)  costo_saldo = 0, payment_id IS NULL          → pendiente_pago sin pagar: devuelve 0.
--
-- Decisión de negocio: grupal pagada con plata no se reembolsa → se reprograma.
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

  -- Base de devolución según origen y tipo del pago:
  IF v_reserva.costo_saldo > 0 THEN
    v_horas_orig := v_reserva.costo_saldo;            -- (a) pagada con saldo
  ELSIF v_reserva.payment_id IS NOT NULL THEN
    IF v_reserva.tipo = 'grupal' THEN
      v_horas_orig := 0;                              -- (b2) grupal pagada: no reembolsa, se reprograma
    ELSE
      v_horas_orig := v_reserva.horas;                -- (b1) individual pagada con plata: saldo individual
    END IF;
  ELSE
    v_horas_orig := 0;                                -- (c) pendiente_pago sin pagar
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

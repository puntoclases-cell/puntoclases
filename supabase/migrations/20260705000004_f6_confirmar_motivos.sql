-- ============================================================
-- F6 ETAPA 2a: confirmar_reserva_pago — motivos específicos
-- Reemplaza 'expirada_pago_tardio' por strings que el webhook
-- puede mapear directamente a pagos_huerfanos.motivo.
-- CREATE OR REPLACE: misma firma, grants se re-aplican al final.
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirmar_reserva_pago(
  p_reserva_id bigint,
  p_payment_id text
) RETURNS text   -- 'confirmada' | 'ya_confirmada' | 'ttl_expirado' | 'cupo_excedido' | 'cancelada'
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_reserva    RECORD;
  v_inscriptos int;
  v_cupo_max   int;
BEGIN
  SELECT * INTO v_reserva FROM reservas WHERE id = p_reserva_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva % no encontrada', p_reserva_id;
  END IF;

  -- Idempotencia: ya confirmada
  IF v_reserva.estado = 'confirmada' THEN
    RETURN 'ya_confirmada';
  END IF;

  -- Idempotencia: mismo payment_id (webhook duplicado de MP)
  IF v_reserva.payment_id IS NOT NULL AND v_reserva.payment_id = p_payment_id THEN
    RETURN 'ya_confirmada';
  END IF;

  -- El alumno canceló entre el pago y la confirmación
  IF v_reserva.estado = 'cancelada' THEN
    RETURN 'cancelada';
  END IF;

  -- TTL vencido (lazy o explícito)
  IF v_reserva.estado = 'expirada'
     OR (v_reserva.expira_en IS NOT NULL AND v_reserva.expira_en < now()) THEN
    RETURN 'ttl_expirado';
  END IF;

  IF v_reserva.estado != 'pendiente_pago' THEN
    RAISE EXCEPTION 'Estado inesperado para confirmar_reserva_pago: %', v_reserva.estado;
  END IF;

  -- Doble capa (b): revalidar cupo grupal bajo el FOR UPDATE
  IF v_reserva.tipo = 'grupal' AND v_reserva.grupo_id IS NOT NULL THEN
    SELECT g.cupo_max INTO v_cupo_max
    FROM grupos g WHERE g.id = v_reserva.grupo_id FOR UPDATE;

    SELECT count(*) INTO v_inscriptos
    FROM reservas
    WHERE grupo_id = v_reserva.grupo_id
      AND estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
      AND (expira_en IS NULL OR expira_en > now())
      AND id != p_reserva_id;

    IF v_inscriptos >= v_cupo_max THEN
      UPDATE reservas SET estado = 'cancelada', marcada_en = now() WHERE id = p_reserva_id;
      RETURN 'cupo_excedido';
    END IF;
  END IF;

  -- Confirmar
  UPDATE reservas
  SET estado     = 'confirmada',
      payment_id = p_payment_id,
      expira_en  = NULL,
      marcada_en = now()
  WHERE id = p_reserva_id;

  RETURN 'confirmada';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirmar_reserva_pago(bigint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.confirmar_reserva_pago(bigint, text) TO service_role;

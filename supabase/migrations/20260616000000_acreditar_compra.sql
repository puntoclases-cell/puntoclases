-- Captura la definición live de acreditar_compra para que db push no la pise.
-- SECURITY DEFINER: corre como postgres, bypasea el check de auth.uid() desde service_role.
-- Idempotente: ON CONFLICT (payment_id) DO NOTHING.
CREATE OR REPLACE FUNCTION public.acreditar_compra(
  p_alumno_id  uuid,
  p_horas      numeric,
  p_precio     numeric,
  p_payment_id text,
  p_pack_id    uuid DEFAULT NULL::uuid
)
RETURNS TABLE(compra_id bigint, saldo_nuevo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_compra_id BIGINT;
  v_saldo     NUMERIC;
BEGIN
  IF p_alumno_id != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  INSERT INTO compras (alumno_id, horas, monto, metodo, pack_id, estado_pago, payment_id)
  VALUES (p_alumno_id, p_horas, p_precio, 'mercadopago', p_pack_id::text, 'aprobado', p_payment_id)
  ON CONFLICT (payment_id) DO NOTHING
  RETURNING id INTO v_compra_id;

  IF v_compra_id IS NULL THEN
    SELECT saldo INTO v_saldo FROM alumnos WHERE id = p_alumno_id;
    RETURN QUERY SELECT NULL::BIGINT, v_saldo;
    RETURN;
  END IF;

  UPDATE alumnos
     SET saldo = saldo + p_horas
   WHERE id = p_alumno_id
  RETURNING saldo INTO v_saldo;

  RETURN QUERY SELECT v_compra_id, v_saldo;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.acreditar_compra TO service_role;

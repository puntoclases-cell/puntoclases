-- Regla de negocio: horas vencidas con saldo >= 0.8 hs → se pierden (saldo=0).
-- Horas vencidas con saldo < 0.8 hs → se conservan (remanente no reservable).
-- Backup previo: backups/alumnos_20260617.csv

-- 1. One-time: limpiar datos existentes con vencimiento ya vencido
UPDATE alumnos
   SET saldo = 0
 WHERE vencimiento IS NOT NULL
   AND vencimiento < CURRENT_DATE
   AND saldo >= 0.8;

-- 2. acreditar_compra: aplicar umbral al recargar horas
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

  -- Umbral 0.8: si las horas vencieron y el saldo era >= 0.8, se pierde.
  -- Si era < 0.8 (remanente no reservable), se suma a las nuevas horas.
  UPDATE alumnos
     SET saldo = CASE
                   WHEN vencimiento IS NOT NULL
                    AND CURRENT_DATE > vencimiento
                    AND saldo >= 0.8
                   THEN p_horas
                   ELSE saldo + p_horas
                 END,
         vencimiento = CURRENT_DATE + (SELECT vencimiento_dias FROM config WHERE id = 1) * INTERVAL '1 day'
   WHERE id = p_alumno_id
  RETURNING saldo INTO v_saldo;

  RETURN QUERY SELECT v_compra_id, v_saldo;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.acreditar_compra TO service_role;

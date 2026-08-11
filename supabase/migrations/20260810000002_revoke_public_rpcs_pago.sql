-- ════════════════════════════════════════════════════════════════════════════
-- Cierre urgente: 3 RPCs de dinero invocables sin login (docs/auditoria-2026-08.md §7).
-- Confirmado en ROLLBACK contra prod: acreditar_compra/aprobar_compra/
-- registrar_compra_pendiente tenían EXECUTE otorgado a PUBLIC (default de
-- Postgres al crear una función, nunca revocado) — cualquiera con la anon key
-- pública podía acreditarse saldo falso sin pasar por Mercado Pago.
--
-- aprobar_compra y registrar_compra_pendiente nunca estuvieron en una
-- migración versionada (se crearon fuera de git) — se versionan acá por
-- primera vez con CREATE OR REPLACE de su definición real en prod, sin
-- cambiarles ni una línea de lógica. Solo se toca el GRANT/REVOKE.
--
-- Único caller legítimo verificado (grep en todo el repo): api/mp-webhook.js
-- y api/crear-preferencia-pack.js vía `pg`/DATABASE_URL (rol `postgres`), más
-- la Edge Function vieja (rollback) vía SUPABASE_SERVICE_ROLE_KEY. Ninguno de
-- los dos depende de PUBLIC/anon/authenticated — este REVOKE no les toca nada.
-- ════════════════════════════════════════════════════════════════════════════

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

CREATE OR REPLACE FUNCTION public.aprobar_compra(
  p_compra_id  bigint,
  p_payment_id text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_compra RECORD;
  v_saldo  NUMERIC;
BEGIN
  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra % no encontrada', p_compra_id;
  END IF;

  IF v_compra.estado_pago = 'aprobado' THEN
    SELECT saldo INTO v_saldo FROM alumnos WHERE id = v_compra.alumno_id;
    RETURN v_saldo;
  END IF;

  UPDATE compras
     SET payment_id  = p_payment_id,
         estado_pago = 'aprobado'
   WHERE id = p_compra_id;

  UPDATE alumnos
     SET saldo = CASE
                   WHEN vencimiento IS NOT NULL
                    AND CURRENT_DATE > vencimiento
                    AND saldo >= 0.8
                   THEN v_compra.horas
                   ELSE saldo + v_compra.horas
                 END,
         vencimiento = CURRENT_DATE
                       + (SELECT vencimiento_dias FROM config WHERE id = 1) * INTERVAL '1 day'
   WHERE id = v_compra.alumno_id
  RETURNING saldo INTO v_saldo;

  RETURN v_saldo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_compra_pendiente(
  p_alumno_id uuid,
  p_horas     numeric,
  p_precio    numeric,
  p_pack_id   text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO compras (alumno_id, horas, monto, pack_id, estado_pago, metodo)
  VALUES (p_alumno_id, p_horas, p_precio::integer, p_pack_id, 'pendiente', 'mercadopago')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Redeclarar el GRANT a service_role explícito (ya lo tenían, pero quedaba
-- fuera de git para 2 de las 3 — esto las deja reproducibles desde acá).
GRANT EXECUTE ON FUNCTION public.acreditar_compra(uuid, numeric, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_compra(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_compra_pendiente(uuid, numeric, numeric, text) TO service_role;

-- El cierre real: saca el EXECUTE que Postgres otorga a PUBLIC por defecto al
-- crear una función (nunca se había revocado). Como `authenticated`/`anon` no
-- tienen ningún GRANT propio sobre estas 3 (confirmado en la auditoría —
-- ver information_schema.routine_privileges), este REVOKE de PUBLIC ya los
-- deja sin acceso a los dos por completo, sin necesidad de nombrarlos aparte.
-- Se los nombra explícito igual, por las dudas y para que quede documentado.
REVOKE EXECUTE ON FUNCTION public.acreditar_compra(uuid, numeric, numeric, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aprobar_compra(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_compra_pendiente(uuid, numeric, numeric, text) FROM PUBLIC, anon;

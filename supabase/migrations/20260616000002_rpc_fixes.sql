-- crear_reserva: agregar validación de fecha pasada y vencimiento de horas.
CREATE OR REPLACE FUNCTION public.crear_reserva(
  p_profe_id      uuid,
  p_materia       text,
  p_fecha         date,
  p_hora          text,
  p_horas         numeric,
  p_modalidad     modalidad_clase,
  p_tipo          tipo_clase,
  p_alumnos_grupo integer,
  p_necesidad     text
)
RETURNS reservas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_alumno      uuid    := auth.uid();
  v_cfg         config;
  v_costo       numeric;
  v_saldo       numeric;
  v_vencimiento date;
  v_monto       int;
  v_reserva     reservas;
begin
  -- No se puede reservar en fechas pasadas
  if p_fecha < CURRENT_DATE then
    raise exception 'No podés reservar en una fecha pasada.';
  end if;

  select * into v_cfg from config where id = 1;
  v_costo := case when p_tipo = 'grupal' then v_cfg.factor_grupal else 1 end * p_horas;

  select saldo, vencimiento
    into v_saldo, v_vencimiento
    from alumnos
   where id = v_alumno
     for update;

  -- Las horas vencidas no son usables
  if v_vencimiento is not null and CURRENT_DATE > v_vencimiento then
    raise exception 'Tus horas vencieron el %. Comprá más horas para seguir reservando.', to_char(v_vencimiento, 'DD/MM/YYYY');
  end if;

  if v_saldo < v_costo then
    raise exception 'Saldo insuficiente: cuesta % hs y tenés % hs', v_costo, v_saldo;
  end if;

  v_monto := round(
    (case when p_tipo = 'grupal' then v_cfg.precio_ind * v_cfg.factor_grupal else v_cfg.precio_ind end)
    * p_horas * coalesce(p_alumnos_grupo, 1)
  );

  update alumnos set saldo = saldo - v_costo where id = v_alumno;

  insert into reservas (alumno_id, profe_id, materia, fecha, hora, horas, modalidad, tipo, alumnos_grupo, estado, costo_saldo, monto, necesidad)
  values (v_alumno, p_profe_id, p_materia, p_fecha, p_hora, p_horas, p_modalidad, p_tipo, p_alumnos_grupo, 'pendiente', v_costo, v_monto, p_necesidad)
  returning * into v_reserva;

  return v_reserva;
end;
$function$;


-- acreditar_compra: renovar vencimiento de horas al comprar.
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
     SET saldo      = saldo + p_horas,
         vencimiento = CURRENT_DATE + (SELECT vencimiento_dias FROM config WHERE id = 1) * INTERVAL '1 day'
   WHERE id = p_alumno_id
  RETURNING saldo INTO v_saldo;

  RETURN QUERY SELECT v_compra_id, v_saldo;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.acreditar_compra TO service_role;

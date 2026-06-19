-- crear_reserva: agrega overlap check para soporte de duración variable.
-- Bloquea INSERT si [p_hora, p_hora+p_horas) se superpone con cualquier reserva
-- pendiente/confirmada del mismo profe en la misma fecha.
-- CREATE OR REPLACE: aditivo, no toca datos ni schema existentes.
-- El campo `horas` ya existía (NUMERIC); antes siempre se pasaba 1.
-- Ahora se pueden pasar valores como 0.5, 1.0, 1.5, 2.0, etc.
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
  if p_fecha < CURRENT_DATE then
    raise exception 'No podés reservar en una fecha pasada.';
  end if;

  -- Overlap check: ningún slot del rango [p_hora, p_hora+p_horas) puede pisar
  -- una reserva existente pendiente/confirmada del mismo profe en la misma fecha.
  -- Condición de solapamiento: existing_start < proposed_end AND existing_end > proposed_start
  if exists (
    select 1 from reservas r
    where r.profe_id = p_profe_id
      and r.fecha    = p_fecha
      and r.estado   in ('confirmada', 'pendiente')
      and r.hora::time < (p_hora::time + p_horas * interval '1 hour')
      and (r.hora::time + r.horas * interval '1 hour') > p_hora::time
  ) then
    raise exception 'Ya hay una reserva en ese horario. Elegí otro bloque.';
  end if;

  select * into v_cfg from config where id = 1;
  v_costo := case when p_tipo = 'grupal' then v_cfg.factor_grupal else 1 end * p_horas;

  select saldo, vencimiento
    into v_saldo, v_vencimiento
    from alumnos
   where id = v_alumno
     for update;

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

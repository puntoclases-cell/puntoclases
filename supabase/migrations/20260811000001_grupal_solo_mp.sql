-- ════════════════════════════════════════════════════════════════════════════
-- Cambio de regla de negocio (2026-08-11): las clases grupales dejan de
-- poder pagarse con saldo. Grupal = SIEMPRE pago directo por Mercado Pago.
-- Saldo/horas quedan exclusivas para individuales. Rige solo para reservas
-- NUEVAS de acá en adelante — no se toca ninguna reserva grupal ya
-- confirmada con saldo (quedan con su costo_saldo histórico intacto,
-- devolver_horas ya las trata bien por esa columna).
--
-- Precio sin cambios: grupal sigue costando 20% menos ($16.000 en vez de
-- $20.000) — antes era "0.8hs de saldo", ahora es "$16.000 por MP".
--
-- Auditoría antes de tocar nada: crear_reserva_pendiente_pago (camino MP)
-- YA es grupal-solo-MP de origen, sin cambios. confirmar_reserva_pago,
-- reprogramar_reserva_alumno y devolver_horas no tocan saldo distinguiendo
-- por tipo de forma que haga falta cambiarlas — devolver_horas ya separa
-- por costo_saldo/payment_id/tipo, la rama grupal-pagada-con-plata
-- (no reembolsa, se reprograma) ya es la correcta para el mundo nuevo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.crear_reserva(p_profe_id uuid, p_materia text, p_fecha date, p_hora text, p_horas numeric, p_modalidad modalidad_clase, p_tipo tipo_clase, p_alumnos_grupo integer, p_necesidad text)
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

  -- Regla nueva 2026-08-11: grupal ya no se paga con saldo, siempre por MP
  -- (crear_reserva_pendiente_pago). No es solo un chequeo de front — acá
  -- se corta de raíz para que no dependa de que nadie llame esta función
  -- con p_tipo='grupal' por error o a propósito.
  if p_tipo = 'grupal' then
    raise exception 'Las clases grupales se pagan siempre por Mercado Pago — no se pueden reservar con saldo.';
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

-- unirse_grupo: existía exclusivamente para unirse a un grupo pagando con
-- saldo. Confirmado por grep antes de tocar nada: cero call sites vivos en
-- el front (el único lugar que la llamaba está dentro de una rama que ya
-- era código muerto — el botón que la dispara está oculto para grupal desde
-- una sesión anterior). Con la regla nueva no tiene ningún uso legítimo que
-- le quede. Se deja como stub que rechaza explícito (CREATE OR REPLACE,
-- reversible) en vez de DROPearla — no se toca lo que ya devuelve, solo se
-- corta el cuerpo real.
CREATE OR REPLACE FUNCTION public.unirse_grupo(p_profe_id uuid, p_materia text, p_fecha date, p_hora text, p_horas numeric, p_modalidad modalidad_clase, p_necesidad text DEFAULT NULL::text)
 RETURNS reservas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Las clases grupales ahora se pagan siempre por Mercado Pago — usá crear_reserva_pendiente_pago.';
END;
$function$;

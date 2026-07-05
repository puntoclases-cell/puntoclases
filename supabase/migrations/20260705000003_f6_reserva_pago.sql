-- ============================================================
-- F6 ETAPA 1 — Parte 2: columnas, índices, RPCs
-- PREREQUISITO: 20260705000002_f6_enum_states.sql aplicada y commiteada.
-- Additive: ADD COLUMN, CREATE TABLE, DROP+CREATE INDEX (sin datos),
--           CREATE OR REPLACE FUNCTION (2 updates + 2 nuevas).
-- ============================================================


-- ── 1. Nuevas columnas en reservas ───────────────────────────
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS expira_en  timestamptz;
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS payment_id text;


-- ── 2. Tabla de pagos huérfanos ───────────────────────────────
-- Registra pagos aprobados por MP que no se pudieron acreditar
-- (TTL vencido, cupo excedido, reserva cancelada). Para reembolso manual.
CREATE TABLE IF NOT EXISTS public.pagos_huerfanos (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  payment_id  text        NOT NULL,
  reserva_id  bigint      REFERENCES public.reservas(id),
  monto_ars   integer,
  motivo      text        NOT NULL,  -- 'ttl_expirado' | 'cupo_excedido' | 'cancelada' | 'desconocido'
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pagos_huerfanos_payment_id_idx
  ON public.pagos_huerfanos (payment_id);

ALTER TABLE public.pagos_huerfanos ENABLE ROW LEVEL SECURITY;
-- Sin policies: service_role bypassa RLS; anon/authenticated queda bloqueado.

GRANT INSERT, SELECT ON public.pagos_huerfanos TO service_role;


-- ── 3. Reconstruir índices únicos incluyendo 'pendiente_pago' ─
-- DROP sin pérdida de datos; advisory lock + lazy expiry en RPCs cubren
-- la ventana breve entre DROP y CREATE.

DROP INDEX IF EXISTS public.reservas_profe_fecha_hora_ind_activa_idx;
CREATE UNIQUE INDEX reservas_profe_fecha_hora_ind_activa_idx
  ON public.reservas (profe_id, fecha, hora)
  WHERE tipo   = 'individual'
    AND estado IN ('confirmada', 'pendiente', 'pendiente_pago');

DROP INDEX IF EXISTS public.reservas_alumno_grupo_activa_idx;
CREATE UNIQUE INDEX reservas_alumno_grupo_activa_idx
  ON public.reservas (alumno_id, grupo_id)
  WHERE grupo_id IS NOT NULL
    AND estado   IN ('confirmada', 'pendiente', 'pendiente_pago');


-- ── 4. crear_reserva — overlap check actualizado ─────────────
-- Cambio: el IN del overlap incluye ahora 'pendiente_pago' con filtro de expiración.
-- El resto es idéntico a F5. CREATE OR REPLACE preserva los GRANTs existentes.
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
) RETURNS reservas LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_alumno      uuid    := auth.uid();
  v_cfg         config;
  v_costo       numeric;
  v_saldo       numeric;
  v_vencimiento date;
  v_monto       int;
  v_reserva     reservas;
BEGIN
  IF p_fecha < CURRENT_DATE THEN
    RAISE EXCEPTION 'No podés reservar en una fecha pasada.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_profe_id::text || '|' || p_fecha::text || '|' || p_hora)
  );

  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.profe_id = p_profe_id
      AND r.fecha    = p_fecha
      AND r.estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
      AND (r.expira_en IS NULL OR r.expira_en > now())
      AND r.hora::time < (p_hora::time + p_horas * interval '1 hour')
      AND (r.hora::time + r.horas * interval '1 hour') > p_hora::time
  ) THEN
    RAISE EXCEPTION 'Ya hay una reserva en ese horario. Elegí otro bloque.';
  END IF;

  SELECT * INTO v_cfg FROM config WHERE id = 1;
  v_costo := CASE WHEN p_tipo = 'grupal' THEN v_cfg.factor_grupal ELSE 1 END * p_horas;

  SELECT saldo, vencimiento
    INTO v_saldo, v_vencimiento
    FROM alumnos
   WHERE id = v_alumno
     FOR UPDATE;

  IF v_vencimiento IS NOT NULL AND CURRENT_DATE > v_vencimiento THEN
    RAISE EXCEPTION 'Tus horas vencieron el %. Comprá más horas para seguir reservando.',
      to_char(v_vencimiento, 'DD/MM/YYYY');
  END IF;

  IF v_saldo < v_costo THEN
    RAISE EXCEPTION 'Saldo insuficiente: cuesta % hs y tenés % hs', v_costo, v_saldo;
  END IF;

  v_monto := round(
    (CASE WHEN p_tipo = 'grupal' THEN v_cfg.precio_ind * v_cfg.factor_grupal
          ELSE v_cfg.precio_ind END)
    * p_horas * coalesce(p_alumnos_grupo, 1)
  );

  UPDATE alumnos SET saldo = saldo - v_costo WHERE id = v_alumno;

  INSERT INTO reservas (alumno_id, profe_id, materia, fecha, hora, horas,
                        modalidad, tipo, alumnos_grupo, estado, costo_saldo, monto, necesidad)
  VALUES (v_alumno, p_profe_id, p_materia, p_fecha, p_hora, p_horas,
          p_modalidad, p_tipo, p_alumnos_grupo, 'pendiente', v_costo, v_monto, p_necesidad)
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;


-- ── 5. get_grupo_info — contar pendiente_pago no expiradas ───
CREATE OR REPLACE FUNCTION public.get_grupo_info(
  p_profe_id uuid,
  p_fecha    date,
  p_hora     text
) RETURNS TABLE (inscriptos_en_vivo int, cupo_max int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY
    SELECT
      (SELECT count(*)::int
         FROM reservas r
         WHERE r.grupo_id = g.id
           AND r.estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
           AND (r.expira_en IS NULL OR r.expira_en > now())),
      g.cupo_max
    FROM grupos g
    WHERE g.profe_id = p_profe_id
      AND g.fecha    = p_fecha
      AND g.hora     = p_hora
      AND g.estado   = 'abierto'
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_grupo_info TO PUBLIC;


-- ── 6. devolver_horas — agregar pendiente_pago + base costo_saldo ─
-- costo_saldo = 0 en pago-por-clase → devuelve 0 al saldo (correcto).
-- p_factor_grupal se conserva en la firma por compatibilidad; ya no se usa en el cuerpo.
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

  -- costo_saldo = horas descontadas del saldo en flujo-saldo (ej: 0.8 grupal, 1 individual).
  -- costo_saldo = 0 en flujo pago-por-clase → devolución = 0, no se toca el saldo.
  v_horas_orig := v_reserva.costo_saldo;

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


-- ── 7. crear_reserva_pendiente_pago ──────────────────────────
-- Nuevo flujo pago-por-clase. NO toca saldo.
-- Retiene el slot 30 min (TTL). Devuelve { reserva_id, monto_ars }.
-- Lazy expiry: antes del INSERT limpia las pendiente_pago vencidas del mismo slot.
CREATE OR REPLACE FUNCTION public.crear_reserva_pendiente_pago(
  p_profe_id  uuid,
  p_materia   text,
  p_fecha     date,
  p_hora      text,
  p_horas     numeric,
  p_modalidad modalidad_clase,
  p_tipo      tipo_clase,
  p_necesidad text DEFAULT NULL
) RETURNS TABLE(reserva_id bigint, monto_ars integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_alumno     uuid        := auth.uid();
  v_cfg        config;
  v_monto      integer;
  v_grupo      grupos;
  v_grupo_id   bigint      := NULL;
  v_inscriptos int;
  v_rid        bigint;
  v_expira     timestamptz := now() + INTERVAL '30 minutes';
BEGIN
  IF p_fecha < CURRENT_DATE THEN
    RAISE EXCEPTION 'No podés reservar en una fecha pasada.';
  END IF;

  -- Advisory lock: mismo hashtext que crear_reserva y unirse_grupo → mutua exclusión total en el slot
  PERFORM pg_advisory_xact_lock(
    hashtext(p_profe_id::text || '|' || p_fecha::text || '|' || p_hora)
  );

  SELECT * INTO v_cfg FROM config WHERE id = 1;

  -- Lazy expiry: libera del índice único (reservas_profe_fecha_hora_ind_activa_idx)
  -- las filas pendiente_pago vencidas del mismo slot. Seguro bajo el advisory lock.
  UPDATE reservas
  SET estado = 'expirada'
  WHERE profe_id  = p_profe_id
    AND fecha     = p_fecha
    AND hora      = p_hora
    AND estado    = 'pendiente_pago'
    AND expira_en IS NOT NULL
    AND expira_en < now();

  -- ── INDIVIDUAL ────────────────────────────────────────────
  IF p_tipo = 'individual' THEN
    IF EXISTS (
      SELECT 1 FROM reservas r
      WHERE r.profe_id = p_profe_id
        AND r.fecha    = p_fecha
        AND r.estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
        AND (r.expira_en IS NULL OR r.expira_en > now())
        AND r.hora::time < (p_hora::time + p_horas * interval '1 hour')
        AND (r.hora::time + r.horas * interval '1 hour') > p_hora::time
    ) THEN
      RAISE EXCEPTION 'Ya hay una reserva en ese horario. Elegí otro bloque.';
    END IF;

    v_monto := round(v_cfg.precio_ind * p_horas)::integer;

  -- ── GRUPAL ────────────────────────────────────────────────
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM disponibilidad
      WHERE profe_id = p_profe_id
        AND fecha    = p_fecha
        AND hora     = p_hora
        AND tipo     IN ('grupal', 'ambas')
    ) THEN
      RAISE EXCEPTION 'Ese horario no está habilitado para clases grupales.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM reservas r
      WHERE r.profe_id = p_profe_id
        AND r.fecha    = p_fecha
        AND r.tipo     = 'individual'
        AND r.estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
        AND (r.expira_en IS NULL OR r.expira_en > now())
        AND r.hora::time < (p_hora::time + p_horas * interval '1 hour')
        AND (r.hora::time + r.horas * interval '1 hour') > p_hora::time
    ) THEN
      RAISE EXCEPTION 'El profe tiene una clase individual en ese horario.';
    END IF;

    -- Buscar o crear grupo (join-or-create atómico, igual que unirse_grupo)
    BEGIN
      SELECT * INTO v_grupo
      FROM grupos
      WHERE profe_id = p_profe_id
        AND fecha    = p_fecha
        AND hora     = p_hora
        AND estado   = 'abierto'
      FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO grupos (profe_id, materia, fecha, hora, horas, modalidad, cupo_max, estado)
        VALUES (p_profe_id, p_materia, p_fecha, p_hora, p_horas, p_modalidad,
                v_cfg.cupo_grupal, 'abierto')
        RETURNING * INTO v_grupo;
      END IF;

    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_grupo
      FROM grupos
      WHERE profe_id = p_profe_id AND fecha = p_fecha AND hora = p_hora AND estado = 'abierto'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo obtener el grupo. Intentá de nuevo.';
      END IF;
    END;

    v_grupo_id := v_grupo.id;

    -- Lazy expiry para reservas_alumno_grupo_activa_idx: limpiar fila previa del alumno en este grupo
    UPDATE reservas
    SET estado = 'expirada'
    WHERE grupo_id  = v_grupo_id
      AND alumno_id = v_alumno
      AND estado    = 'pendiente_pago'
      AND expira_en IS NOT NULL
      AND expira_en < now();

    -- Cupo: doble capa (a) — contar todas las reservas activas incluyendo pendiente_pago no expiradas
    SELECT count(*) INTO v_inscriptos
    FROM reservas
    WHERE grupo_id = v_grupo_id
      AND estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
      AND (expira_en IS NULL OR expira_en > now());

    IF v_inscriptos >= v_grupo.cupo_max THEN
      RAISE EXCEPTION 'El grupo está lleno (% de % lugares).', v_inscriptos, v_grupo.cupo_max;
    END IF;

    IF EXISTS (
      SELECT 1 FROM reservas
      WHERE grupo_id  = v_grupo_id
        AND alumno_id = v_alumno
        AND estado    IN ('confirmada', 'pendiente', 'pendiente_pago')
        AND (expira_en IS NULL OR expira_en > now())
    ) THEN
      RAISE EXCEPTION 'Ya estás anotado en este grupo.';
    END IF;

    v_monto := round(v_cfg.precio_ind * v_cfg.factor_grupal * p_horas)::integer;
  END IF;

  -- Insertar reserva pendiente_pago (costo_saldo = 0: no toca saldo)
  INSERT INTO reservas (alumno_id, profe_id, materia, fecha, hora, horas,
                        modalidad, tipo, grupo_id, estado, costo_saldo, monto, necesidad, expira_en)
  VALUES (v_alumno, p_profe_id, p_materia, p_fecha, p_hora, p_horas,
          p_modalidad, p_tipo, v_grupo_id, 'pendiente_pago', 0, v_monto, p_necesidad, v_expira)
  RETURNING id INTO v_rid;

  RETURN QUERY SELECT v_rid, v_monto;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_reserva_pendiente_pago TO PUBLIC;


-- ── 8. confirmar_reserva_pago ─────────────────────────────────
-- Llamada por mp-webhook (service_role). Idempotente vía FOR UPDATE.
-- Retorna texto para que el webhook decida: 200 ok vs 200 + pagos_huerfanos vs 500.
CREATE OR REPLACE FUNCTION public.confirmar_reserva_pago(
  p_reserva_id bigint,
  p_payment_id text
) RETURNS text   -- 'confirmada' | 'ya_confirmada' | 'expirada_pago_tardio'
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

  -- Idempotencia: ya confirmada (cualquier causa)
  IF v_reserva.estado = 'confirmada' THEN
    RETURN 'ya_confirmada';
  END IF;

  -- Idempotencia: mismo payment_id ya procesado (webhook duplicado de MP)
  IF v_reserva.payment_id IS NOT NULL AND v_reserva.payment_id = p_payment_id THEN
    RETURN 'ya_confirmada';
  END IF;

  -- Alumno canceló antes de pagar → pago tardío huérfano (retornar 200, no 500)
  IF v_reserva.estado = 'cancelada' THEN
    RETURN 'expirada_pago_tardio';
  END IF;

  -- TTL vencido: reserva lazy-marcada como expirada o expiración real
  IF v_reserva.estado = 'expirada'
     OR (v_reserva.expira_en IS NOT NULL AND v_reserva.expira_en < now()) THEN
    RETURN 'expirada_pago_tardio';
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
      -- Cupo lleno al confirmar: cancelar y loggear como huérfano para reembolso manual
      UPDATE reservas SET estado = 'cancelada', marcada_en = now() WHERE id = p_reserva_id;
      RETURN 'expirada_pago_tardio';
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

-- Solo el webhook (service_role) puede llamar a esta función.
REVOKE EXECUTE ON FUNCTION public.confirmar_reserva_pago(bigint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.confirmar_reserva_pago(bigint, text) TO service_role;

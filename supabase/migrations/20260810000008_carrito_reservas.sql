-- ════════════════════════════════════════════════════════════════════════════
-- FASE C (overnight 2026-08-10, rama feature/carrito — NO APLICADA A PROD,
-- queda para revisión antes de mergear). Carrito de reservas múltiples.
--
-- Los ítems que van a Mercado Pago comparten un carrito_id — el webhook,
-- al recibir el pago aprobado, confirma todas las reservas de ese carrito_id
-- que sigan en pendiente_pago, reusando confirmar_reserva_pago tal cual
-- (sin reescribirla) en un loop.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS carrito_id uuid NULL;

-- Búsqueda del webhook al confirmar un carrito: todas las reservas de ese
-- carrito_id. Parcial (solo donde no es NULL) porque la inmensa mayoría de
-- las reservas no tienen carrito_id (compra suelta o pago con saldo).
CREATE INDEX IF NOT EXISTS idx_reservas_carrito_id
  ON public.reservas (carrito_id)
  WHERE carrito_id IS NOT NULL;

-- crear_reserva_pendiente_pago: se agrega p_carrito_id opcional (DEFAULT NULL)
-- al final de la firma. OJO: CREATE OR REPLACE con un parámetro nuevo NO
-- reemplaza la función vieja — Postgres la trata como una sobrecarga distinta
-- (firma con distinta cantidad de args), y una llamada sin p_carrito_id queda
-- AMBIGUA entre las dos ("is not unique"), rompiendo el caller existente.
-- Confirmado con ROLLBACK test antes de darme cuenta y agregar este DROP.
-- Por eso hace falta un DROP FUNCTION explícito de la firma vieja primero,
-- así solo queda la nueva (con default = compatible hacia atrás de verdad).
-- El flujo de UNA clase por MP (api/crear-preferencia-reserva.js) sigue sin
-- pasar p_carrito_id por ahora — ver nota en docs/overnight-2026-08-10.md
-- sobre si conviene que también adopte carrito_id con un solo ítem.
DROP FUNCTION IF EXISTS public.crear_reserva_pendiente_pago(
  uuid, text, date, text, numeric, modalidad_clase, tipo_clase, text
);

CREATE OR REPLACE FUNCTION public.crear_reserva_pendiente_pago(
  p_profe_id   uuid,
  p_materia    text,
  p_fecha      date,
  p_hora       text,
  p_horas      numeric,
  p_modalidad  modalidad_clase,
  p_tipo       tipo_clase,
  p_necesidad  text DEFAULT NULL::text,
  p_carrito_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(reserva_id bigint, monto_ars integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Insertar reserva pendiente_pago (costo_saldo = 0: no toca saldo). Único cambio real
  -- vs. la versión anterior de esta función: graba carrito_id.
  INSERT INTO reservas (alumno_id, profe_id, materia, fecha, hora, horas,
                        modalidad, tipo, grupo_id, estado, costo_saldo, monto, necesidad, expira_en, carrito_id)
  VALUES (v_alumno, p_profe_id, p_materia, p_fecha, p_hora, p_horas,
          p_modalidad, p_tipo, v_grupo_id, 'pendiente_pago', 0, v_monto, p_necesidad, v_expira, p_carrito_id)
  RETURNING id INTO v_rid;

  RETURN QUERY SELECT v_rid, v_monto;
END;
$$;

-- El GRANT ya existía para authenticated (esta función siempre se llamó vía
-- PostgREST con el JWT del alumno — auth.uid() adentro). CREATE OR REPLACE
-- no toca grants existentes, pero se re-declara explícito por las dudas y
-- para que quede documentado acá también.
REVOKE ALL ON FUNCTION public.crear_reserva_pendiente_pago(
  uuid, text, date, text, numeric, modalidad_clase, tipo_clase, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_reserva_pendiente_pago(
  uuid, text, date, text, numeric, modalidad_clase, tipo_clase, text, uuid
) TO authenticated;

-- ============================================================
-- F5 — GRUPAL REAL
-- BACKUP OBLIGATORIO antes de correr:
--   pg_dump ... -t reservas -t config > backup_f5_pre.sql
-- Correr sección ADDITIVE primero, verificar, luego el DROP del final.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- SECCIÓN ADDITIVE (sin riesgo — agrega, no toca datos existentes)
-- ══════════════════════════════════════════════════════════════

-- 1. Cupo grupal configurable
ALTER TABLE config ADD COLUMN IF NOT EXISTS cupo_grupal int NOT NULL DEFAULT 4;


-- 2. Tabla grupos (entidad canónica del grupo)
CREATE TABLE IF NOT EXISTS public.grupos (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  profe_id    uuid            NOT NULL REFERENCES auth.users(id),
  materia     text            NOT NULL,
  fecha       date            NOT NULL,
  hora        text            NOT NULL,
  horas       numeric         NOT NULL DEFAULT 1,
  modalidad   modalidad_clase NOT NULL,
  cupo_max    int             NOT NULL DEFAULT 4,
  estado      text            NOT NULL DEFAULT 'abierto', -- abierto | cancelado | realizado
  creado_en   timestamptz     NOT NULL DEFAULT now()
);

-- Un único grupo abierto por slot de profe
CREATE UNIQUE INDEX IF NOT EXISTS grupos_profe_fecha_hora_abierto_idx
  ON grupos (profe_id, fecha, hora)
  WHERE estado = 'abierto';

-- RLS: solo profe dueño y admin leen directamente (alumnos usan get_grupo_info RPC)
ALTER TABLE public.grupos ENABLE ROW LEVEL SECURITY;

CREATE POLICY grupos_select ON grupos FOR SELECT
  USING (profe_id = auth.uid() OR mi_rol() = 'admin');
-- INSERT / UPDATE / DELETE: solo via funciones SECURITY DEFINER (postgres user)


-- 3. FK grupo_id en reservas (nullable — null = individual, no nulo = grupal)
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS grupo_id bigint REFERENCES grupos(id);

CREATE INDEX IF NOT EXISTS idx_reservas_grupo
  ON reservas(grupo_id)
  WHERE grupo_id IS NOT NULL;

-- Unicidad: un alumno no puede estar dos veces en el mismo grupo activo
CREATE UNIQUE INDEX IF NOT EXISTS reservas_alumno_grupo_activa_idx
  ON reservas(alumno_id, grupo_id)
  WHERE grupo_id IS NOT NULL
    AND estado IN ('confirmada', 'pendiente');


-- 4. Índice partial para INDIVIDUAL (reemplaza el viejo que se dropea al final)
--    Protege double-booking individual; no aplica a filas grupales.
CREATE UNIQUE INDEX IF NOT EXISTS reservas_profe_fecha_hora_ind_activa_idx
  ON reservas(profe_id, fecha, hora)
  WHERE tipo = 'individual'
    AND estado IN ('confirmada', 'pendiente');


-- 5. RPC crear_reserva — una sola línea adicional: advisory lock por slot
--    Serializa concurrencia individual vs grupal en el mismo horario.
--    El resto del cuerpo es idéntico al original.
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

  -- Advisory lock: serializa cualquier operación sobre este slot de profe
  -- (individual vs grupal concurrentes no se pueden pisar)
  PERFORM pg_advisory_xact_lock(
    hashtext(p_profe_id::text || '|' || p_fecha::text || '|' || p_hora)
  );

  -- Overlap check: ningún slot del rango [p_hora, p_hora+p_horas) puede pisar
  IF exists (
    SELECT 1 FROM reservas r
    WHERE r.profe_id = p_profe_id
      AND r.fecha    = p_fecha
      AND r.estado   IN ('confirmada', 'pendiente')
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
-- CREATE OR REPLACE preserva los GRANTs existentes (PUBLIC + service_role)


-- 6. RPC unirse_grupo — join-or-create atómico con cupo en vivo
CREATE OR REPLACE FUNCTION public.unirse_grupo(
  p_profe_id  uuid,
  p_materia   text,
  p_fecha     date,
  p_hora      text,
  p_horas     numeric,
  p_modalidad modalidad_clase,
  p_necesidad text DEFAULT NULL
) RETURNS reservas LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_alumno     uuid    := auth.uid();
  v_grupo      grupos;
  v_cfg        config;
  v_costo      numeric;
  v_saldo      numeric;
  v_venc       date;
  v_inscriptos int;
  v_reserva    reservas;
BEGIN
  IF p_fecha < CURRENT_DATE THEN
    RAISE EXCEPTION 'No podés reservar en una fecha pasada.';
  END IF;

  -- Advisory lock: mismo esquema que crear_reserva; serializa concurrencia en el slot
  PERFORM pg_advisory_xact_lock(
    hashtext(p_profe_id::text || '|' || p_fecha::text || '|' || p_hora)
  );

  -- Validar server-side que el slot habilita grupal (no confiar en el front)
  IF NOT EXISTS (
    SELECT 1 FROM disponibilidad
    WHERE profe_id = p_profe_id
      AND fecha    = p_fecha
      AND hora     = p_hora
      AND tipo     IN ('grupal', 'ambas')
  ) THEN
    RAISE EXCEPTION 'Ese horario no está habilitado para clases grupales.';
  END IF;

  -- Verificar que no hay individual activo pisando este slot
  IF EXISTS (
    SELECT 1 FROM reservas
    WHERE profe_id = p_profe_id
      AND fecha    = p_fecha
      AND hora     = p_hora
      AND tipo     = 'individual'
      AND estado   IN ('confirmada', 'pendiente')
  ) THEN
    RAISE EXCEPTION 'El profe tiene una clase individual en ese horario.';
  END IF;

  SELECT * INTO v_cfg FROM config WHERE id = 1;

  -- Buscar grupo existente abierto (ya serializado por el advisory lock) y bloquearlo
  BEGIN
    SELECT * INTO v_grupo
      FROM grupos
      WHERE profe_id = p_profe_id
        AND fecha    = p_fecha
        AND hora     = p_hora
        AND estado   = 'abierto'
      FOR UPDATE;

    IF NOT FOUND THEN
      -- Primer alumno: crear el grupo. cupo_max se copia de config en este momento.
      INSERT INTO grupos (profe_id, materia, fecha, hora, horas, modalidad, cupo_max, estado)
      VALUES (p_profe_id, p_materia, p_fecha, p_hora, p_horas, p_modalidad,
              v_cfg.cupo_grupal, 'abierto')
      RETURNING * INTO v_grupo;
    END IF;

  EXCEPTION WHEN unique_violation THEN
    -- Caso extremo: otro proceso creó el grupo entre el SELECT y el INSERT
    -- (prácticamente imposible con el advisory lock, pero se captura por robustez)
    SELECT * INTO v_grupo
      FROM grupos
      WHERE profe_id = p_profe_id
        AND fecha    = p_fecha
        AND hora     = p_hora
        AND estado   = 'abierto'
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo obtener el grupo. Intentá de nuevo.';
    END IF;
  END;

  -- Contar inscriptos en vivo (sin columna desnormalizada — se libera sólo al cancelar)
  SELECT count(*) INTO v_inscriptos
    FROM reservas
    WHERE grupo_id = v_grupo.id
      AND estado   IN ('confirmada', 'pendiente');

  IF v_inscriptos >= v_grupo.cupo_max THEN
    RAISE EXCEPTION 'El grupo está lleno (% de % lugares).', v_inscriptos, v_grupo.cupo_max;
  END IF;

  -- Verificar que el alumno no esté ya en este grupo
  IF EXISTS (
    SELECT 1 FROM reservas
    WHERE grupo_id  = v_grupo.id
      AND alumno_id = v_alumno
      AND estado    IN ('confirmada', 'pendiente')
  ) THEN
    RAISE EXCEPTION 'Ya estás anotado en este grupo.';
  END IF;

  -- Lock de saldo del alumno + validaciones
  SELECT saldo, vencimiento INTO v_saldo, v_venc
    FROM alumnos WHERE id = v_alumno FOR UPDATE;

  v_costo := v_cfg.factor_grupal * p_horas;

  IF v_venc IS NOT NULL AND CURRENT_DATE > v_venc THEN
    RAISE EXCEPTION 'Tus horas vencieron el %. Comprá más horas.',
      to_char(v_venc, 'DD/MM/YYYY');
  END IF;

  IF v_saldo < v_costo THEN
    RAISE EXCEPTION 'Saldo insuficiente: cuesta % hs y tenés % hs.', v_costo, v_saldo;
  END IF;

  -- Descontar saldo e insertar reserva (todo en el mismo TX)
  UPDATE alumnos SET saldo = saldo - v_costo WHERE id = v_alumno;

  INSERT INTO reservas (alumno_id, profe_id, materia, fecha, hora, horas,
                        modalidad, tipo, grupo_id, estado, costo_saldo, necesidad)
  VALUES (v_alumno, p_profe_id, p_materia, p_fecha, p_hora, p_horas,
          p_modalidad, 'grupal', v_grupo.id, 'pendiente', v_costo, p_necesidad)
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unirse_grupo TO PUBLIC;


-- 7. RPC get_grupo_info — cupo en tiempo real para mostrar en P6
--    SECURITY DEFINER: el alumno ve cupo sin SELECT directo a grupos (RLS restrictivo)
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
           AND r.estado   IN ('confirmada', 'pendiente')),
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


-- ══════════════════════════════════════════════════════════════
-- VERIFICACIÓN antes del DROP:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename='reservas' AND indexname LIKE 'reservas_profe%';
--   → deben aparecer AMBOS índices:
--       reservas_profe_fecha_hora_ind_activa_idx  (el nuevo, para individual)
--       reservas_profe_fecha_hora_activa_idx      (el viejo, a dropear)
-- ══════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════
-- SECCIÓN DESTRUCTIVA — correr SÓLO después de confirmar que
-- el índice ind_activa_idx está activo y el conteo de reservas
-- individuales activas es consistente.
-- ══════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.reservas_profe_fecha_hora_activa_idx;

-- DDL original del índice (por si hace falta recrearlo):
-- CREATE UNIQUE INDEX reservas_profe_fecha_hora_activa_idx
--   ON public.reservas USING btree (profe_id, fecha, hora)
--   WHERE (estado = ANY (ARRAY['confirmada'::estado_reserva, 'pendiente'::estado_reserva]));

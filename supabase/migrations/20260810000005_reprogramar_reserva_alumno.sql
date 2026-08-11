-- ════════════════════════════════════════════════════════════════════════════
-- FASE B (overnight 2026-08-10): reprogramar_reserva_alumno
--
-- Historial → ModalReprogramar hacía un UPDATE directo a `reservas` desde el
-- cliente. Nunca existió policy RLS que le diera UPDATE a un alumno sobre sus
-- propias reservas (solo admin/profe) — el UPDATE fallaba silencioso, el
-- catch lo tragaba, y la UI mostraba "¡Clase reprogramada!" por estado local
-- optimista sin que la DB cambiara nada. Documentado en la auditoría
-- 2026-08-10 y en CLAUDE.md.
--
-- Fix: RPC SECURITY DEFINER, mismo patrón que confirmar_reserva_pago /
-- crear_reserva_pendiente_pago (advisory lock + revalidación real, no confía
-- en lo que ya filtró el front). El frontend deja de tocar la tabla directo.
--
-- Decisión de alcance (no ambigua, documentada): solo reprograma reservas
-- `tipo='individual'`. Reprogramar grupales tocaría grupo_id/cupo/reagrupación
-- — lógica de negocio no especificada (el propio CLAUDE.md ya lo marca como
-- límite conocido: "VERIFICAR pendiente: reprogramar una grupal pagada de
-- extremo a extremo"). La RPC rechaza grupales con un mensaje claro en vez
-- de adivinar; el frontend deja de ofrecer la opción para grupales.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reprogramar_reserva_alumno(
  p_reserva_id bigint,
  p_fecha      date,
  p_hora       text
)
RETURNS reservas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reserva reservas;
BEGIN
  SELECT * INTO v_reserva FROM reservas WHERE id = p_reserva_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  IF v_reserva.alumno_id != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_reserva.estado NOT IN ('pendiente', 'confirmada') THEN
    RAISE EXCEPTION 'No se puede reprogramar una reserva en estado "%".', v_reserva.estado;
  END IF;

  IF v_reserva.tipo = 'grupal' THEN
    RAISE EXCEPTION 'Reprogramar clases grupales todavía no está soportado. Contactá al profe.';
  END IF;

  IF p_fecha < CURRENT_DATE THEN
    RAISE EXCEPTION 'No podés reprogramar a una fecha pasada.';
  END IF;

  -- Regla 24hs (mismo criterio que devolver_horas / que ya muestra el front):
  -- con menos de 24hs de anticipación no se puede reprogramar.
  IF (
    (v_reserva.fecha::text || ' ' || v_reserva.hora)::timestamp
      AT TIME ZONE 'America/Argentina/Buenos_Aires'
    - now()
  ) < INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'No podés reprogramar con menos de 24hs de anticipación.';
  END IF;

  -- Advisory lock del slot NUEVO — mismo criterio que crear_reserva_pendiente_pago/unirse_grupo,
  -- mutua exclusión con cualquier otra reserva que se esté creando en simultáneo ahí.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_reserva.profe_id::text || '|' || p_fecha::text || '|' || p_hora)
  );

  -- Disponibilidad REAL del profe en el nuevo slot — no se confía en lo que ya filtró el front.
  IF NOT EXISTS (
    SELECT 1 FROM disponibilidad
    WHERE profe_id = v_reserva.profe_id
      AND fecha    = p_fecha
      AND hora     = p_hora
      AND tipo     IN ('individual', 'ambas')
  ) THEN
    RAISE EXCEPTION 'El profe no tiene ese horario disponible.';
  END IF;

  -- Solapamiento con otras reservas activas del profe en el nuevo slot (sin contar la propia).
  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.profe_id = v_reserva.profe_id
      AND r.fecha    = p_fecha
      AND r.id       != p_reserva_id
      AND r.estado   IN ('confirmada', 'pendiente', 'pendiente_pago')
      AND (r.expira_en IS NULL OR r.expira_en > now())
      AND r.hora::time < (p_hora::time + v_reserva.horas * INTERVAL '1 hour')
      AND (r.hora::time + r.horas * INTERVAL '1 hour') > p_hora::time
  ) THEN
    RAISE EXCEPTION 'Ya hay una reserva en ese horario. Elegí otro bloque.';
  END IF;

  UPDATE reservas
  SET fecha = p_fecha, hora = p_hora, estado = 'confirmada', marcada_en = now()
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

REVOKE ALL ON FUNCTION public.reprogramar_reserva_alumno(bigint, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reprogramar_reserva_alumno(bigint, date, text) TO authenticated;

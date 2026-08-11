-- ════════════════════════════════════════════════════════════════════════════
-- FASE F (overnight 2026-08-10): limpieza de compras pendientes colgadas
--
-- Ya documentado en CLAUDE.md ("A futuro"): cada pago que termina en
-- pending/failure deja una fila en compras con estado_pago='pendiente' que
-- nunca se actualiza (el webhook solo toca filas de pagos approved). No
-- afecta correctitud (getCompras filtra 'aprobado'), pero acumula basura.
--
-- Solo higiene — no cambia comportamiento de negocio: no toca saldo, no
-- reemplaza al webhook, no valida nada de MP. Marca 'fallido' únicamente
-- filas que siguen en 'pendiente' (nunca pisa un 'aprobado' real, aunque el
-- alumno vuelva con failure después de que el webhook ya haya acreditado por
-- otro lado — orden de llegada real vs. redirect de MP no está garantizado).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.marcar_compra_fallida(p_compra_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_compra compras;
BEGIN
  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- nada que marcar, no es un error (idempotente ante reintentos/ids viejos)
  END IF;

  IF v_compra.alumno_id != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_compra.estado_pago = 'pendiente' THEN
    UPDATE compras SET estado_pago = 'fallido' WHERE id = p_compra_id;
  END IF;
  -- Si ya está 'aprobado' (el webhook ganó la carrera) o ya 'fallido', no se toca.
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_compra_fallida(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_compra_fallida(bigint) TO authenticated;

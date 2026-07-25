BEGIN;

-- Agregados de Finanzas/Dashboard calculados server-side, por período (mes).
-- Reemplaza el cálculo client-side sobre reservas completas (pageSize alto,
-- truncado silenciosamente si count supera el pageSize). Misma fórmula que
-- calcPagoProfe/calcCoworkReserva en el front (src/PuntoClasesApp.jsx).
-- Solo lectura, sin tablas/índices nuevos. Admin-only (mismo patrón que
-- add_horas_admin: chequeo interno contra profiles.rol, sin REVOKE de PUBLIC).
--
-- estado = 'realizada' (VERIFICADO, no es un bug): 'realizada' SÍ es un
-- label válido del enum estado_reserva (pg_enum: pendiente, confirmada,
-- realizada, cancelada, rechazada, ausente, pendiente_pago, expirada) — lo
-- que no hay HOY es ninguna fila con ese valor en los datos reales (los 51
-- registros actuales son ausente/cancelada/confirmada/pendiente). Es el
-- mismo criterio que usa el front en todos lados: marcarReserva(id,
-- "realizada") escribe ese literal; Finanzas admin filtra
-- reservas.filter(r=>r.estado==="realizada"); "Mis ingresos" del profe usa
-- el boolean derivado r.realizada = (r.estado==="realizada"). Cambiarlo a
-- otro criterio (ej. confirmada + fecha<=hoy) rompería la paridad con el
-- front, que es justo lo que esta función tiene que preservar. Mientras no
-- haya reservas marcadas 'realizada' en prod, esta función (y el front)
-- van a devolver $0 — es la realidad de los datos, no un error de la query.
CREATE OR REPLACE FUNCTION get_finanzas_periodo()
RETURNS TABLE (
  periodo text,
  clases bigint,
  bruto numeric,
  pago_profe numeric,
  costo_cowork numeric,
  neto numeric
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'admin'
  ) THEN
    RAISE EXCEPTION 'Solo el admin puede usar esta función.';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT tarifa_profe_ind, tarifa_profe_grp, cowork_por_alumno FROM config WHERE id = 1
  )
  SELECT
    to_char(r.fecha, 'YYYY-MM') AS periodo,
    count(*) AS clases,
    COALESCE(sum(r.monto), 0) AS bruto,
    COALESCE(sum(
      CASE WHEN r.tipo = 'grupal'
        THEN cfg.tarifa_profe_grp * COALESCE(r.alumnos_grupo, 1) * COALESCE(r.horas, 1)
        ELSE cfg.tarifa_profe_ind * COALESCE(r.horas, 1)
      END
    ), 0) AS pago_profe,
    COALESCE(sum(
      CASE WHEN r.modalidad = 'Presencial'
        THEN COALESCE(r.alumnos_grupo, 1) * COALESCE(r.horas, 1) * cfg.cowork_por_alumno
        ELSE 0
      END
    ), 0) AS costo_cowork,
    COALESCE(sum(r.monto), 0)
      - COALESCE(sum(CASE WHEN r.tipo = 'grupal' THEN cfg.tarifa_profe_grp * COALESCE(r.alumnos_grupo,1) * COALESCE(r.horas,1) ELSE cfg.tarifa_profe_ind * COALESCE(r.horas,1) END), 0)
      - COALESCE(sum(CASE WHEN r.modalidad = 'Presencial' THEN COALESCE(r.alumnos_grupo,1) * COALESCE(r.horas,1) * cfg.cowork_por_alumno ELSE 0 END), 0)
      AS neto
  FROM reservas r, cfg
  WHERE r.estado = 'realizada'
  GROUP BY periodo
  ORDER BY periodo DESC;
END;
$$;

COMMIT;

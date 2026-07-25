BEGIN;

-- Agregados de Finanzas/Dashboard calculados server-side, por período (mes).
-- Reemplaza el cálculo client-side sobre reservas completas (pageSize alto,
-- truncado silenciosamente si count supera el pageSize). Misma fórmula que
-- calcPagoProfe/calcCoworkReserva en el front (src/PuntoClasesApp.jsx).
-- Solo lectura, sin tablas/índices nuevos. Admin-only (mismo patrón que
-- add_horas_admin: chequeo interno contra profiles.rol, sin REVOKE de PUBLIC).
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

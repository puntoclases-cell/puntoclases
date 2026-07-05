-- ============================================================
-- F6 ETAPA 2a: UNIQUE en pagos_huerfanos.payment_id
-- Necesario para que handleOrphan pueda usar
-- ON CONFLICT (payment_id) DO NOTHING de forma atómica.
-- pagos_huerfanos está vacía — sin riesgo de datos.
--
-- ORDEN DE DEPLOY OBLIGATORIO:
--   1) Esta migración (crea el UNIQUE)
--   2) Deploy de mp-webhook (usa ignoreDuplicates=true sobre payment_id)
-- ============================================================

DROP INDEX IF EXISTS public.pagos_huerfanos_payment_id_idx;

CREATE UNIQUE INDEX pagos_huerfanos_payment_id_idx
  ON public.pagos_huerfanos (payment_id);

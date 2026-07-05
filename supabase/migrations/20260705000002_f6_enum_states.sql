-- ============================================================
-- F6 ETAPA 1 — Parte 1: nuevos valores de estado_reserva
-- SOLO ADD VALUE: Postgres exige un commit previo a su uso en
-- funciones/índices. Va en migración separada.
-- ============================================================

ALTER TYPE public.estado_reserva ADD VALUE IF NOT EXISTS 'pendiente_pago';
ALTER TYPE public.estado_reserva ADD VALUE IF NOT EXISTS 'expirada';

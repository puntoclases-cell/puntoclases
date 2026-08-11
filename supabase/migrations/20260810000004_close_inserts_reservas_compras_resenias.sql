-- ════════════════════════════════════════════════════════════════════════════
-- Cierre de 3 huecos de INSERT (docs/auditoria-2026-08.md §7 + barrido
-- 2026-08-10): reservas_insert/compras_ins no validaban estado/plata,
-- resenias_ins no validaba que la reseña fuera de una clase propia ya dada.
--
-- Confirmado antes de escribir esto (grep completo de src/, no solo
-- profe/admin): CERO `.insert(` directo contra "reservas" o "compras" en
-- todo el cliente. La creación legítima pasa 100% por RPCs SECURITY DEFINER
-- (crear_reserva, crear_reserva_pendiente_pago, unirse_grupo,
-- registrar_compra_pendiente/acreditar_compra), que corren como `postgres` y
-- no dependen de este GRANT para nada — este REVOKE no les toca nada.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE INSERT ON public.reservas FROM authenticated;
REVOKE INSERT ON public.compras  FROM authenticated;

-- resenias_ins: antes solo exigía "sos vos" (alumno_id=auth.uid()), sin
-- validar que reserva_id/profe_id tuvieran algo que ver entre sí ni con quien
-- reseña. Ahora exige que exista una reserva propia, con ese profe, YA
-- REALIZADA (confirmado en código — PuntoClasesApp.jsx:916, el botón
-- "Calificar clase" solo aparece cuando estado==='realizada' — es el valor
-- real del enum que significa "la clase ya pasó", no era una suposición).
DROP POLICY IF EXISTS resenias_ins ON resenias;

CREATE POLICY resenias_ins ON resenias
  FOR INSERT
  WITH CHECK (
    alumno_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM reservas r
      WHERE r.id = resenias.reserva_id
        AND r.alumno_id = auth.uid()
        AND r.profe_id = resenias.profe_id
        AND r.estado = 'realizada'::estado_reserva
    )
  );

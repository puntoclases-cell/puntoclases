-- ════════════════════════════════════════════════════════════════════════════
-- FASE E (overnight 2026-08-10): editor de packs en Finanzas no persistía
--
-- El editor de descuentos (Finanzas > Config > "Packs con descuento") escribía
-- solo contra el estado local `cfg` — nunca contra la tabla `packs` real, que
-- es la que lee Comprar() del alumno vía packsDB. Causa raíz: `authenticated`
-- no tenía NINGÚN grant de escritura sobre `packs`, ni siquiera admin (ya
-- documentado en CLAUDE.md/auditoría). La policy `packs_admin` (mi_rol()=
-- 'admin' en USING y WITH CHECK, ya existía) sigue siendo la que protege esto
-- — acá solo se agrega el GRANT que faltaba, acotado a la única columna que
-- el front realmente edita (mismo criterio que reservas/alumnos: columnas
-- mínimas, no tabla completa).
-- ════════════════════════════════════════════════════════════════════════════

GRANT UPDATE (descuento) ON public.packs TO authenticated;

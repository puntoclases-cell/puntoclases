-- Eliminar política duplicada sin WITH CHECK que permitía privilege escalation.
-- profiles_update (que sí tiene WITH CHECK que impide cambiar rol) queda activa.
DROP POLICY IF EXISTS profiles_self_update ON profiles;

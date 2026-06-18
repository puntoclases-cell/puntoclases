-- Agrega SELECT policy para avatars propios — habilita upsert:true en el cliente JS.
-- upsert (INSERT ON CONFLICT DO UPDATE) necesita INSERT + UPDATE + SELECT para que el
-- storage server pueda resolver el conflict check internamente.
-- Scoped a los propios archivos del usuario; bucket ya es público (no expone nada nuevo).
CREATE POLICY avatar_select_own ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

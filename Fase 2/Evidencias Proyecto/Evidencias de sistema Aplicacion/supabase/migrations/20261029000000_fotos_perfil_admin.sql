-- Permite que los administradores puedan listar y firmar las fotos de perfil
-- de cualquier usuario desde el panel web.
drop policy if exists "administradores leen fotos de perfil" on storage.objects;
create policy "administradores leen fotos de perfil"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'fotos-perfil'
    and public.es_administrador()
  );

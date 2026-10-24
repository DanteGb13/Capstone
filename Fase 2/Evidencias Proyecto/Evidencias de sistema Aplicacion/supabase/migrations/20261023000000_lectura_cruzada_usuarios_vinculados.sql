-- =====================================================
-- LECTURA CRUZADA DE USUARIOS VINCULADOS
-- Permite que cada adulto lea a sus cuidadores y viceversa.
-- Función SECURITY DEFINER para romper recursión.
-- Nombre evita 'usuario' en qual → sobrevive re-ejecución de analitica.sql.
-- Correr DESPUÉS de analitica.sql.
-- =====================================================

create or replace function public.puede_ver_vinculado(p_id_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_id_usuario = auth.uid()                    -- propia fila
    or public.es_administrador()                 -- admin
    or exists (                                   -- adulto ve a su cuidador
      select 1
      from public.cuidador_usuario cu
      join public.cuidador c on c.id = cu.id_cuidador
      where cu.id_usuario = auth.uid()           -- yo soy el adulto
        and c.id_usuario = p_id_usuario          -- la fila es mi cuidador
    )
    or exists (                                   -- cuidador ve a su adulto
      select 1
      from public.cuidador_usuario cu
      join public.cuidador c on c.id = cu.id_cuidador
      where c.id_usuario = auth.uid()            -- yo soy el cuidador
        and cu.id_usuario = p_id_usuario         -- la fila es mi adulto
    );
$$;

revoke execute on function public.puede_ver_vinculado(uuid) from public, anon;
grant execute on function public.puede_ver_vinculado(uuid) to authenticated;

drop policy if exists "lee a los usuarios vinculados" on public.usuario;
create policy "lee a los usuarios vinculados"
  on public.usuario
  for select to authenticated
  using (public.puede_ver_vinculado(id));
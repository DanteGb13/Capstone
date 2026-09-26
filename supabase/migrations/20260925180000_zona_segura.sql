-- =====================================================
-- ZONA SEGURA
-- Solo toca la tabla public.zona_segura.
-- Idempotente: se puede ejecutar más de una vez sin romper nada.
-- =====================================================

-- Nombre visible de la zona (ej: "Mi casa", "Plaza", "Clínica")
alter table public.zona_segura
  add column if not exists nombre character varying not null default '';

-- Marca la zona predeterminada creada desde la dirección del perfil
alter table public.zona_segura
  add column if not exists es_casa boolean not null default false;

create index if not exists zona_segura_id_usuario_idx
  on public.zona_segura (id_usuario);

-- =====================================================
-- POLÍTICA DE ACCESO
-- Se crea solo si todavía no existe una política con ese nombre.
-- No modifica ni crea políticas en otras tablas.
-- =====================================================
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'zona_segura'
      and policyname = 'zona_segura_app_acceso'
  ) then
    execute $pol$
      create policy "zona_segura_app_acceso" on public.zona_segura
      for all to authenticated
      using (
        auth.uid() = id_usuario
        or exists (
          select 1
          from public.cuidador_usuario cu
          join public.cuidador c on c.id = cu.id_cuidador
          where cu.id_usuario = zona_segura.id_usuario
            and c.id_usuario = auth.uid()
        )
      )
      with check (
        auth.uid() = id_usuario
        or exists (
          select 1
          from public.cuidador_usuario cu
          join public.cuidador c on c.id = cu.id_cuidador
          where cu.id_usuario = zona_segura.id_usuario
            and c.id_usuario = auth.uid()
        )
      )
    $pol$;
  end if;
end $$;

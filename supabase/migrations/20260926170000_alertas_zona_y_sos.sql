-- =====================================================
-- ALERTAS DE ZONA SEGURA Y ALERTAS SOS
--   1) zona_alerta: estado de la alerta "fuera de zona" por usuario.
--      El cooldown vive en la BD (no en localStorage) para que sirva igual
--      con la app abierta (TypeScript) y con la app cerrada (servicio nativo).
--   2) sos_alerta: una sesión SOS se reenvía hasta que un cuidador contesta.
--   3) zona_evaluar_alerta(): decide de forma atómica si corresponde
--      "primera" alerta (intensa), "actualizacion" (cada 10 min) o "volvio".
-- =====================================================

-- ---------------------------------------------------
-- 1) Estado de alerta de zona segura (una fila por usuario)
-- ---------------------------------------------------
create table if not exists public.zona_alerta (
  id uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references public.usuario (id) on delete cascade,
  fuera boolean not null default false,
  primera_alerta timestamptz,
  ultima_notificacion timestamptz,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

create unique index if not exists zona_alerta_id_usuario_unico
  on public.zona_alerta (id_usuario);

-- ---------------------------------------------------
-- 2) Sesiones SOS (se repite hasta que el cuidador contesta)
-- ---------------------------------------------------
create table if not exists public.sos_alerta (
  id uuid primary key default gen_random_uuid(),
  id_adulto uuid not null references public.usuario (id) on delete cascade,
  creada_en timestamptz not null default now(),
  confirmada_por uuid references public.usuario (id),
  confirmada_en timestamptz
);

create index if not exists sos_alerta_adulto_idx
  on public.sos_alerta (id_adulto, creada_en desc);

-- ---------------------------------------------------
-- RLS
-- ---------------------------------------------------
alter table public.zona_alerta enable row level security;
alter table public.sos_alerta enable row level security;

do $$
begin
  -- zona_alerta: el adulto y sus cuidadores pueden leer el estado
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'zona_alerta'
      and policyname = 'zona_alerta_lectura'
  ) then
    execute $pol$
      create policy "zona_alerta_lectura" on public.zona_alerta
      for select to authenticated
      using (
        auth.uid() = id_usuario
        or exists (
          select 1
          from public.cuidador_usuario cu
          join public.cuidador c on c.id = cu.id_cuidador
          where cu.id_usuario = zona_alerta.id_usuario
            and c.id_usuario = auth.uid()
        )
      )
    $pol$;
  end if;

  -- sos_alerta: el adulto y sus cuidadores pueden ver la sesión SOS
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sos_alerta'
      and policyname = 'sos_alerta_lectura'
  ) then
    execute $pol$
      create policy "sos_alerta_lectura" on public.sos_alerta
      for select to authenticated
      using (
        auth.uid() = id_adulto
        or exists (
          select 1
          from public.cuidador_usuario cu
          join public.cuidador c on c.id = cu.id_cuidador
          where cu.id_usuario = sos_alerta.id_adulto
            and c.id_usuario = auth.uid()
        )
      )
    $pol$;
  end if;

  -- sos_alerta: solo el adulto crea su propia alerta SOS
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sos_alerta'
      and policyname = 'sos_alerta_crear'
  ) then
    execute $pol$
      create policy "sos_alerta_crear" on public.sos_alerta
      for insert to authenticated
      with check (auth.uid() = id_adulto)
    $pol$;
  end if;

  -- sos_alerta: el adulto o su cuidador vinculado puede confirmarla
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sos_alerta'
      and policyname = 'sos_alerta_confirmar'
  ) then
    execute $pol$
      create policy "sos_alerta_confirmar" on public.sos_alerta
      for update to authenticated
      using (
        auth.uid() = id_adulto
        or exists (
          select 1
          from public.cuidador_usuario cu
          join public.cuidador c on c.id = cu.id_cuidador
          where cu.id_usuario = sos_alerta.id_adulto
            and c.id_usuario = auth.uid()
        )
      )
      with check (true)
    $pol$;
  end if;
end $$;

-- ---------------------------------------------------
-- 3) Decisión atómica de la alerta de zona.
--    Devuelve: 'primera' | 'actualizacion' | 'volvio' | 'ninguna'
--    'primera'      -> salida de zona: alerta intensa (sonido + vibración larga)
--    'actualizacion'-> sigue fuera: aviso de estado cada 10 minutos
--    'volvio'       -> volvió a la zona segura: aviso de estado
-- ---------------------------------------------------
create or replace function public.zona_evaluar_alerta(
  p_id_usuario uuid,
  p_fuera boolean
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.zona_alerta%rowtype;
  accion text := 'ninguna';
begin
  if p_id_usuario is null then
    return 'ninguna';
  end if;

  select * into fila
  from public.zona_alerta
  where id_usuario = p_id_usuario
  for update;

  if not found then
    insert into public.zona_alerta (id_usuario, fuera, primera_alerta, ultima_notificacion)
    values (p_id_usuario, p_fuera, case when p_fuera then now() end, now());
    return case when p_fuera then 'primera' else 'ninguna' end;
  end if;

  if p_fuera and not fila.fuera then
    update public.zona_alerta
      set fuera = true,
          primera_alerta = now(),
          ultima_notificacion = now(),
          actualizada_en = now()
      where id = fila.id;
    accion := 'primera';
  elsif p_fuera and fila.fuera then
    if fila.ultima_notificacion is null
       or fila.ultima_notificacion < now() - interval '10 minutes' then
      update public.zona_alerta
        set ultima_notificacion = now(),
            actualizada_en = now()
        where id = fila.id;
      accion := 'actualizacion';
    else
      accion := 'ninguna';
    end if;
  elsif not p_fuera and fila.fuera then
    update public.zona_alerta
      set fuera = false,
          primera_alerta = null,
          ultima_notificacion = now(),
          actualizada_en = now()
      where id = fila.id;
    accion := 'volvio';
  end if;

  return accion;
end;
$$;

revoke execute on function public.zona_evaluar_alerta(uuid, boolean) from public, anon, authenticated;
grant execute on function public.zona_evaluar_alerta(uuid, boolean) to service_role;

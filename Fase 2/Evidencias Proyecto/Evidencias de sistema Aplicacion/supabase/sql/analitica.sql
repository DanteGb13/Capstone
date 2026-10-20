-- =====================================================
-- ANALÍTICA DEL PANEL DE ADMINISTRACIÓN
--
-- Una sola tabla plana en vez de varias: los eventos de página, los inicios
-- de sesión y las exportaciones de reporte son filas con distinto `evento`,
-- y con eso se arma todo sin tener que cruzar tablas.
--
-- Se puede volver a correr cuantas veces haga falta: todo es
-- `if not exists` o va precedido de `drop policy if exists`.
-- =====================================================

create table if not exists public.analitica_eventos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid references auth.users (id) on delete set null,
  ruta        text not null,
  evento      text not null default 'vista_pagina',
  plataforma  text not null default 'web',
  fecha       timestamptz not null default now()
);

-- El panel ordena siempre por fecha y por ruta: sin estos índices cada
-- consulta del dashboard barre la tabla entera.
create index if not exists analitica_eventos_fecha_idx
  on public.analitica_eventos (fecha desc);

create index if not exists analitica_eventos_ruta_fecha_idx
  on public.analitica_eventos (ruta, fecha desc);

-- Para "quién entró y quién no": cuenta inicios por usuario y día.
create index if not exists analitica_eventos_usuario_fecha_idx
  on public.analitica_eventos (usuario_id, fecha desc);

alter table public.analitica_eventos enable row level security;

-- Cualquiera registra SU evento, nunca el de otro. Incluye `anon`: la mayor
-- parte del tráfico de /inicio, /planes y /descarga es gente sin cuenta, y
-- si no se pudiera registrar, "la página más visitada" se respondería solo
-- con los usuarios ya registrados, que es justo la mitad de la pregunta.
-- Es seguro aunque sea anónimo: sólo se INSERTA, no se lee ni se modifica.
drop policy if exists "los visitantes registran sus propios eventos" on public.analitica_eventos;
create policy "los visitantes registran sus propios eventos"
  on public.analitica_eventos
  for insert to anon, authenticated
  with check (usuario_id is null or usuario_id = auth.uid());


-- =====================================================
-- FUNCIÓN: ¿ESTE USUARIO ES ADMINISTRADOR?
--
-- OJO con escribir el EXISTS directamente dentro de las políticas: la
-- política vive EN `usuario` y el EXISTS vuelve a consultar `usuario`, así
-- que Postgres termina evaluándose a sí misma y aborta con
--
--   ERROR: infinite recursion detected in policy for relation "usuario"
--
-- Ese error no llega como "sin permiso": llega como error de consulta, y el
-- código que lee el perfil lo interpreta como "no se pudo leer", con lo que
-- el rol queda en null y la persona ve un mensaje críptico.
--
-- `security definer` hace que la función corra como su dueño, que sí pasa
-- por alto RLS, y ahí el ciclo se rompe.
-- =====================================================
create or replace function public.es_administrador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuario u
    join public.rol r on r.id = u.id_rol
    where u.id = auth.uid()
      and r.nombre = 'Administrador'
  );
$$;

-- Sólo se expone a la app autenticada: `anon` no tiene nada que hacer con
-- esta función.
revoke execute on function public.es_administrador() from public, anon;
grant execute on function public.es_administrador() to authenticated;


-- =====================================================
-- LIMPIEZA DE LO QUE HAYA QUEDADO DE ANTES
--
-- El bug original era un EXISTS escrito DENTRO de la política, sobre la
-- misma tabla que la contiene. Eso funciona… hasta que se cambia el nombre
-- de la política: los `drop policy if exists` de más abajo borran dos
-- nombres concretos, y si la versión vieja se creó con otro, queda viva y
-- la recursión sigue tirando abajo cada lectura de `usuario`.
--
-- Este bloque no adivina nombres: busca la marca que la delata, que es el
-- nombre de la tabla dentro del predicado, y borra lo que encuentre. En el
-- SQL Editor de Supabase los `raise notice` salen abajo, así que deja
-- registro de qué tocó.
--
-- Sólo mira `cmd in ('ALL','SELECT')`: una política de INSERT no se
-- autoconsulta al leer, así que no puede recursar.
-- =====================================================
do $$
declare
  p record;
  borradas int := 0;
begin
  for p in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename in ('usuario', 'analitica_eventos')
       and cmd in ('ALL', 'SELECT')
       and qual like '%usuario%'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    borradas := borradas + 1;
    raise notice 'borrada politica previa: "%" sobre public.%', p.policyname, p.tablename;
  end loop;

  if borradas = 0 then
    raise notice 'no habia politicas autorreferentes pendientes';
  end if;
end $$;


-- =====================================================
-- LECTURA DE USUARIOS
--
-- Para la sección "Usuarios" del panel, y también para que cada quien pueda
-- leer su propio perfil (rut y dirección) desde cualquier pantalla.
--
-- Las políticas permisivas se entrecombian con OR, así que ésta es
-- estrictamente aditiva: no le quita acceso a nadie que lo tuviera.
-- =====================================================

drop policy if exists "el administrador lee los usuarios" on public.usuario;
drop policy if exists "cada quien lee su propio usuario" on public.usuario;

create policy "cada quien lee su propio usuario"
  on public.usuario
  for select to authenticated
  using (auth.uid() = id);

create policy "el administrador lee los usuarios"
  on public.usuario
  for select to authenticated
  using (public.es_administrador());


-- =====================================================
-- LECTURA DE LA ANALÍTICA
--
-- Sólo el Administrador: sin esto cualquiera autenticado podría ver qué
-- pantallas mira la demás gente.
-- =====================================================

drop policy if exists "solo el administrador lee la analitica" on public.analitica_eventos;
create policy "solo el administrador lee la analitica"
  on public.analitica_eventos
  for select to authenticated
  using (public.es_administrador());

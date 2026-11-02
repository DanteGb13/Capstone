create table if not exists public.plan_suscripcion (
  codigo text primary key,
  nombre text not null,
  precio_clp integer not null check (precio_clp > 0),
  duracion_dias integer not null check (duracion_dias > 0),
  activo boolean not null default true
);

create table if not exists public.suscripcion (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  plan_codigo text not null references public.plan_suscripcion(codigo),
  estado text not null check (estado in ('pendiente', 'activa', 'cancelada', 'vencida')),
  inicia_en timestamptz,
  vence_en timestamptz,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  unique (usuario_id, plan_codigo)
);

create table if not exists public.transaccion_pago (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  suscripcion_id uuid references public.suscripcion(id) on delete set null,
  plan_codigo text not null references public.plan_suscripcion(codigo),
  buy_order text not null unique,
  token_transbank text,
  monto integer not null check (monto > 0),
  estado text not null check (estado in ('creada', 'procesando', 'autorizada', 'rechazada', 'anulada')),
  respuesta_transbank jsonb,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

insert into public.plan_suscripcion (codigo, nombre, precio_clp, duracion_dias)
values
  ('mensual', 'Plan mensual', 7000, 30),
  ('anual', 'Plan anual', 70000, 365)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  precio_clp = excluded.precio_clp,
  duracion_dias = excluded.duracion_dias;

alter table public.plan_suscripcion enable row level security;
alter table public.suscripcion enable row level security;
alter table public.transaccion_pago enable row level security;

create policy "Planes activos visibles"
  on public.plan_suscripcion for select
  to authenticated
  using (activo);

create policy "Suscripcion propia"
  on public.suscripcion for select
  to authenticated
  using (usuario_id = auth.uid());

create policy "Transacciones propias"
  on public.transaccion_pago for select
  to authenticated
  using (usuario_id = auth.uid());

grant select on public.plan_suscripcion, public.suscripcion, public.transaccion_pago to authenticated;

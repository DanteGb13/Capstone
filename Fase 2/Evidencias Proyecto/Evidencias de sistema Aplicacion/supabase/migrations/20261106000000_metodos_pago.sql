create table if not exists public.metodo_pago (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references auth.users(id) on delete cascade,
  tipo text not null default 'tarjeta' check (tipo = 'tarjeta'),
  marca text not null,
  ultimos_cuatro text not null check (ultimos_cuatro ~ '^\d{4}$'),
  mes_expiracion integer not null check (mes_expiracion between 1 and 12),
  ano_expiracion integer not null check (ano_expiracion between 2026 and 2100),
  titular text not null,
  numero_encriptado text not null,
  iv_encriptacion text not null,
  es_predeterminado boolean not null default true,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

alter table public.metodo_pago enable row level security;

drop policy if exists "Metodo de pago propio" on public.metodo_pago;
create policy "Metodo de pago propio"
  on public.metodo_pago for all
  to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

grant select, insert, update, delete on public.metodo_pago to authenticated;

alter table public.suscripcion
  add column if not exists credito_prorrateado_clp integer not null default 0;

alter table public.transaccion_pago
  add column if not exists monto_original_clp integer,
  add column if not exists credito_prorrateado_clp integer not null default 0,
  add column if not exists tipo text not null default 'nueva';

alter table public.suscripcion
  add column if not exists plan_anterior_codigo text references public.plan_suscripcion(codigo),
  add column if not exists mejora_en timestamptz,
  add column if not exists plan_anterior_inicia_en timestamptz,
  add column if not exists plan_anterior_vence_en timestamptz;

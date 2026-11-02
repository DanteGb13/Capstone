alter table public.suscripcion
  add column if not exists cancelacion_programada_en timestamptz,
  add column if not exists cancelada_en timestamptz,
  add column if not exists devolucion_solicitada_en timestamptz,
  add column if not exists devolucion_estado text;

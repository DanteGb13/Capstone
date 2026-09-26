-- Una persona puede tener varias zonas seguras activas.
-- El índice único (un solo usuario con zona activa) impedía crear zonas nuevas:
--   duplicate key value violates unique constraint "zona_segura_usuario_activa_idx"

alter table public.zona_segura
  drop constraint if exists zona_segura_usuario_activa_idx;

drop index if exists public.zona_segura_usuario_activa_idx;

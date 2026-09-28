-- =============================================================================
-- HISTORIAL DE EVENTOS
--
-- Vista unificada `historial_eventos` que reúne en una sola línea de tiempo:
--   * desplazamientos (historial_desplazamiento)
--   * SOS creados y confirmados (sos_alerta)
--   * alertas de zona y viajes vigilados (zona_alerta, zona_viaje)
--   * recordatorios confirmados (alarma_recordatorio)
--   * solicitudes de estado de salud (solicitud_actualizacion_salud)
--   * eventos manuales escritos por la app (historial_evento)
--
-- La vista usa security_invoker, así que respeta las RLS de cada tabla
-- original: un cuidador sólo ve eventos de los adultos vinculados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla para eventos que hoy no tienen tabla propia (llamadas, notas, ...)
-- -----------------------------------------------------------------------------

create table if not exists public.historial_evento (
  id          uuid primary key default gen_random_uuid(),
  id_usuario  uuid not null references public.usuario (id) on delete cascade,
  id_origen   uuid,
  tipo        text not null default 'manual'
              check (tipo in ('manual', 'llamada', 'nota', 'ubicacion')),
  titulo      text not null check (char_length(titulo) between 1 and 120),
  detalle     text check (detalle is null or char_length(detalle) <= 500),
  fecha       timestamptz not null default now(),
  creada_por  uuid default auth.uid() references public.usuario (id) on delete set null,
  creada_en   timestamptz not null default now()
);

create index if not exists historial_evento_usuario_fecha_idx
  on public.historial_evento (id_usuario, fecha desc);

alter table public.historial_evento enable row level security;

drop policy if exists "historial_evento_select" on public.historial_evento;
create policy "historial_evento_select" on public.historial_evento
  for select to authenticated
  using (id_usuario = auth.uid() or es_cuidador_de(id_usuario));

drop policy if exists "historial_evento_insert" on public.historial_evento;
create policy "historial_evento_insert" on public.historial_evento
  for insert to authenticated
  with check (id_usuario = auth.uid() or es_cuidador_de(id_usuario));

drop policy if exists "historial_evento_update" on public.historial_evento;
create policy "historial_evento_update" on public.historial_evento
  for update to authenticated
  using (id_usuario = auth.uid() or creada_por = auth.uid())
  with check (id_usuario = auth.uid() or creada_por = auth.uid());

drop policy if exists "historial_evento_delete" on public.historial_evento;
create policy "historial_evento_delete" on public.historial_evento
  for delete to authenticated
  using (id_usuario = auth.uid() or creada_por = auth.uid());

grant select, insert, update, delete on public.historial_evento to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Lectura de recordatorios y de solicitudes de salud por parte del cuidador
--
-- Sin estas políticas la vista devolvería vacío para el cuidador en esas dos
-- fuentes: sólo el adulto dueño de la fila podía leerlas.
-- -----------------------------------------------------------------------------

drop policy if exists "historial_lectura_cuidador" on public.alarma_recordatorio;
create policy "historial_lectura_cuidador" on public.alarma_recordatorio
  for select to authenticated
  using (es_cuidador_de(id_usuario));

drop policy if exists "historial_lectura_cuidador" on public.solicitud_actualizacion_salud;
create policy "historial_lectura_cuidador" on public.solicitud_actualizacion_salud
  for select to authenticated
  using (es_cuidador_de(id_usuario));

-- -----------------------------------------------------------------------------
-- 3. Vista unificada
-- -----------------------------------------------------------------------------

create or replace view public.historial_eventos
with (security_invoker = true) as

select
  'desp:' || d.id || ':ini'                          as id,
  d.id_usuario                                       as id_usuario,
  'desplazamiento'::text                             as tipo,
  'Desplazamiento iniciado'::text                    as titulo,
  case when d.activo then 'En curso'::text end       as detalle,
  d.fecha_inicio                                     as fecha,
  d.id                                               as id_origen
from public.historial_desplazamiento d

union all

select
  'desp:' || d.id || ':fin',
  d.id_usuario,
  'desplazamiento',
  'Desplazamiento finalizado',
  nullif(concat_ws(' · ',
    case
      when d.distancia_metros >= 1000
        then round((d.distancia_metros / 1000.0)::numeric, 2) || ' km'
      when d.distancia_metros is not null
        then round(d.distancia_metros::numeric) || ' m'
    end,
    case
      when d.duracion_segundos >= 60
        then (d.duracion_segundos / 60) || ' min'
      when d.duracion_segundos is not null
        then d.duracion_segundos || ' s'
    end), ' · '),
  d.fecha_fin,
  d.id
from public.historial_desplazamiento d
where d.fecha_fin is not null

union all

select
  'sos:' || s.id || ':creada',
  s.id_adulto,
  'sos',
  'SOS activado',
  'Botón de emergencia presionado',
  s.creada_en,
  s.id
from public.sos_alerta s

union all

select
  'sos:' || s.id || ':ok',
  s.id_adulto,
  'sos',
  'SOS confirmado',
  'Confirmado por un cuidador',
  s.confirmada_en,
  s.id
from public.sos_alerta s
where s.confirmada_en is not null

union all

select
  'zona:' || z.id,
  z.id_usuario,
  'zona',
  'Fuera de zona segura',
  null,
  coalesce(z.primera_alerta, z.creada_en),
  z.id
from public.zona_alerta z
where z.fuera

union all

select
  'viaje:' || v.id || ':ini',
  v.id_usuario,
  'zona',
  'Viaje vigilado iniciado',
  null,
  v.creada_en,
  v.id
from public.zona_viaje v

union all

select
  'viaje:' || v.id || ':fin',
  v.id_usuario,
  'zona',
  'Viaje vigilado terminado',
  null,
  v.termina_en,
  v.id
from public.zona_viaje v
where v.termina_en is not null

union all

select
  'alarma:' || a.id,
  a.id_usuario,
  'recordatorio',
  'Recordatorio confirmado',
  coalesce(nullif(a.nombre, ''), a.descripcion),
  a.confirmado,
  a.id
from public.alarma_recordatorio a
where a.confirmado is not null

union all

select
  'salud:' || s.id || ':pedida',
  s.id_usuario,
  'salud',
  'Solicitud de estado de salud',
  coalesce(nullif(s.motivo, ''), 'Datos de salud solicitados'),
  s.solicitada_en,
  s.id
from public.solicitud_actualizacion_salud s

union all

select
  'salud:' || s.id || ':ok',
  s.id_usuario,
  'salud',
  'Datos de salud actualizados',
  null,
  s.atendida_en,
  s.id
from public.solicitud_actualizacion_salud s
where s.atendida_en is not null

union all

select
  e.id::text,
  e.id_usuario,
  e.tipo,
  e.titulo,
  e.detalle,
  e.fecha,
  coalesce(e.id_origen, e.id)
from public.historial_evento e;

grant select on public.historial_eventos to authenticated;

notify pgrst, 'reload schema';

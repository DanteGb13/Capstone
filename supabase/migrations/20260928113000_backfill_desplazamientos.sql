-- =============================================================================
-- BACKFILL DE DESPLAZAMIENTOS
--
-- Reconstruye los trayectos pasados a partir de los reportes de GPS que ya
-- existen en public.ubicacion (2.454 reportes entre 2026-08-24 y hoy).
--
-- Reglas:
--   * Un tramo nuevo cada vez que pasan más de 5 minutos sin reportes.
--   * Se descartan picos de GPS (más de 30 m/s entre reportes).
--   * Se descartan tramos estáticos o mínimos (< 2 minutos o < 50 metros).
--   * distancia_metros = suma haversine entre reportes consecutivos.
--   * duracion_segundos = fecha_fin - fecha_inicio.
--
-- Idempotente: borra antes lo que hubiera generado con origen='backfill'
-- y lo vuelve a calcular, sin tocar nada que haya escrito la app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Origen de los registros
-- -----------------------------------------------------------------------------

alter table public.historial_desplazamiento
  add column if not exists origen text not null default 'app';

-- -----------------------------------------------------------------------------
-- 2. DELETE que el servicio de la app ya asume (antes no había política)
-- -----------------------------------------------------------------------------

drop policy if exists "usuarios_delete_desplazamientos" on public.historial_desplazamiento;
create policy "usuarios_delete_desplazamientos" on public.historial_desplazamiento
  for delete to authenticated
  using (id_usuario = auth.uid());

drop policy if exists "usuarios_delete_puntos" on public.historial_punto;
create policy "usuarios_delete_puntos" on public.historial_punto
  for delete to authenticated
  using (
    id_desplazamiento in (
      select hd.id
      from public.historial_desplazamiento hd
      where hd.id_usuario = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Empezar de cero sólo con lo que generó este script
-- -----------------------------------------------------------------------------

delete from public.historial_desplazamiento
where origen = 'backfill';

-- -----------------------------------------------------------------------------
-- 4. Reconstrucción de tramos
-- -----------------------------------------------------------------------------

do $$
declare
  v_desplazamientos int;
  v_puntos int;
begin

  drop table if exists tmp_ub_puntos;
  drop table if exists tmp_ub_tramos;

  create temporary table tmp_ub_puntos as
  with bruto as (
    select
      u.id_usuario,
      u.fecha,
      case when u.latitud  ~ '^-?[0-9]+(\.[0-9]+)?$'
           then u.latitud::double precision  end as lat,
      case when u.longitud ~ '^-?[0-9]+(\.[0-9]+)?$'
           then u.longitud::double precision end as lng
    from public.ubicacion u
    where u.id_usuario is not null
      and u.fecha <= now() - interval '10 minutes'
  ),
  valida as (
    select *
    from bruto
    where lat between -90 and 90
      and lng between -180 and 180
      and not (lat = 0 and lng = 0)
  ),
  -- primera pasada: detecta los saltos de GPS
  p1 as (
    select
      v.*,
      lag(v.fecha) over w as f0,
      lag(v.lat)   over w as lat0,
      lag(v.lng)   over w as lng0
    from valida v
    window w as (partition by v.id_usuario order by v.fecha)
  ),
  sin_ruido as (
    select p1.*
    from p1
    where p1.f0 is null
       or extract(epoch from (p1.fecha - p1.f0)) > 300
       or (2 * 6371000 * asin(least(1.0, sqrt(
             pow(sin(radians(p1.lat - p1.lat0) / 2), 2) +
             cos(radians(p1.lat0)) * cos(radians(p1.lat)) *
             pow(sin(radians(p1.lng - p1.lng0) / 2), 2)
           ))))
           / greatest(extract(epoch from (p1.fecha - p1.f0)), 1) <= 30
  ),
  -- segunda pasada: distancia real respecto del reporte anterior válido
  p2 as (
    select
      s.id_usuario,
      s.fecha,
      s.lat,
      s.lng,
      lag(s.fecha) over w as f0,
      lag(s.lat)   over w as lat0,
      lag(s.lng)   over w as lng0
    from sin_ruido s
    window w as (partition by s.id_usuario order by s.fecha)
  ),
  con_dist as (
    select
      p2.id_usuario,
      p2.fecha,
      p2.lat,
      p2.lng,
      p2.f0,
      case
        when p2.f0 is null then null
        when p2.fecha - p2.f0 > interval '5 minutes' then null
        else 2 * 6371000 * asin(least(1.0, sqrt(
          pow(sin(radians(p2.lat - p2.lat0) / 2), 2) +
          cos(radians(p2.lat0)) * cos(radians(p2.lat)) *
          pow(sin(radians(p2.lng - p2.lng0) / 2), 2)
        )))
      end as dist
    from p2
  ),
  -- el tope de 30 m/s también acá: si salta, se corta el tramo
  con_tope as (
    select
      c.*,
      case
        when c.dist is null then false
        else c.dist / greatest(extract(epoch from (c.fecha - c.f0)), 1) > 30
      end as es_salto
    from con_dist c
  ),
  marcado as (
    select
      t.id_usuario,
      t.fecha,
      t.lat,
      t.lng,
      t.f0,
      case when t.es_salto then null else t.dist end as dist,
      case
        when t.f0 is null or t.es_salto then 1
        when t.fecha - t.f0 > interval '5 minutes' then 1
        else 0
      end as inicio_tramo
    from con_tope t
  )
  select
    m.*,
    sum(m.inicio_tramo) over (partition by m.id_usuario order by m.fecha) as tramo
  from marcado m;

  create temporary table tmp_ub_tramos as
  select
    gen_random_uuid()                      as id,
    p.id_usuario,
    p.tramo,
    min(p.fecha)                           as fecha_inicio,
    max(p.fecha)                           as fecha_fin,
    count(*)::int                          as puntos,
    coalesce(sum(p.dist), 0)::double precision as distancia_metros,
    greatest(extract(epoch from (max(p.fecha) - min(p.fecha)))::int, 0)
                                           as duracion_segundos
  from tmp_ub_puntos p
  group by p.id_usuario, p.tramo;

  -- 4a. Los tramos que vale la pena mostrar
  insert into public.historial_desplazamiento (
    id, id_usuario, fecha_inicio, fecha_fin,
    distancia_metros, duracion_segundos, ruta_geojson,
    activo, origen
  )
  select
    t.id,
    t.id_usuario,
    t.fecha_inicio,
    t.fecha_fin,
    t.distancia_metros,
    t.duracion_segundos,
    (
      select jsonb_build_object(
               'type', 'LineString',
               'coordinates',
                 coalesce(jsonb_agg(jsonb_build_array(q.lng, q.lat) order by q.fecha),
                          '[]'::jsonb)
             )
      from tmp_ub_puntos q
      where q.id_usuario = t.id_usuario
        and q.tramo      = t.tramo
    ),
    false,
    'backfill'
  from tmp_ub_tramos t
  where t.puntos >= 2
    and t.duracion_segundos >= 120
    and t.distancia_metros   >= 50;

  get diagnostics v_desplazamientos = row_count;

  -- 4b. Los puntos de cada tramo, en orden
  insert into public.historial_punto (
    id_desplazamiento, latitud, longitud, fecha, precision_metros, orden
  )
  select
    t.id,
    q.lat,
    q.lng,
    q.fecha,
    null,
    row_number() over (partition by t.id order by q.fecha)
  from tmp_ub_tramos t
  join tmp_ub_puntos q
    on q.id_usuario = t.id_usuario
   and q.tramo      = t.tramo
  where t.puntos >= 2
    and t.duracion_segundos >= 120
    and t.distancia_metros   >= 50;

  get diagnostics v_puntos = row_count;

  raise notice 'backfill: % desplazamientos, % puntos',
    v_desplazamientos, v_puntos;

end;
$$;

notify pgrst, 'reload schema';

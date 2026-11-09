-- =====================================================
-- Arreglos de los filtros del panel de control
--
-- Tres cosas:
--
-- 1. El filtro de tipo de usuario no filtraba. Los roles reales son
--    'Usuario' (adulto mayor) y 'Familiar' (cuidador), pero las consultas
--    comparaban contra '%adulto%' y '%cuidador%', que no coinciden con
--    ningún nombre de rol: el contador de cuidadores y el de adultos por
--    rol quedaban en cero y el filtro pasaba de largo.
--
-- 2. El filtro de vinculación filtraba raro. Sólo contemplaba al adulto
--    ("tiene cuidador"), así que un cuidador contaba como "sin cuidador" y
--    el resultado mezclaba perfiles. Ahora es simétrico: tener o no tener
--    algún vínculo, da igual el rol que seas.
--
-- 3. Falta la opción "Todos" en el periodo. Con p_dias <= 0 la ventana es
--    todo el historial; las series diarias se acotan a 90 días para no
--    generar una fila por día desde el inicio de los tiempos.
-- =====================================================
create or replace function public.admin_estadisticas_panel(
  p_dias integer default 0,
  p_rol text default null,
  p_licencia text default null,
  p_vinculacion text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_desde timestamptz := case
    when coalesce(p_dias, 0) <= 0 then '-infinity'::timestamptz
    else now() - greatest(p_dias, 1) * interval '1 day'
  end;
  -- Las series diarias nunca pasan de 90 días: con "Todos" el generate_series
  -- haría una fila por día desde el inicio.
  v_ventana_diaria date := least(greatest(v_desde::date, (now() - interval '89 days')::date), now()::date);
  v_usuarios uuid[];
  v_total integer;
  v_adultos integer;
  v_cuidadores integer;
  v_invitados integer;
  v_licencias integer;
  v_activos integer;
  v_adultos_activos integer;
  v_cuidadores_activos integer;
  v_eventos integer;
  v_ingresos bigint;
  v_mttr numeric;
  v_adultos_totales integer;
  v_adultos_online integer;
  v_adultos_gps integer;
  v_sos integer;
  v_zonas integer;
  v_sin_senal integer;
begin
  if auth.uid() is null or not public.es_administrador() then
    raise exception 'solo un administrador puede consultar estas estadisticas';
  end if;

  select coalesce(array_agg(u.id), array[]::uuid[])
    into v_usuarios
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where
    (p_rol is null or lower(coalesce(r.nombre, '')) like '%' || lower(p_rol) || '%')
    and (
      p_licencia is null
      or (p_licencia = 'premium' and exists (
        select 1 from public.suscripcion s
        where s.usuario_id = u.id and s.estado = 'activa'
      ))
      or (p_licencia = 'gratis' and not exists (
        select 1 from public.suscripcion s
        where s.usuario_id = u.id and s.estado = 'activa'
      ))
    )
    and (
      p_vinculacion is null
      -- Simétrico: vale tanto el vínculo de un adulto con su cuidador como el
      -- de un cuidador con sus adultos. Antes sólo miraba el lado del adulto
      -- y los cuidadores caían todos en "sin cuidador".
      or (p_vinculacion = 'vinculados' and (
        exists (
          select 1 from public.cuidador_usuario cu
          where cu.id_usuario = u.id
        )
        or exists (
          select 1 from public.cuidador c
          join public.cuidador_usuario cu on cu.id_cuidador = c.id
          where c.id_usuario = u.id
        )
      ))
      or (p_vinculacion = 'sin_cuidador' and not exists (
        select 1 from public.cuidador_usuario cu
        where cu.id_usuario = u.id
      ) and not exists (
        select 1 from public.cuidador c
        join public.cuidador_usuario cu on cu.id_cuidador = c.id
        where c.id_usuario = u.id
      ))
    );

  select count(*), count(*) filter (
    where u.fecha_nacimiento <= current_date - interval '65 years'
  )
    into v_total, v_adultos
  from public.usuario u
  where u.id = any(v_usuarios);

  select count(*)
    into v_adultos_totales
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where u.id = any(v_usuarios)
    and lower(coalesce(r.nombre, '')) like '%usuario%';

  select avg(extract(epoch from (a.confirmada_en - a.creada_en)) / 60.0)
    into v_mttr
  from public.sos_alerta a
  where a.creada_en >= v_desde
    and a.id_adulto = any(v_usuarios)
    and a.confirmada_en is not null;

  select count(*)
    into v_adultos_online
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where u.id = any(v_usuarios)
    and lower(coalesce(r.nombre, '')) like '%usuario%'
    and u.ultimo_visto >= now() - interval '2 minutes';

  select count(distinct ub.id_usuario)
    into v_adultos_gps
  from public.ubicacion ub
  where ub.fecha >= now() - interval '5 minutes'
    and ub.id_usuario = any(v_usuarios);

  select count(*)
    into v_sos
  from public.sos_alerta a
  where a.creada_en >= v_desde
    and a.id_adulto = any(v_usuarios);

  select count(*)
    into v_zonas
  from public.analitica_eventos e
  where e.fecha >= v_desde
    and e.usuario_id = any(v_usuarios)
    and (e.ruta ilike '%zona%' or e.evento ilike '%zona%');

  select count(*)
    into v_sin_senal
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where u.id = any(v_usuarios)
    and lower(coalesce(r.nombre, '')) like '%usuario%'
    and (u.ultimo_visto is null or u.ultimo_visto < now() - interval '2 minutes');

  select count(*)
    into v_cuidadores
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where u.id = any(v_usuarios)
    and (
      lower(coalesce(r.nombre, '')) like '%familiar%'
      or exists (
        select 1
        from public.cuidador c
        where c.id_usuario = u.id
      )
    );

  select count(*)
    into v_invitados
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where u.id = any(v_usuarios)
    and lower(coalesce(r.nombre, '')) like '%invitad%';

  select count(distinct s.usuario_id)
    into v_licencias
  from public.suscripcion s
  where s.usuario_id = any(v_usuarios)
    and s.estado = 'activa';

  select count(distinct e.usuario_id), count(*)
    into v_activos, v_eventos
  from public.analitica_eventos e
  where e.fecha >= v_desde
    and e.usuario_id = any(v_usuarios);

  select count(distinct e.usuario_id)
    into v_adultos_activos
  from public.analitica_eventos e
  join public.usuario u on u.id = e.usuario_id
  left join public.rol r on r.id = u.id_rol
  where e.fecha >= v_desde
    and e.usuario_id = any(v_usuarios)
    and lower(coalesce(r.nombre, '')) like '%usuario%';

  select count(distinct e.usuario_id)
    into v_cuidadores_activos
  from public.analitica_eventos e
  join public.usuario u on u.id = e.usuario_id
  left join public.rol r on r.id = u.id_rol
  where e.fecha >= v_desde
    and e.usuario_id = any(v_usuarios)
    and lower(coalesce(r.nombre, '')) like '%familiar%';

  select coalesce(sum(t.monto), 0)
    into v_ingresos
  from public.transaccion_pago t
  where t.estado = 'autorizada'
    and t.creada_en >= v_desde
    and t.usuario_id = any(v_usuarios);

  return jsonb_build_object(
    'total_usuarios', v_total,
    'adultos_mayores', v_adultos,
    'cuidadores', v_cuidadores,
    'invitados', v_invitados,
    'licencias_activas', v_licencias,
    'usuarios_activos', v_activos,
    'adultos_activos', coalesce(v_adultos_activos, 0),
    'cuidadores_activos', coalesce(v_cuidadores_activos, 0),
    'eventos', v_eventos,
    'ingresos', v_ingresos,
    'mttr_minutos', coalesce(round(v_mttr::numeric, 1), 0),
    'adultos_total', v_adultos_totales,
    'adultos_online', v_adultos_online,
    'adultos_gps', v_adultos_gps,
    'adultos_sin_senal', v_sin_senal,
    'alertas_sos', v_sos,
    'alertas_zona', v_zonas,
    'alertas_sin_senal', v_sin_senal,
    'cuidadores_vinculados', (
      select count(distinct c.id_usuario)
      from public.cuidador c
      join public.cuidador_usuario cu on cu.id_cuidador = c.id
      where c.id_usuario = any(v_usuarios)
    ),
    'adultos_vinculados', (
      select count(distinct cu.id_usuario)
      from public.cuidador_usuario cu
      where cu.id_usuario = any(v_usuarios)
    ),
    'adultos_sin_cuidador', greatest(
      (select count(*) from public.usuario u
       left join public.rol r on r.id = u.id_rol
       where u.id = any(v_usuarios)
         and lower(coalesce(r.nombre, '')) like '%usuario%'
         and not exists (select 1 from public.cuidador_usuario cu where cu.id_usuario = u.id)), 0),
    'uso_funcionalidades', (
      select count(distinct e.usuario_id)
      from public.analitica_eventos e
      where e.fecha >= v_desde
        and e.usuario_id = any(v_usuarios)
        and (
          e.ruta ilike '%sos%'
          or e.ruta ilike '%recordatori%'
          or e.ruta ilike '%adulto-mayor%'
        )
    ),
    'ingresos_por_dia',
      coalesce((
        select jsonb_agg(datos order by orden)
        from (
          select jsonb_build_object(
                   'fecha', to_char(dia.fecha, 'YYYY-MM-DD'),
                   'monto', coalesce(sum(t.monto), 0)::bigint
                 ) datos,
                 dia.fecha as orden
          from generate_series(v_ventana_diaria, now()::date, interval '1 day') as dia(fecha)
          left join public.transaccion_pago t
            on t.estado = 'autorizada'
           and t.creada_en::date = dia.fecha
           and t.usuario_id = any(v_usuarios)
          group by dia.fecha
          order by dia.fecha desc
        ) ordenado
      ), '[]'::jsonb),
    'ingresos_mensuales',
      coalesce((
        select jsonb_agg(datos order by orden)
        from (
          select jsonb_build_object(
                   'mes', to_char(date_trunc('month', t.creada_en), 'YYYY-MM'),
                   'monto', coalesce(sum(t.monto), 0)::bigint
                 ) datos,
                 date_trunc('month', t.creada_en) orden
          from public.transaccion_pago t
          where t.estado = 'autorizada'
            and t.creada_en >= date_trunc('month', now()) - interval '11 months'
            and t.usuario_id = any(v_usuarios)
          group by date_trunc('month', t.creada_en)
        ) mensual
      ), '[]'::jsonb),
    'actividad_por_dia',
      coalesce((
        select jsonb_agg(datos order by orden)
        from (
          select jsonb_build_object(
                   'fecha', to_char(dia.fecha, 'YYYY-MM-DD'),
                   'usuarios', count(distinct e.usuario_id)::integer
                 ) datos,
                 dia.fecha as orden
          from generate_series(v_ventana_diaria, now()::date, interval '1 day') as dia(fecha)
          left join public.analitica_eventos e
            on e.fecha::date = dia.fecha
           and e.usuario_id = any(v_usuarios)
          group by dia.fecha
          order by dia.fecha
        ) diario
      ), '[]'::jsonb),
    'alertas_sos_mensuales',
      coalesce((
        select jsonb_agg(datos order by orden)
        from (
          select jsonb_build_object(
                   'mes', to_char(mes.fecha, 'YYYY-MM'),
                   'cantidad', count(a.*)::integer
                 ) datos,
                 mes.fecha as orden
          from generate_series(
            date_trunc('month', now()) - interval '11 months',
            date_trunc('month', now()),
            interval '1 month'
          ) as mes(fecha)
          left join public.sos_alerta a
            on date_trunc('month', a.creada_en) = mes.fecha
           and a.id_adulto = any(v_usuarios)
          group by mes.fecha
          order by mes.fecha
        ) mensual
      ), '[]'::jsonb)
  );
end;
$$;

-- OJO: la firma cambia el default de p_dias (de 30 a 0). Si en la base quedó
-- colgada alguna firma vieja, esto la reemplaza; el drop de más abajo deja
-- sólo la de cuatro parámetros.
drop function if exists public.admin_estadisticas_panel(integer, text, text, text, text);

revoke execute on function public.admin_estadisticas_panel(integer, text, text, text) from public, anon;
grant execute on function public.admin_estadisticas_panel(integer, text, text, text) to authenticated;

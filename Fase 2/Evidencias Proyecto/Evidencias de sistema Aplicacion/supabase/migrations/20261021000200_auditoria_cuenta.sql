-- =====================================================
-- BITACORA: CAMBIO DE CORREO Y DE CONTRASENA
--
-- La tabla `seguridad_auditoria` y la funcion `registrar_evento_seguridad`
-- dejaban pasar seis acciones nombradas y rechazaban cualquier otra: un
-- `CHECK` en la tabla y una lista blanca dentro de la funcion. Cambiar el
-- correo o la contrasena desde la web caia en las dos, asi que la llamada
-- del cliente habria fallado con "accion de auditoria no permitida".
--
-- Se agrega `cambio_correo` y `cambio_contrasena` a los dos lugares.
-- Se puede volver a correr cuantas veces haga falta.
-- =====================================================

alter table public.seguridad_auditoria
  drop constraint if exists seguridad_auditoria_accion_valida;

alter table public.seguridad_auditoria
  add constraint seguridad_auditoria_accion_valida check (
    accion in (
      'sesion_iniciada',
      'sesion_cerrada',
      'inicio_sesion_fallido',
      'cambio_rol',
      'cambio_estado',
      'exportacion_reporte',
      'cambio_correo',
      'cambio_contrasena'
    )
  );


-- La funcion se reemplaza completa: `create or replace` no permite editar
-- el cuerpo por partes y conserva los permisos ya otorgados. Todo lo demas
-- (security definer, el actor fijo desde auth.uid(), el rechazo de sesiones
-- invalidas) queda exactamente igual.
create or replace function public.registrar_evento_seguridad(
  p_accion      text,
  p_objetivo    uuid    default null,
  p_tabla       text    default null,
  p_registro    text    default null,
  p_detalle     jsonb   default null,
  p_plataforma  text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_acciones constant text[] := array[
    'sesion_iniciada',
    'sesion_cerrada',
    'inicio_sesion_fallido',
    'cambio_rol',
    'cambio_estado',
    'exportacion_reporte',
    'cambio_correo',
    'cambio_contrasena'
  ];
begin
  if v_actor is null then
    raise exception 'sin sesion no hay bitacora';
  end if;

  if p_accion is null or not (p_accion = any (v_acciones)) then
    raise exception 'accion de auditoria no permitida: %', coalesce(p_accion, '(nula)');
  end if;

  insert into public.seguridad_auditoria (
    usuario_id, objetivo_id, accion, tabla_afectada, registro_id, detalle, plataforma
  ) values (
    v_actor,
    coalesce(p_objetivo, v_actor),
    p_accion,
    p_tabla,
    p_registro,
    p_detalle,
    p_plataforma
  );
end;
$$;

-- Vuelve a dejar la ejecucion solo en la app autenticada (el `revoke`
-- explicito por si algun dia se habilito para otro rol).
revoke execute on function public.registrar_evento_seguridad(text, uuid, text, text, jsonb, text)
  from public, anon;
grant execute on function public.registrar_evento_seguridad(text, uuid, text, text, jsonb, text)
  to authenticated;

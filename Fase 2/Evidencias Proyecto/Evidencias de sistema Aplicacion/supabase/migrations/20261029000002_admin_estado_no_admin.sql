-- Corrige la protección del último administrador.
-- La regla sólo debe aplicarse cuando la cuenta objetivo tiene el rol Administrador.
create or replace function public.admin_cambiar_estado(
  p_usuario uuid,
  p_activo  boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_activo    boolean;
  v_es_admin  boolean := false;
begin
  if v_actor is null then
    raise exception 'sin sesión';
  end if;

  if not public.es_administrador() then
    raise exception 'sólo un administrador puede cambiar el estado de una cuenta';
  end if;

  if p_usuario is null or p_activo is null then
    raise exception 'faltan datos para cambiar el estado';
  end if;

  if p_usuario = v_actor then
    raise exception 'no puedes cambiar el estado de tu propia cuenta';
  end if;

  select coalesce(u.estado, true),
         r.nombre = 'Administrador'
    into v_activo, v_es_admin
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where u.id = p_usuario;

  if v_activo is null then
    raise exception 'esa cuenta no existe';
  end if;

  if v_activo = p_activo then
    return p_activo;
  end if;

  if not p_activo
     and v_es_admin
     and public.admins_activos() <= 1 then
    raise exception 'no se puede desactivar al último administrador activo';
  end if;

  update public.usuario
     set estado = p_activo
   where id = p_usuario;

  insert into public.seguridad_auditoria (
    usuario_id, objetivo_id, accion, tabla_afectada, registro_id, detalle
  ) values (
    v_actor, p_usuario, 'cambio_estado', 'usuario', p_usuario::text,
    jsonb_build_object('estado_anterior', v_activo, 'estado_nuevo', p_activo)
  );

  return p_activo;
end;
$$;

revoke execute on function public.admin_cambiar_estado(uuid, boolean) from public, anon;
grant execute on function public.admin_cambiar_estado(uuid, boolean) to authenticated;

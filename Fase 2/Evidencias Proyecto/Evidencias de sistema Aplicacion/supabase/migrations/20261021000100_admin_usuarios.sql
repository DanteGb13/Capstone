-- =====================================================
-- ADMINISTRACIÓN DE USUARIOS DESDE LA WEB
--
-- Dos funciones que el panel usa para cambiar el ROL y el ESTADO de una
-- cuenta. Las dos corren con `security definer`.
--
-- ¿POR QUÉ UNA FUNCIÓN Y NO UNA POLÍTICA UPDATE SOBRE "usuario"?
--
-- Porque una política mal escrita sobre `usuario` es el hueco más caro de
-- toda la base: `using (auth.uid() = id)` permite que cualquiera se edite
-- su propio `id_rol` y se promueva a Administrador. Con una función el
-- UPDATE sólo ocurre adentro de código que ya validó quién es el llamador,
-- y afuera no se abre ninguna política nueva.
--
-- ESTE ARCHIVO NO TOCA NINGUNA POLÍTICA EXISTENTE. Cambia el RLS de nadie,
-- así que no puede romper el login de la app ni el de la web.
--
-- Depende de:
--   - 20260930000000_analitica.sql  (trae public.es_administrador())
--   - 20261021000000_auditoria.sql  (trae la bitácora)
--
-- Se puede volver a correr cuantas veces haga falta.
-- =====================================================

-- ---------------------------------------------------------------
-- Roles disponibles
--
-- Se expone como función en vez de dejar que la pantalla lea la tabla
-- `rol` directo: esa tabla no tiene RLS y habría que encenderla, lo que
-- rompería el join `rol(nombre)` de todos los guards. Con esto la pantalla
-- pide los roles y la base responde sin tocar nada más.
-- ---------------------------------------------------------------
create or replace function public.admin_listar_roles()
returns table (id uuid, nombre text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.nombre
  from public.rol r
  order by r.nombre;
$$;

revoke execute on function public.admin_listar_roles() from public, anon;
grant execute on function public.admin_listar_roles() to authenticated;


-- ---------------------------------------------------------------
-- Contador de administradores activos
--
-- Compartido por las dos funciones de abajo: el administrador no se puede
-- dejar a sí mismo fuera de su propio panel, y tampoco puede quedar una
-- instalación sin ningún administrador vivo.
--
-- Vive en público como las demás, pero sin grant: la app no la necesita,
-- sólo la llaman las dos funciones de más abajo.
-- ---------------------------------------------------------------
create or replace function public.admins_activos()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.usuario u
  join public.rol r on r.id = u.id_rol
  where r.nombre = 'Administrador'
    and coalesce(u.estado, true);
$$;

revoke execute on function public.admins_activos() from public, anon, authenticated;


-- ---------------------------------------------------------------
-- Cambiar el rol de una cuenta
-- ---------------------------------------------------------------
create or replace function public.admin_cambiar_rol(
  p_usuario uuid,
  p_rol_id  uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_rol_actual text;
  v_rol_nuevo  text;
begin
  if v_actor is null then
    raise exception 'sin sesión';
  end if;

  if not public.es_administrador() then
    raise exception 'sólo un administrador puede cambiar roles';
  end if;

  if p_usuario is null or p_rol_id is null then
    raise exception 'faltan datos para cambiar el rol';
  end if;

  -- No se cambia el propio rol: es la manera más simple de que nadie se
  -- degrade a sí mismo ni se auto-promueva desde el panel.
  if p_usuario = v_actor then
    raise exception 'no puedes cambiar tu propio rol';
  end if;

  select r.nombre into v_rol_actual
  from public.usuario u
  left join public.rol r on r.id = u.id_rol
  where u.id = p_usuario;

  if v_rol_actual is null then
    raise exception 'esa cuenta no existe';
  end if;

  select r.nombre into v_rol_nuevo
  from public.rol r
  where r.id = p_rol_id;

  if v_rol_nuevo is null then
    raise exception 'ese rol no existe';
  end if;

  if v_rol_actual = v_rol_nuevo then
    return v_rol_nuevo;
  end if;

  -- Quitarle el rol a la última cuenta administradora activa deja el panel
  -- sin nadie que pueda entrar a arreglarlo.
  if v_rol_actual = 'Administrador'
     and v_rol_nuevo <> 'Administrador'
     and public.admins_activos() <= 1 then
    raise exception 'no se puede quitar el rol al último administrador activo';
  end if;

  update public.usuario
     set id_rol = p_rol_id
   where id = p_usuario;

  -- La bitácora se escribe DESPUÉS del cambio y con la misma transacción:
  -- si el UPDATE falla no queda registro fantasma, y si el INSERT de la
  -- bitácora falla se deshace el cambio entero. Los dos van juntos o no va.
  insert into public.seguridad_auditoria (
    usuario_id, objetivo_id, accion, tabla_afectada, registro_id, detalle
  ) values (
    v_actor, p_usuario, 'cambio_rol', 'usuario', p_usuario::text,
    jsonb_build_object('rol_anterior', v_rol_actual, 'rol_nuevo', v_rol_nuevo)
  );

  return v_rol_nuevo;
end;
$$;

revoke execute on function public.admin_cambiar_rol(uuid, uuid) from public, anon;
grant execute on function public.admin_cambiar_rol(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------
-- Activar o desactivar una cuenta
-- ---------------------------------------------------------------
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
  v_actor    uuid := auth.uid();
  v_activo   boolean;
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

  select coalesce(u.estado, true) into v_activo
  from public.usuario u
  where u.id = p_usuario;

  if v_activo is null then
    raise exception 'esa cuenta no existe';
  end if;

  if v_activo = p_activo then
    return p_activo;
  end if;

  -- Desactivar al último administrador activo deja el panel huérfano.
  if not p_activo
     and v_activo
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

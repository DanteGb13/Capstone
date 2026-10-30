create or replace function public.admin_listar_usuarios()
returns table (
  id uuid,
  nombre text,
  apellidopa text,
  apellidoma text,
  correo text,
  rut text,
  telefono text,
  fecha_nacimiento date,
  estado boolean,
  ultimo_visto timestamptz,
  fecha_confirmacion timestamptz,
  id_direccion uuid,
  direccion_region text,
  direccion_comuna text,
  direccion_calle text,
  direccion_numero text,
  id_rol uuid,
  rol_nombre text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.es_administrador() then
    raise exception 'solo un administrador puede listar usuarios';
  end if;

  return query
  select
    u.id,
    u.nombre::text,
    u.apellidopa::text,
    u.apellidoma::text,
    u.correo::text,
    u.rut::text,
    u.telefono::text,
    u.fecha_nacimiento::date,
    u.estado,
    u.ultimo_visto::timestamptz,
    coalesce(a.confirmed_at, a.created_at)::timestamptz,
    u.id_direccion,
    d.region::text,
    d.comuna::text,
    d.calle::text,
    d.numero::text,
    u.id_rol,
    r.nombre::text
  from public.usuario u
  left join auth.users a on a.id = u.id
  left join public.direccion d on d.id = u.id_direccion
  left join public.rol r on r.id = u.id_rol
  order by u.nombre;
end;
$$;

revoke execute on function public.admin_listar_usuarios() from public, anon;
grant execute on function public.admin_listar_usuarios() to authenticated;

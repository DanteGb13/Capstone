create or replace function public.admin_actualizar_usuario(
  p_usuario uuid,
  p_nombre text,
  p_apellidopa text,
  p_apellidoma text,
  p_correo text,
  p_rut text,
  p_telefono text,
  p_fecha_nacimiento date,
  p_rol_id uuid,
  p_direccion_id uuid,
  p_region text,
  p_comuna text,
  p_calle text,
  p_numero text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_direccion_id uuid := p_direccion_id;
begin
  if auth.uid() is null or not public.es_administrador() then
    raise exception 'solo un administrador puede editar usuarios';
  end if;

  if p_usuario is null or coalesce(trim(p_nombre), '') = '' then
    raise exception 'faltan datos obligatorios';
  end if;

  if not exists (select 1 from public.rol where id = p_rol_id) then
    raise exception 'tipo de cuenta invalido';
  end if;

  if nullif(trim(coalesce(p_correo, '')), '') is null then
    raise exception 'el correo es obligatorio';
  end if;

  if exists (
    select 1
    from public.usuario
    where lower(trim(correo)) = lower(trim(p_correo))
      and id <> p_usuario
  ) then
    raise exception 'el correo ya esta registrado en otra cuenta';
  end if;

  if nullif(trim(coalesce(p_rut, '')), '') is not null
     and exists (
       select 1
       from public.usuario
       where upper(regexp_replace(trim(rut), '[^0-9kK]', '', 'g'))
             = upper(regexp_replace(trim(p_rut), '[^0-9kK]', '', 'g'))
         and id <> p_usuario
     ) then
    raise exception 'el rut ya esta registrado en otra cuenta';
  end if;

  if v_direccion_id is null then
    insert into public.direccion (region, comuna, calle, numero)
    values (p_region, p_comuna, p_calle, p_numero)
    returning id into v_direccion_id;
  else
    update public.direccion
       set region = p_region,
           comuna = p_comuna,
           calle = p_calle,
           numero = p_numero
     where id = v_direccion_id;
  end if;

  update public.usuario
     set nombre = trim(p_nombre),
         apellidopa = nullif(trim(coalesce(p_apellidopa, '')), ''),
         apellidoma = nullif(trim(coalesce(p_apellidoma, '')), ''),
         correo = trim(p_correo),
         rut = nullif(trim(coalesce(p_rut, '')), ''),
         telefono = nullif(trim(coalesce(p_telefono, '')), ''),
         fecha_nacimiento = p_fecha_nacimiento,
         id_rol = p_rol_id,
         id_direccion = v_direccion_id
   where id = p_usuario;

  if not found then
    raise exception 'usuario no encontrado';
  end if;
end;
$$;

revoke execute on function public.admin_actualizar_usuario(uuid, text, text, text, text, text, text, date, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_actualizar_usuario(uuid, text, text, text, text, text, text, date, uuid, uuid, text, text, text, text) to authenticated;

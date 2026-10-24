-- =====================================================
-- BITÁCORA DE SEGURIDAD
--
-- Registra QUIÉN hizo QUÉ y CUÁNDO sobre una cuenta: cambio de rol,
-- cambio de estado, exportación de reporte, inicio/cierre de sesión.
--
-- Es la pieza que convierte "el admin tiene un panel" en algo auditable
-- (ISO/IEC 27001, control A.8.15 del anexo A / ISO 27002).
--
-- DISEÑO: SOLO APPEND.
--  - No hay política de UPDATE ni de DELETE: nadie puede editar ni borrar
--    lo que ya quedó registrado, ni siquiera el administrador.
--  - El cliente tampoco puede INSERTAR: no hay política de inserción.
--    Los eventos entran por funciones `security definer`, que corren como
--    el dueño del esquema y saltan el RLS. Así una fila mal escrita nunca
--    rompe la operación de negocio que la originó.
--
-- Se puede volver a correr cuantas veces haga falta.
-- =====================================================

create table if not exists public.seguridad_auditoria (
  id            bigint generated always as identity primary key,
  -- Quién ejecutó la acción. Se fija desde auth.uid() dentro de la función,
  -- nunca desde el cliente: si viniera de afuera sería falsificable.
  usuario_id    uuid references auth.users (id) on delete set null,
  -- Sobre quién recayó la acción. Puede ser el mismo (un login).
  objetivo_id   uuid references auth.users (id) on delete set null,
  accion        text not null,
  tabla_afectada text,
  registro_id   text,
  detalle       jsonb,
  plataforma    text,
  fecha         timestamptz not null default now(),

  constraint seguridad_auditoria_accion_valida check (
    accion in (
      'sesion_iniciada',
      'sesion_cerrada',
      'inicio_sesion_fallido',
      'cambio_rol',
      'cambio_estado',
      'exportacion_reporte'
    )
  )
);

-- El panel ordena siempre por fecha, y el detalle de un usuario por su id.
create index if not exists seguridad_auditoria_fecha_idx
  on public.seguridad_auditoria (fecha desc);

create index if not exists seguridad_auditoria_objetivo_fecha_idx
  on public.seguridad_auditoria (objetivo_id, fecha desc);

create index if not exists seguridad_auditoria_usuario_fecha_idx
  on public.seguridad_auditoria (usuario_id, fecha desc);

alter table public.seguridad_auditoria enable row level security;

-- Sólo el Administrador lee la bitácora. Sin esto, cualquier cuenta
-- autenticada podría ver quién exportó qué y quién cambió de rol.
drop policy if exists "solo el administrador lee la auditoria"
  on public.seguridad_auditoria;

create policy "solo el administrador lee la auditoria"
  on public.seguridad_auditoria
  for select to authenticated
  using (public.es_administrador());

-- OJO: no se crea política de insert/update/delete a propósito.
-- Quien intente escribir desde la app recibe "permission denied", y eso es
-- exactamente lo que se quiere: la bitácora no se toca desde el cliente.


-- =====================================================
-- FUNCIÓN: REGISTRAR UN EVENTO
--
-- Única puerta de entrada. Corre como su dueño, así que el RLS de la tabla
-- no se lo pone en el camino, y le impone tres reglas que el cliente no
-- puede saltar:
--
--   1. El actor es SIEMPRE quien llama (auth.uid()), no lo que pida la app.
--   2. La acción tiene que estar en la lista; si no, no se registra nada.
--   3. Sin actor (sesión inválida) no hay evento: no existe bitácora anónima.
-- =====================================================

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
    'exportacion_reporte'
  ];
begin
  if v_actor is null then
    raise exception 'sin sesión no hay bitácora';
  end if;

  if p_accion is null or not (p_accion = any (v_acciones)) then
    raise exception 'acción de auditoría no permitida: %', coalesce(p_accion, '(nula)');
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

-- Sólo a la app autenticada: el visitante sin cuenta no registra nada.
revoke execute on function public.registrar_evento_seguridad(text, uuid, text, text, jsonb, text)
  from public, anon;
grant execute on function public.registrar_evento_seguridad(text, uuid, text, text, jsonb, text)
  to authenticated;

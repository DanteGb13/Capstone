-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.usuario (
  id uuid NOT NULL,
  nombre character varying NOT NULL,
  apellidopa character varying,
  apellidoma character varying,
  telefono character varying,
  rut character varying UNIQUE,
  correo character varying NOT NULL UNIQUE,
  id_rol uuid NOT NULL,
  estado boolean NOT NULL,
  id_ubicación uuid,
  id_direccion uuid,
  fecha_nacimiento date,
  ultimo_cambio_correo timestamp with time zone,
  contrasena text DEFAULT ''::text,
  foto_perfil text,
  ultimo_visto timestamp with time zone,
  CONSTRAINT usuario_pkey PRIMARY KEY (id),
  CONSTRAINT usuario_id_direccion_fkey FOREIGN KEY (id_direccion) REFERENCES public.direccion(id),
  CONSTRAINT usuario_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.rol(id),
  CONSTRAINT usuario_id_ubicación_fkey FOREIGN KEY (id_ubicación) REFERENCES public.ubicacion(id),
  CONSTRAINT usuario_id_auth_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.direccion (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  region character varying,
  comuna character varying,
  calle character varying,
  numero character varying,
  CONSTRAINT direccion_pkey PRIMARY KEY (id)
);
CREATE TABLE public.ubicacion (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  latitud character varying NOT NULL,
  longitud character varying NOT NULL,
  fecha timestamp with time zone NOT NULL,
  id_usuario uuid,
  CONSTRAINT ubicacion_pkey PRIMARY KEY (id),
  CONSTRAINT ubicacion_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.rol (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre character varying NOT NULL UNIQUE,
  descripcion text,
  CONSTRAINT rol_pkey PRIMARY KEY (id)
);
CREATE TABLE public.cuidador_usuario (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_cuidador uuid NOT NULL,
  id_usuario uuid NOT NULL,
  CONSTRAINT cuidador_usuario_pkey PRIMARY KEY (id),
  CONSTRAINT cuidador_usuario_id_cuidador_fkey FOREIGN KEY (id_cuidador) REFERENCES public.cuidador(id),
  CONSTRAINT cuidador_usuario_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.cuidador (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL UNIQUE,
  CONSTRAINT cuidador_pkey PRIMARY KEY (id),
  CONSTRAINT cuidador_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.contacto_emergencia (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre character varying NOT NULL,
  apellidopa character varying,
  apellidoma character varying,
  correo character varying,
  telefono text,
  id_relacion uuid,
  id_usuario uuid,
  CONSTRAINT contacto_emergencia_pkey PRIMARY KEY (id),
  CONSTRAINT contacto_emergencia_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id),
  CONSTRAINT contacto_emergencia_id_relacion_fkey FOREIGN KEY (id_relacion) REFERENCES public.relacion(id)
);
CREATE TABLE public.relacion (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre character varying DEFAULT ''::character varying,
  CONSTRAINT relacion_pkey PRIMARY KEY (id)
);
CREATE TABLE public.codigo_vinculacion (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  codigo character varying NOT NULL UNIQUE,
  fecha_creacion timestamp with time zone NOT NULL DEFAULT now(),
  fecha_expiracion timestamp with time zone,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT codigo_vinculacion_pkey PRIMARY KEY (id),
  CONSTRAINT codigo_vinculacion_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.solicitud_vinculacion (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_cuidador uuid,
  id_usuario uuid NOT NULL,
  estado character varying NOT NULL DEFAULT 'pendiente'::character varying CHECK (estado::text = ANY (ARRAY['pendiente'::character varying, 'aceptada'::character varying, 'rechazada'::character varying]::text[])),
  fecha_solicitud timestamp with time zone NOT NULL DEFAULT now(),
  fecha_respuesta timestamp with time zone,
  codigo character varying UNIQUE,
  CONSTRAINT solicitud_vinculacion_pkey PRIMARY KEY (id),
  CONSTRAINT solicitud_cuidador_fkey FOREIGN KEY (id_cuidador) REFERENCES public.cuidador(id),
  CONSTRAINT solicitud_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.verificacion_correo (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  correo_nuevo character varying NOT NULL,
  codigo character varying NOT NULL,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  expira_en timestamp with time zone NOT NULL,
  utilizado boolean NOT NULL DEFAULT false,
  CONSTRAINT verificacion_correo_pkey PRIMARY KEY (id),
  CONSTRAINT verificacion_correo_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES auth.users(id)
);
CREATE TABLE public.verificacion_contrasena (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  codigo text NOT NULL,
  expira_en timestamp with time zone NOT NULL,
  intentos integer DEFAULT 0,
  utilizado boolean DEFAULT false,
  creado_en timestamp with time zone DEFAULT now(),
  CONSTRAINT verificacion_contrasena_pkey PRIMARY KEY (id),
  CONSTRAINT verificacion_contrasena_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES auth.users(id)
);
CREATE TABLE public.zona_segura (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  latitud_centro character varying NOT NULL,
  longitud_centro character varying NOT NULL,
  radio_metros integer NOT NULL DEFAULT 500,
  direccion_texto character varying,
  region character varying,
  comuna character varying,
  calle character varying,
  numero character varying,
  activa boolean NOT NULL DEFAULT true,
  fecha_creacion timestamp with time zone NOT NULL DEFAULT now(),
  fecha_actualizacion timestamp with time zone NOT NULL DEFAULT now(),
  nombre character varying NOT NULL DEFAULT ''::character varying,
  es_casa boolean NOT NULL DEFAULT false,
  CONSTRAINT zona_segura_pkey PRIMARY KEY (id),
  CONSTRAINT zona_segura_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.alarma_recordatorio (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  nombre character varying NOT NULL,
  hora integer NOT NULL CHECK (hora >= 0 AND hora < 24),
  minuto integer NOT NULL CHECK (minuto >= 0 AND minuto < 60),
  descripcion text DEFAULT ''::text,
  activa boolean NOT NULL DEFAULT true,
  confirmado timestamp with time zone,
  dias ARRAY NOT NULL DEFAULT '{1,2,3,4,5,6,7}'::integer[],
  fecha_creacion timestamp with time zone NOT NULL DEFAULT now(),
  fecha_actualizacion timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT alarma_recordatorio_pkey PRIMARY KEY (id),
  CONSTRAINT alarma_recordatorio_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.historial_desplazamiento (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  fecha_inicio timestamp with time zone NOT NULL DEFAULT now(),
  fecha_fin timestamp with time zone,
  distancia_metros double precision DEFAULT 0,
  duracion_segundos integer DEFAULT 0,
  ruta_geojson jsonb,
  activo boolean NOT NULL DEFAULT true,
  origen text NOT NULL DEFAULT 'app'::text,
  CONSTRAINT historial_desplazamiento_pkey PRIMARY KEY (id),
  CONSTRAINT historial_desplazamiento_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.historial_punto (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_desplazamiento uuid NOT NULL,
  latitud double precision NOT NULL,
  longitud double precision NOT NULL,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  precision_metros double precision,
  orden integer NOT NULL DEFAULT 0,
  CONSTRAINT historial_punto_pkey PRIMARY KEY (id),
  CONSTRAINT historial_punto_id_desplazamiento_fkey FOREIGN KEY (id_desplazamiento) REFERENCES public.historial_desplazamiento(id)
);
CREATE TABLE public.push_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  token text NOT NULL,
  plataforma text NOT NULL DEFAULT 'android'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT push_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT push_tokens_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.zona_alerta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  fuera boolean NOT NULL DEFAULT false,
  primera_alerta timestamp with time zone,
  ultima_notificacion timestamp with time zone,
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizada_en timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT zona_alerta_pkey PRIMARY KEY (id),
  CONSTRAINT zona_alerta_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.sos_alerta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_adulto uuid NOT NULL,
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  confirmada_por uuid,
  confirmada_en timestamp with time zone,
  CONSTRAINT sos_alerta_pkey PRIMARY KEY (id),
  CONSTRAINT sos_alerta_id_adulto_fkey FOREIGN KEY (id_adulto) REFERENCES public.usuario(id),
  CONSTRAINT sos_alerta_confirmada_por_fkey FOREIGN KEY (confirmada_por) REFERENCES public.usuario(id)
);
CREATE TABLE public.zona_viaje (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  id_cuidador uuid NOT NULL,
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  termina_en timestamp with time zone,
  CONSTRAINT zona_viaje_pkey PRIMARY KEY (id),
  CONSTRAINT zona_viaje_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id),
  CONSTRAINT zona_viaje_id_cuidador_fkey FOREIGN KEY (id_cuidador) REFERENCES public.usuario(id)
);
CREATE TABLE public.zona_viaje_estado (
  id_usuario uuid NOT NULL,
  lat double precision,
  lng double precision,
  dentro boolean,
  bateria integer,
  fecha timestamp with time zone,
  lat_fija double precision,
  lng_fija double precision,
  desde_fija timestamp with time zone,
  ult_senal timestamp with time zone,
  ult_parada timestamp with time zone,
  ult_bateria timestamp with time zone,
  CONSTRAINT zona_viaje_estado_pkey PRIMARY KEY (id_usuario),
  CONSTRAINT zona_viaje_estado_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.signos_vitales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL UNIQUE,
  pasos integer,
  distancia_metros numeric,
  calorias numeric,
  fc_media numeric,
  fc_minima numeric,
  fc_maxima numeric,
  fc_reposo numeric,
  spo2 numeric,
  respiracion numeric,
  sueno_minutos integer,
  fuente text,
  dispositivo text,
  fecha_actualizacion timestamp with time zone NOT NULL DEFAULT now(),
  fc_ultima_hora timestamp with time zone,
  spo2_ultima_hora timestamp with time zone,
  sueno_ultima_noche timestamp with time zone,
  CONSTRAINT signos_vitales_pkey PRIMARY KEY (id),
  CONSTRAINT signos_vitales_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id)
);
CREATE TABLE public.solicitud_actualizacion_salud (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  id_cuidador uuid,
  solicitada_en timestamp with time zone NOT NULL DEFAULT now(),
  atendida_en timestamp with time zone,
  motivo text,
  CONSTRAINT solicitud_actualizacion_salud_pkey PRIMARY KEY (id),
  CONSTRAINT solicitud_actualizacion_salud_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id),
  CONSTRAINT solicitud_actualizacion_salud_id_cuidador_fkey FOREIGN KEY (id_cuidador) REFERENCES public.usuario(id)
);
CREATE TABLE public.historial_evento (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL,
  id_origen uuid,
  tipo text NOT NULL DEFAULT 'manual'::text CHECK (tipo = ANY (ARRAY['manual'::text, 'llamada'::text, 'nota'::text, 'estado_casa'::text, 'ubicacion'::text])),
  titulo text NOT NULL CHECK (char_length(titulo) >= 1 AND char_length(titulo) <= 120),
  detalle text CHECK (detalle IS NULL OR char_length(detalle) <= 500),
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  creada_por uuid DEFAULT auth.uid(),
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT historial_evento_pkey PRIMARY KEY (id),
  CONSTRAINT historial_evento_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id),
  CONSTRAINT historial_evento_creada_por_fkey FOREIGN KEY (creada_por) REFERENCES public.usuario(id)
);
CREATE TABLE public.analitica_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  usuario_id uuid,
  ruta text NOT NULL,
  evento text NOT NULL DEFAULT 'vista_pagina'::text,
  plataforma text NOT NULL DEFAULT 'web'::text,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analitica_eventos_pkey PRIMARY KEY (id),
  CONSTRAINT analitica_eventos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id)
);
CREATE TABLE public.seguridad_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  usuario_id uuid,
  objetivo_id uuid,
  accion text NOT NULL CHECK (accion = ANY (ARRAY['sesion_iniciada'::text, 'sesion_cerrada'::text, 'inicio_sesion_fallido'::text, 'cambio_rol'::text, 'cambio_estado'::text, 'exportacion_reporte'::text, 'cambio_correo'::text, 'cambio_contrasena'::text])),
  tabla_afectada text,
  registro_id text,
  detalle jsonb,
  plataforma text,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT seguridad_auditoria_pkey PRIMARY KEY (id),
  CONSTRAINT seguridad_auditoria_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id),
  CONSTRAINT seguridad_auditoria_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES auth.users(id)
);
CREATE TABLE public.plan_suscripcion (
  codigo text NOT NULL,
  nombre text NOT NULL,
  precio_clp integer NOT NULL CHECK (precio_clp > 0),
  duracion_dias integer NOT NULL CHECK (duracion_dias > 0),
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT plan_suscripcion_pkey PRIMARY KEY (codigo)
);
CREATE TABLE public.suscripcion (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  plan_codigo text NOT NULL,
  estado text NOT NULL CHECK (estado = ANY (ARRAY['pendiente'::text, 'activa'::text, 'cancelada'::text, 'vencida'::text])),
  inicia_en timestamp with time zone,
  vence_en timestamp with time zone,
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizada_en timestamp with time zone NOT NULL DEFAULT now(),
  cancelacion_programada_en timestamp with time zone,
  cancelada_en timestamp with time zone,
  devolucion_solicitada_en timestamp with time zone,
  devolucion_estado text,
  credito_prorrateado_clp integer NOT NULL DEFAULT 0,
  plan_anterior_codigo text,
  mejora_en timestamp with time zone,
  plan_anterior_inicia_en timestamp with time zone,
  plan_anterior_vence_en timestamp with time zone,
  CONSTRAINT suscripcion_pkey PRIMARY KEY (id),
  CONSTRAINT suscripcion_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id),
  CONSTRAINT suscripcion_plan_codigo_fkey FOREIGN KEY (plan_codigo) REFERENCES public.plan_suscripcion(codigo),
  CONSTRAINT suscripcion_plan_anterior_codigo_fkey FOREIGN KEY (plan_anterior_codigo) REFERENCES public.plan_suscripcion(codigo)
);
CREATE TABLE public.transaccion_pago (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  suscripcion_id uuid,
  plan_codigo text NOT NULL,
  buy_order text NOT NULL UNIQUE,
  token_transbank text,
  monto integer NOT NULL CHECK (monto > 0),
  estado text NOT NULL CHECK (estado = ANY (ARRAY['creada'::text, 'procesando'::text, 'autorizada'::text, 'rechazada'::text, 'anulada'::text])),
  respuesta_transbank jsonb,
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizada_en timestamp with time zone NOT NULL DEFAULT now(),
  monto_original_clp integer,
  credito_prorrateado_clp integer NOT NULL DEFAULT 0,
  tipo text NOT NULL DEFAULT 'nueva'::text,
  CONSTRAINT transaccion_pago_pkey PRIMARY KEY (id),
  CONSTRAINT transaccion_pago_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id),
  CONSTRAINT transaccion_pago_suscripcion_id_fkey FOREIGN KEY (suscripcion_id) REFERENCES public.suscripcion(id),
  CONSTRAINT transaccion_pago_plan_codigo_fkey FOREIGN KEY (plan_codigo) REFERENCES public.plan_suscripcion(codigo)
);
CREATE TABLE public.metodo_pago (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL UNIQUE,
  tipo text NOT NULL DEFAULT 'tarjeta'::text CHECK (tipo = 'tarjeta'::text),
  marca text NOT NULL,
  ultimos_cuatro text NOT NULL CHECK (ultimos_cuatro ~ '^\d{4}$'::text),
  mes_expiracion integer NOT NULL CHECK (mes_expiracion >= 1 AND mes_expiracion <= 12),
  ano_expiracion integer NOT NULL CHECK (ano_expiracion >= 2026 AND ano_expiracion <= 2100),
  titular text NOT NULL,
  numero_encriptado text NOT NULL,
  iv_encriptacion text NOT NULL,
  es_predeterminado boolean NOT NULL DEFAULT true,
  creada_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizada_en timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT metodo_pago_pkey PRIMARY KEY (id),
  CONSTRAINT metodo_pago_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id)
);
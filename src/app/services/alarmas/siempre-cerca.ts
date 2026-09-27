import { registerPlugin } from '@capacitor/core';

export interface SesionBackend {
  url: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: number;
}

export interface VibrarOpciones {
  /** Duración de cada pulso en ms */
  duracionMs?: number;
  /** Cuántos pulsos dar */
  veces?: number;
  /** Pausa entre pulsos en ms */
  descansoMs?: number;
  /** Intensidad 1..255 (255 = máxima) */
  amplitud?: number;
}

/**
 * Estado real de las notificaciones.
 *
 * El permiso POST_NOTIFICATIONS y los canales son cosas distintas: se puede
 * tener el permiso concedido y haber apagado a mano el canal "Alertas SOS" en
 * Ajustes. Con sólo mirar `checkPermissions()` la app cree que está todo bien
 * y el SOS suena en silencio, que es el peor falla: parece que funciona.
 */
export interface EstadoNotificaciones {
  /** Permiso POST_NOTIFICATIONS concedido. */
  habilitadas: boolean;
  sosActivo: boolean;
  zonaAlertaActivo: boolean;
  zonaEstadoActivo: boolean;
  alarmaActivo: boolean;
  /** Sin esto el SOS no suena, aunque el permiso esté concedido. */
  alertaFunciona: boolean;
}

/**
 * Estado real de un permiso de Android.
 *
 * `puedePedir` es false cuando el usuario ya eligió "no volver a preguntar":
 * pedirlo otra vez NO muestra nada, así que la app debe mandarlo a Ajustes en
 * vez de fingir que la solicitud no hizo nada.
 */
export interface EstadoPermisoAndroid {
  concedido: boolean;
  /** Android todavía mostraría el diálogo de este permiso. */
  muestraDialogo: boolean;
  yaPreguntado: boolean;
  bloqueado: boolean;
  puedePedir: boolean;
}

export interface SiempreCercaPlugin {
  crearCanalAlarma(): Promise<void>;
  crearCanalSOS(): Promise<void>;
  vibrar(opciones?: VibrarOpciones): Promise<void>;
  guardarSesionBackend(datos: Partial<SesionBackend>): Promise<void>;
  obtenerSesionBackend(): Promise<SesionBackend>;
  pedirIgnorarOptimizacion(): Promise<void>;
  ignorandoBateria(): Promise<{ si: boolean }>;
  verificarNotificaciones(): Promise<EstadoNotificaciones>;
  /** Consulta un permiso por su nombre de Android. */
  estadoPermiso(permiso: string): Promise<EstadoPermisoAndroid>;
  /** Deja constancia de que se mostró el diálogo de un permiso. */
  marcarPermisoPreguntado(permiso: string): Promise<void>;
  abrirAjustesNotificaciones(): Promise<void>;
}

export const SiempreCerca = registerPlugin<SiempreCercaPlugin>('SiempreCerca');

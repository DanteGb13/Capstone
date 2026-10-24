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
  /**
   * Si el canal de alarma tiene sonido asignado.
   *
   * Va aparte de `alarmaActivo` a proposito: un canal puede estar encendido y a
   * la vez mudo, y entonces la notificacion aparece pero no suena. Mirando solo
   * la importance la app daba el visto bueno y el recordatorio "funcionaba"
   * sin oirse nada.
   */
  alarmaConSonido: boolean;
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

export interface OcurrenciaNativa {
  idAlarma: string;
  /** Fecha y hora de la ocurrencia: YYYY-MM-DDTHH:mm. */
  clave: string;
  titulo: string;
  cuerpo: string;
  fecha: number;
  idNotificacion: number;
}

export interface ApagadaNativa {
  idAlarma: string;
  clave: string;
  fecha: number;
}

/** Una alarma que el sistema tiene sonando ahora mismo. */
export interface SonandoNativa {
  idAlarma: string;
  idNotificacion: number;
}

export interface AccionNotificacion {
  /** Botón que se apretó ("apagar"), o null si la app se abrió de otra forma. */
  accion: string | null;
  /** Notificación completa en JSON, de donde salen idAlarma y fecha. */
  notificacion?: string | null;
}

export interface SiempreCercaPlugin {
  crearCanalAlarma(): Promise<void>;
  crearCanalSOS(): Promise<void>;
  /** Fuerza recreación de canales (ignora versión) para reparar sonido/vibración. */
  forzarRecrearCanales(): Promise<void>;
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
  accionNotificacion(): Promise<AccionNotificacion>;
  programarAlarmas(opts: { alarmas: OcurrenciaNativa[]; exacta: boolean }): Promise<{ programadas: number }>;
  /**
   * Saca de AlarmManager y de la barra todo lo que quedara de una alarma que ya
   * no existe. Hace falta cuando un recordatorio desaparece por un camino que no
   * es el de esta pantalla: sus PendingIntent seguían armados y la alarma
   * seguía sonando hasta el siguiente reinicio del teléfono.
   */
  desprogramarAlarmas(opts: { idAlarma: string }): Promise<void>;
  detenerAlarma(opts: { idAlarma: string; clave: string; fecha: number; idNotificacion: number; marcar?: boolean }): Promise<void>;
  leerAlarmasApagadas(): Promise<{ apagadas: string }>;
  /** Las alarmas sonando ahora mismo en Android. */
  leerAlarmasSonando(): Promise<{ sonando: string }>;
}

export const SiempreCerca = registerPlugin<SiempreCercaPlugin>('SiempreCerca');

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Estado detallado de la ubicación. Antes sólo había un sí/no. */
export interface PermisosUbicacion {
  /** @deprecated usar `precisa` / `aproximada`. Se conserva por compatibilidad. */
  ubicacionForeground: boolean;
  /** @deprecated usar `background`. Se conserva por compatibilidad. */
  ubicacionBackground: boolean;
  /** ACCESS_FINE_LOCATION: ubicación exacta. */
  precisa: boolean;
  /** Sólo ACCESS_COARSE_LOCATION: el usuario eligió darle ubicación aproximada. */
  aproximada: boolean;
  /** En Android 10 y menos el permiso venía incluido y no hay nada que pedir. */
  backgroundAplica: boolean;
  /** El servicio de segundo plano está corriendo ahora mismo. */
  servicioActivo: boolean;
  /**
   * false = el usuario lo bloqueó de forma permanente y Android ya no va a
   * mostrar el diálogo. Hay que mandarlo a Ajustes.
   */
  puedePedirForeground: boolean;
  puedePedirBackground: boolean;
}

export interface ResultadoBackground {
  concedido: boolean;
  aplica: boolean;
  /** Falta el permiso de primer plano: hay que pedirlo antes. */
  requiereForeground?: boolean;
}

export interface UbicacionForegroundPlugin {
  iniciar(options?: {
    intervaloMs?: number;
    distanciaMinimaM?: number;
  }): Promise<{ iniciado: boolean }>;

  detener(): Promise<{ detenido: boolean }>;

  estaActivo(): Promise<{ activo: boolean }>;

  verificarPermisos(): Promise<PermisosUbicacion>;

  /**
   * Pide el permiso de ubicación en segundo plano. Va aparte porque desde
   * Android 11 el sistema lo ignora si se pide en el mismo diálogo que el de
   * primer plano.
   */
  solicitarBackground(): Promise<ResultadoBackground>;

  abrirAjustes(): Promise<void>;

  /**
   * El servicio de ubicación ya está vivo en este proceso, así que también
   * lo usa para avisar cada 15 minutos que toca subir los datos de salud
   * leídos de Health Connect.
   */
  addListener(
    eventName: 'saludSync',
    listener: () => void
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}

export const UbicacionForeground = registerPlugin<UbicacionForegroundPlugin>('UbicacionForeground');

import { registerPlugin } from '@capacitor/core';

export interface PermisosUbicacion {
  ubicacionForeground: boolean;
  ubicacionBackground: boolean;
  notificaciones: boolean;
  todosConcedidos: boolean;
}

export interface UbicacionForegroundPlugin {
  iniciar(options?: {
    intervaloMs?: number;
    distanciaMinimaM?: number;
  }): Promise<{ iniciado: boolean }>;

  detener(): Promise<{ detenido: boolean }>;

  estaActivo(): Promise<{ activo: boolean }>;

  verificarPermisos(): Promise<PermisosUbicacion>;

  abrirAjustes(): Promise<void>;
}

export const UbicacionForeground = registerPlugin<UbicacionForegroundPlugin>('UbicacionForeground');

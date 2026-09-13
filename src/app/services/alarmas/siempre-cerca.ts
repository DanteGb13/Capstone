import { registerPlugin } from '@capacitor/core';

export interface SiempreCercaPlugin {
  crearCanalAlarma(): Promise<void>;
  pedirIgnorarOptimizacion(): Promise<void>;
  ignorandoBateria(): Promise<{ si: boolean }>;
}

export const SiempreCerca = registerPlugin<SiempreCercaPlugin>('SiempreCerca');
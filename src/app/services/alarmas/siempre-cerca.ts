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

export interface SiempreCercaPlugin {
  crearCanalAlarma(): Promise<void>;
  crearCanalSOS(): Promise<void>;
  vibrar(opciones?: VibrarOpciones): Promise<void>;
  guardarSesionBackend(datos: Partial<SesionBackend>): Promise<void>;
  obtenerSesionBackend(): Promise<SesionBackend>;
  pedirIgnorarOptimizacion(): Promise<void>;
  ignorandoBateria(): Promise<{ si: boolean }>;
}

export const SiempreCerca = registerPlugin<SiempreCercaPlugin>('SiempreCerca');

import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface InfoVoz {
  /**
   * Se puede leer AHORA: el motor arrancó y además tiene descargados los datos
   * del idioma configurado.
   *
   * Es distinto de `motorListo` a propósito: un motor instalado sin el paquete
   * de voz del idioma en el teléfono inicializa bien y aun así no dice nada.
   */
  listo: boolean;
  /** El motor arrancó, aunque quizá no tenga voz para este idioma. */
  motorListo: boolean;
  /**
   * Ya hay un lector de pantalla del sistema funcionando (TalkBack).
   *
   * Si es true, esta app NO debe hablar encima: se pondrían las dos voces a la
   * vez y no se entendería nada.
   */
  lectorExterno: boolean;
  velocidad: number;
  tono: number;
  idioma: string;
}

export interface VozPlugin {
  info(): Promise<InfoVoz>;
  /** Dice un texto, interrumpiendo lo anterior. Para un toque. */
  hablar(options: { texto: string }): Promise<void>;
  /** Lee varias frases seguidas, sin pisarse. Para leer una pantalla. */
  leerLineas(options: { lineas: string[] }): Promise<void>;
  detener(): Promise<void>;
  velocidad(options: { valor: number }): Promise<{ velocidad: number }>;
  tono(options: { valor: number }): Promise<{ tono: number }>;
  abrirAccesibilidad(): Promise<void>;
  addListener(evento: string, listener: (datos: any) => void): Promise<PluginListenerHandle>;
}

export const Voz = registerPlugin<VozPlugin>('Voz');

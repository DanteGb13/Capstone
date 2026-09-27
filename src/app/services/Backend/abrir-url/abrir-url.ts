import { registerPlugin } from '@capacitor/core';

export interface AbrirUrlPlugin {
  /**
   * Abre una URL fuera de la app.
   * - titulo: texto del selector del sistema.
   * - selector: true para que la persona elija con qué aplicación abrir.
   * - wazeUrl: URL con esquema waze://. Waze no entiende el geo: de Google,
   *   así que se le pasa aparte para que aparezca en el selector con su logo y
   *   reciba una dirección que sí sabe buscar.
   * Devuelve abierto=false si ninguna aplicación del teléfono la puede abrir.
   */
  abrir(options: {
    url: string;
    titulo?: string;
    selector?: boolean;
    wazeUrl?: string;
  }): Promise<{ abierto: boolean }>;
}

export const AbrirUrl = registerPlugin<AbrirUrlPlugin>('AbrirUrl');

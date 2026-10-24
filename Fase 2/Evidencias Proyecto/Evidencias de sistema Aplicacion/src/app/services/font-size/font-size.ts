import { Injectable } from '@angular/core';

export type TamanoLetra = 'pequeno' | 'normal' | 'grande' | 'extra-grande';

export interface OpcionTamano {
  id: TamanoLetra;
  label: string;
  scale: number;
  preview: string;
}

@Injectable({
  providedIn: 'root'
})
export class FontSizeService {

  private readonly STORAGE_KEY = 'font-size';
  private readonly DEFAULT: TamanoLetra = 'normal';

  readonly opciones: OpcionTamano[] = [
    { id: 'pequeno', label: 'Pequeño', scale: 0.85, preview: 'Aa' },
    { id: 'normal', label: 'Normal', scale: 1.0, preview: 'Aa' },
    { id: 'grande', label: 'Grande', scale: 1.15, preview: 'Aa' },
    { id: 'extra-grande', label: 'Extra grande', scale: 1.3, preview: 'Aa' },
  ];

  constructor() {
    this.aplicar();
  }

  obtener(): TamanoLetra {
    const guardado = localStorage.getItem(this.STORAGE_KEY) as TamanoLetra;
    return guardado || this.DEFAULT;
  }

  /**
   * Texto para la lista de Ajustes. `obtener()` devuelve el id interno
   * ('extra-grande'), que no es lo que debe leerse en pantalla.
   */
  obtenerEtiqueta(): string {
    return this.opciones.find(o => o.id === this.obtener())?.label ?? '';
  }

  obtenerScale(): number {
    const actual = this.obtener();
    const opcion = this.opciones.find(o => o.id === actual);
    return opcion?.scale || 1.0;
  }

  guardar(tamano: TamanoLetra): void {
    localStorage.setItem(this.STORAGE_KEY, tamano);
    this.aplicar();
  }

  aplicar(): void {
    const scale = this.obtenerScale();
    document.documentElement.style.setProperty('--font-scale', scale.toString());
    document.body.style.zoom = scale.toString();
  }
}

/**
 * Suspende el zoom del tamaño de letra mientras dure una página de juego.
 *
 * El zoom de `body` corría las coordenadas de los toques (`elementFromPoint`
 * de Sopa de letras, el cálculo de pinza del Rompecabezas): el dedo caía en
 * la celda de al lado. Los juegos son a pantalla completa y no necesitan el
 * zoom, así que mientras están abiertos se apaga.
 */
export function suspenderZoomJuego(): void {
  document.body.classList.add('sin-zoom-letra');
}

/** Vuelve a poner el zoom que la persona eligió en Ajustes → Tamaño de letra. */
export function reanudarZoomJuego(): void {
  document.body.classList.remove('sin-zoom-letra');
}

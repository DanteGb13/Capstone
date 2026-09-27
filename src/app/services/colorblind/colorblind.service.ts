import { Injectable } from '@angular/core';

export type ModoDaltonismo =
  | 'ninguno'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'acromatopsia';

export interface OpcionFiltroColor {
  id: ModoDaltonismo;
  label: string;
  descripcion: string;
  /**
   * Matriz de color 3x3 en espacio lineal-sRGB con la deficiencia al 100%.
   * `null` significa "sin filtro".
   *
   * Ver https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
   */
  matriz: number[] | null;
}

@Injectable({
  providedIn: 'root'
})
export class ColorblindService {

  private readonly STORAGE_MODO = 'filtro-color-modo';
  private readonly STORAGE_INTENSIDAD = 'filtro-color-intensidad';
  private readonly MATRIZ_ID = 'cb-colorblind-matrix';
  private readonly FILTRO_ID = 'cb-colorblind';

  private readonly IDENTIDAD = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  readonly opciones: OpcionFiltroColor[] = [
    {
      id: 'ninguno',
      label: 'Ninguno',
      descripcion: 'La app se ve con sus colores normales',
      matriz: null
    },
    {
      id: 'protanopia',
      label: 'Protanopía',
      descripcion: 'No se distinguen bien el rojo y el verde',
      matriz: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758]
    },
    {
      id: 'deuteranopia',
      label: 'Deuteranopía',
      descripcion: 'No se distinguen bien el verde y el rojo',
      matriz: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7]
    },
    {
      id: 'tritanopia',
      label: 'Tritanopía',
      descripcion: 'No se distinguen bien el azul y el amarillo',
      matriz: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525]
    },
    {
      id: 'acromatopsia',
      label: 'Acromatopsia',
      descripcion: 'No se distingue ningún color',
      matriz: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114]
    }
  ];

  constructor() {
    this.aplicar();
  }

  obtener(): ModoDaltonismo {
    const guardado = localStorage.getItem(this.STORAGE_MODO) as ModoDaltonismo;
    return this.opciones.some(o => o.id === guardado) ? guardado : 'ninguno';
  }

  obtenerOpcion(): OpcionFiltroColor {
    return this.opciones.find(o => o.id === this.obtener()) ?? this.opciones[0];
  }

  obtenerIntensidad(): number {
    const bruto = localStorage.getItem(this.STORAGE_INTENSIDAD);
    if (bruto === null) return 100;

    const guardado = Number(bruto);
    if (!Number.isFinite(guardado)) return 100;

    // El 0 es un valor legítimo (dejar de filtrar sin volver a "Ninguno"), así
    // que no puede tratarse como "sin guardar".
    return Math.min(100, Math.max(0, guardado));
  }

  guardar(modo: ModoDaltonismo): void {
    localStorage.setItem(this.STORAGE_MODO, modo);
    this.aplicar();
  }

  guardarIntensidad(intensidad: number): void {
    localStorage.setItem(this.STORAGE_INTENSIDAD, String(Math.min(100, Math.max(0, intensidad))));
    this.aplicar();
  }

  /**
   * Texto que se muestra bajo la tarjeta de Ajustes. Sin esto el usuario no
   * puede saber si el filtro está puesto sin entrar a la página.
   */
  resumen(): string {
    const opcion = this.obtenerOpcion();
    if (opcion.matriz === null) return 'Desactivado';
    return `${opcion.label} · ${this.obtenerIntensidad()}%`;
  }

  /**
   * Escribe la matriz interpolada en el `feColorMatrix` del SVG de index.html.
   *
   * La intensidad NO es una opacidad sobre el filtro: se interpola entre la
   * identidad y la matriz de la deficiencia. Al 50% la imagen queda
   * exactamente a mitad de camino entre normal y con daltonismo, que es lo que
   * espera alguien que está probando.
   */
  aplicar(): void {
    const matriz = document.getElementById(this.MATRIZ_ID);
    if (!matriz) return;

    const opcion = this.obtenerOpcion();

    if (opcion.matriz === null) {
      document.documentElement.style.setProperty('--cb-filtro', 'none');
      return;
    }

    document.documentElement.style.setProperty(
      '--cb-filtro',
      `url(#${this.FILTRO_ID})`
    );
    matriz.setAttribute('values', this.valoresSvg(this.interpolar(opcion.matriz)));
  }

  /**
   * `feColorMatrix` espera 20 valores: 4 filas de 5, no una 3x3 pelada. Cada
   * fila es `R*nRojo + G*nVerde + B*nAzul + A*nAlfa + constante`, así que los 9
   * números van en las tres primeras filas, con ceros en la columna del alfa, y
   * la cuarta fila es el alfa, que se deja intacto.
   *
   * Poner solo los 9 hace que el filtro sea inválido y el navegador lo
   * descarte entero, sin mostrar ningún error.
   */
  private valoresSvg(matriz: number[]): string {
    const filas = [
      [matriz[0], 0, matriz[1], 0, matriz[2]],
      [matriz[3], 0, matriz[4], 0, matriz[5]],
      [matriz[6], 0, matriz[7], 0, matriz[8]],
      [0, 0, 0, 1, 0]
    ];
    return filas.flat().join(' ');
  }

  interpolar(matriz: number[]): number[] {
    const severity = this.obtenerIntensidad() / 100;
    return matriz.map((valor, i) => {
      const base = this.IDENTIDAD[i];
      return Number((base + (valor - base) * severity).toFixed(4));
    });
  }
}

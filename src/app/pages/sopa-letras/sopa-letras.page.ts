import { Component, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowBack, chevronDownOutline, chevronUpOutline, helpCircleOutline } from 'ionicons/icons';
import { TutorialJuegoComponent } from '../../components/tutorial-juego/tutorial-juego.component';
import { TUTORIAL_SOPA } from '../juegos/tutoriales';

/** Una celda de la sopa de letras. */
export interface CeldaSopa {
  fila: number;
  col: number;
  letra: string;
  /** True cuando la celda pertenece a una palabra ya encontrada. */
  marcada: boolean;
}

/** Un tema con sus palabras (sin espacios, sin tildes). */
export interface TemaSopa {
  nombre: string;
  palabras: string[];
}

/** Catálogo de temas disponibles para jugar. */
const TEMAS: TemaSopa[] = [
  {
    nombre: 'Animales',
    palabras: ['GATO', 'PERRO', 'LEON', 'OSO', 'PATO', 'PEZ', 'VACA']
  },
  {
    nombre: 'Naturaleza',
    palabras: ['LUNA', 'SOL', 'MAR', 'RIO', 'NUBE', 'FLOR', 'ARBOL']
  },
  {
    nombre: 'Ciudades',
    palabras: ['LIMA', 'PARIS', 'ROMA', 'QUITO', 'TOKYO', 'BERLIN', 'LONDRES']
  },
  {
    nombre: 'Alimentos',
    palabras: ['PAN', 'LECHE', 'QUESO', 'ARROZ', 'HUEVO', 'PAPA', 'MANZANA', 'NARANJA']
  },
  {
    nombre: 'Tecnología',
    palabras: ['TECLADO', 'PANTALLA', 'CELULAR', 'INTERNET', 'CORREO', 'ROBOT', 'WIFI', 'MOUSE']
  },
  {
    nombre: 'Deportes',
    palabras: ['FUTBOL', 'TENIS', 'NATACION', 'CICLISMO', 'BASQUET', 'VOLEIBOL', 'BOXEO', 'GOLF']
  },
  {
    nombre: 'Profesiones',
    palabras: ['DOCTOR', 'MAESTRO', 'BOMBERO', 'POLICIA', 'ENFERMERA', 'COCINERO', 'PILOTO', 'JUEZ']
  },
  {
    nombre: 'Música',
    palabras: ['GUITARRA', 'PIANO', 'BATERIA', 'VIOLIN', 'FLAUTA', 'CANCION', 'RITMO', 'CORO']
  },
  {
    nombre: 'Ropa',
    palabras: ['CAMISA', 'PANTALON', 'ZAPATOS', 'VESTIDO', 'CHAMARRA', 'MEDIAS', 'GORRO', 'BUFANDA']
  },
  {
    nombre: 'Marcas',
    palabras: ['NIKE', 'ADIDAS', 'SONY', 'SAMSUNG', 'APPLE', 'PEPSI', 'XBOX', 'TOYOTA']
  },
  {
    nombre: 'Cosas',
    palabras: ['MESA', 'SILLA', 'VENTANA', 'RELOJ', 'LIBRO', 'LLAVE', 'TAZA', 'SOFA']
  }
];

/** Tamaño del tablero (10 x 10). */
const TAMANO = 10;
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

@Component({
  selector: 'app-sopa-letras',
  templateUrl: './sopa-letras.page.html',
  styleUrls: ['./sopa-letras.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    TutorialJuegoComponent
  ]
})
export class SopaLetrasPage {

  /** True mientras se muestra el tutorial de "Cómo jugar". */
  mostrarTutorial = true;
  pasosTutorial = TUTORIAL_SOPA;

  temas = TEMAS;
  temaIndex = 0;
  /** True cuando el selector de temas está desplegado. */
  temasAbierta = false;

  /** Letrero 10x10 con letras. */
  celdas: CeldaSopa[][] = [];
  /** Palabras que faltan por encontrar. */
  restantes: string[] = [];
  /** Palabras ya encontradas. */
  encontradas: string[] = [];

  /** Celda donde comenzó el arrastre (el dedo se apoya aquí). */
  origen: CeldaSopa | null = null;
  /** Celdas resaltadas durante el arrastre (línea recta desde el origen). */
  ruta: CeldaSopa[] = [];
  deslizando = false;

  terminado = false;

  constructor(private router: Router) {
    addIcons({ arrowBack, chevronDownOutline, chevronUpOutline, helpCircleOutline });
    this.regenerar();
  }

  /** Tema que se está jugando. */
  get tema(): TemaSopa {
    return this.temas[this.temaIndex];
  }

  /** Cambia de tema y arma un tablero nuevo. */
  elegirTema(activo: number): void {
    if (activo === this.temaIndex) {
      this.temasAbierta = false;
      return;
    }
    this.temaIndex = activo;
    this.temasAbierta = false;
    this.regenerar();
  }

  /** Arma el tablero con las palabras del tema y letras de relleno. */
  private regenerar(): void {
    this.restantes = [...this.tema.palabras];
    this.encontradas = [];
    this.origen = null;
    this.ruta = [];
    this.deslizando = false;
    this.terminado = false;

    // Direcciones posibles: horizontal, vertical y diagonales.
    const direcciones = [
      { df: 0, dc: 1 },
      { df: 1, dc: 0 },
      { df: 1, dc: 1 },
      { df: 1, dc: -1 }
    ];

    // Se reintenta hasta que todas las palabras queden ubicadas (con un tope
    // de seguridad para no quedarse en un bucle infinito).
    let mejor: { tablero: CeldaSopa[][]; colocadas: number } | null = null;
    for (let intento = 0; intento < 40; intento++) {
      const resultado = this.construirTablero(direcciones);
      if (resultado.colocadas === this.tema.palabras.length) {
        this.celdas = resultado.tablero;
        return;
      }
      if (!mejor || resultado.colocadas > mejor.colocadas) {
        mejor = resultado;
      }
    }

    // Caso extremo: se usa el mejor tablero logrado.
    this.celdas = mejor ? mejor.tablero : this.tableroVacio();
  }

  /** Construye un tablero completo e informa cuántas palabras quedaron. */
  private construirTablero(
    direcciones: { df: number; dc: number }[]
  ): { tablero: CeldaSopa[][]; colocadas: number } {
    const tablero = this.tableroVacio();
    let colocadas = 0;

    for (const palabra of this.tema.palabras) {
      if (this.intentarUbicar(tablero, palabra, direcciones)) {
        colocadas++;
      }
    }

    // Relleno aleatorio en las celdas que quedaron vacías.
    for (let f = 0; f < TAMANO; f++) {
      for (let c = 0; c < TAMANO; c++) {
        if (tablero[f][c].letra === '') {
          tablero[f][c].letra = ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
        }
      }
    }

    return { tablero, colocadas };
  }

  /** Crea un tablero vacío listo para colocar palabras. */
  private tableroVacio(): CeldaSopa[][] {
    const vacio: CeldaSopa[][] = [];
    for (let f = 0; f < TAMANO; f++) {
      vacio.push(
        Array.from({ length: TAMANO }, (_, c) => ({ fila: f, col: c, letra: '', marcada: false }))
      );
    }
    return vacio;
  }

  /** Intenta ubicar una palabra buscando posiciones libres al azar. */
  private intentarUbicar(
    tablero: CeldaSopa[][],
    palabra: string,
    direcciones: { df: number; dc: number }[]
  ): boolean {
    const n = TAMANO;
    for (let intento = 0; intento < 400; intento++) {
      const dir = direcciones[Math.floor(Math.random() * direcciones.length)];
      const fila = Math.floor(Math.random() * n);
      const col = Math.floor(Math.random() * n);

      const filaFin = fila + dir.df * (palabra.length - 1);
      const colFin = col + dir.dc * (palabra.length - 1);

      if (filaFin < 0 || filaFin >= n || colFin < 0 || colFin >= n) {
        continue;
      }

      let apta = true;
      for (let i = 0; i < palabra.length; i++) {
        const celda = tablero[fila + dir.df * i][col + dir.dc * i];
        if (celda.letra !== '' && celda.letra !== palabra[i]) {
          apta = false;
          break;
        }
      }

      if (apta) {
        for (let i = 0; i < palabra.length; i++) {
          tablero[fila + dir.df * i][col + dir.dc * i].letra = palabra[i];
        }
        return true;
      }
    }
    return false;
  }

  /** Empieza el arrastre apoyando el dedo en una celda. */
  iniciarArrastre(celda: CeldaSopa): void {
    if (this.terminado || celda.marcada || this.deslizando) {
      return;
    }
    this.origen = celda;
    this.ruta = [celda];
    this.deslizando = true;
  }

  /** Al mover el dedo detecta la celda real bajo el puntero y actualiza la línea. */
  onPointerMove(evento: PointerEvent): void {
    if (!this.deslizando || !this.origen) {
      return;
    }
    // En táctil el navegador captura el puntero, así que se busca por
    // coordenadas la celda que está físicamente debajo del dedo.
    const celda = this.celdaEnPuntero(evento);
    if (celda) {
      this.actualizarArrastre(celda);
    }
  }

  /** Celda bajo las coordenadas del puntero, o null si no es una letra. */
  private celdaEnPuntero(evento: PointerEvent): CeldaSopa | null {
    const elemento = document.elementFromPoint(evento.clientX, evento.clientY) as HTMLElement | null;
    const celdaEl = elemento?.closest('.celda') as HTMLElement | null;
    if (!celdaEl) {
      return null;
    }
    const fila = Number(celdaEl.dataset['fila']);
    const col = Number(celdaEl.dataset['col']);
    if (Number.isNaN(fila) || Number.isNaN(col)) {
      return null;
    }
    return this.celdas[fila]?.[col] ?? null;
  }

  /** Actualiza el resaltado con la línea recta desde el origen. */
  private actualizarArrastre(celda: CeldaSopa): void {
    this.ruta = this.lineaDesdeOrigen(celda);
  }

  /** Termina el arrastre y comprueba si la línea resaltada es una palabra. */
  finalizarArrastre(evento?: PointerEvent): void {
    if (!this.deslizando) {
      return;
    }
    this.deslizando = false;

    // En barridos rápidos, el último "pointermove" puede llegar retrasado.
    // Si al soltar el dedo está sobre una celda que forma línea recta con
    // el origen, se usa esa línea (más precisa). Si no, se conserva la
    // última resaltada durante el arrastre.
    if (this.origen && evento) {
      const celda = this.celdaEnPuntero(evento);
      if (celda) {
        const linea = this.lineaDesdeOrigen(celda);
        if (linea.length > 1) {
          this.ruta = linea;
        }
      }
    }

    this.evaluarRuta();
    this.origen = null;
    this.ruta = [];
  }

  /** Celdas en línea recta desde el origen hasta la celda indicada. */
  private lineaDesdeOrigen(celda: CeldaSopa): CeldaSopa[] {
    const a = this.origen!;
    const b = celda;

    const diffFila = Math.abs(b.fila - a.fila);
    const diffCol = Math.abs(b.col - a.col);

    // Solo líneas rectas: misma fila, misma columna o diagonal.
    const esLinea = diffFila === 0 || diffCol === 0 || diffFila === diffCol;
    if (!esLinea) {
      return [b];
    }

    const tramos = Math.max(diffFila, diffCol);
    const pasoF = b.fila > a.fila ? 1 : b.fila < a.fila ? -1 : 0;
    const pasoC = b.col > a.col ? 1 : b.col < a.col ? -1 : 0;

    const celdas: CeldaSopa[] = [];
    for (let i = 0; i <= tramos; i++) {
      celdas.push(this.celdas[a.fila + pasoF * i][a.col + pasoC * i]);
    }
    return celdas;
  }

  /** True cuando la celda pertenece a la línea resaltada. */
  enRuta(celda: CeldaSopa): boolean {
    return this.ruta.some(
      (c) => c.fila === celda.fila && c.col === celda.col
    );
  }

  /** Comprueba si la línea resaltada forma una palabra del tema. */
  private evaluarRuta(): void {
    if (!this.origen || this.ruta.length < 2) {
      return;
    }

    let texto = '';
    for (const celda of this.ruta) {
      texto += celda.letra;
    }

    const invertida = texto.split('').reverse().join('');
    const encontrada = this.restantes.find(
      (p) => p === texto || p === invertida
    );

    if (encontrada) {
      for (const celda of this.ruta) {
        celda.marcada = true;
      }
      this.encontradas = [...this.encontradas, encontrada].sort();
      this.restantes = this.restantes.filter((p) => p !== encontrada);

      if (this.restantes.length === 0) {
        this.terminado = true;
      }
    }
  }

  /** Libera el puntero (incluso si se suelta fuera del tablero). */
  @HostListener('document:pointerup', ['$event'])
  soltarFuera(evento: PointerEvent): void {
    this.finalizarArrastre(evento);
  }

  /** Cancelación del puntero (ej. el dispositivo interrumpió el toque). */
  @HostListener('document:pointercancel')
  cancelarFuera(): void {
    this.finalizarArrastre();
  }

  /** Reinicia el tablero con el mismo tema. */
  jugarDeNuevo(): void {
    this.regenerar();
  }

  /** Vuelve a la lista de juegos. */
  volver(): void {
    void this.router.navigate(['/juegos']);
  }
}
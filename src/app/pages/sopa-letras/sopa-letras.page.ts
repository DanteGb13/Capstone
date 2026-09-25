import { Component } from '@angular/core';
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
import { arrowBack } from 'ionicons/icons';

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
    IonIcon
  ]
})
export class SopaLetrasPage {

  temas = TEMAS;
  temaIndex = 0;

  /** Letrero 10x10 con letras. */
  celdas: CeldaSopa[][] = [];
  /** Palabras que faltan por encontrar. */
  restantes: string[] = [];
  /** Palabras ya encontradas. */
  encontradas: string[] = [];

  /** Primera y segunda letra elegidas por el usuario. */
  primeraSel: CeldaSopa | null = null;
  segundaSel: CeldaSopa | null = null;

  terminado = false;

  constructor(private router: Router) {
    addIcons({ arrowBack });
    this.regenerar();
  }

  /** Tema que se está jugando. */
  get tema(): TemaSopa {
    return this.temas[this.temaIndex];
  }

  /** Cambia de tema y arma un tablero nuevo. */
  elegirTema(activo: number): void {
    if (activo === this.temaIndex) {
      return;
    }
    this.temaIndex = activo;
    this.regenerar();
  }

  /** Arma el tablero con las palabras del tema y letras de relleno. */
  private regenerar(): void {
    this.restantes = [...this.tema.palabras];
    this.encontradas = [];
    this.primeraSel = null;
    this.segundaSel = null;
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

  /** Marca la primera letra de la palabra seleccionada. */
  seleccionarPrimera(celda: CeldaSopa): void {
    if (this.terminado || celda.marcada) {
      return;
    }
    this.primeraSel = celda;
    this.segundaSel = null;
  }

  /** Marca la segunda letra y comprueba si forman una palabra. */
  seleccionarSegunda(celda: CeldaSopa): void {
    if (this.terminado || !this.primeraSel || celda.marcada) {
      return;
    }
    if (celda.fila === this.primeraSel.fila && celda.col === this.primeraSel.col) {
      return;
    }
    this.segundaSel = celda;
    this.evaluarSeleccion();
  }

  /** Comprueba si la línea entre las dos letras forma una palabra válida. */
  private evaluarSeleccion(): void {
    const a = this.primeraSel!;
    const b = this.segundaSel!;

    const diffFila = Math.abs(b.fila - a.fila);
    const diffCol = Math.abs(b.col - a.col);

    // Tiene que ser una línea recta: misma fila, misma columna o diagonal.
    const esLinea = diffFila === 0 || diffCol === 0 || diffFila === diffCol;
    const tramos = Math.max(diffFila, diffCol);
    if (!esLinea || tramos < 1) {
      this.primeraSel = null;
      this.segundaSel = null;
      return;
    }

    const pasoF = b.fila > a.fila ? 1 : b.fila < a.fila ? -1 : 0;
    const pasoC = b.col > a.col ? 1 : b.col < a.col ? -1 : 0;

    let texto = '';
    const tramoCeldas: CeldaSopa[] = [];
    for (let i = 0; i <= tramos; i++) {
      const celda = this.celdas[a.fila + pasoF * i][a.col + pasoC * i];
      texto += celda.letra;
      tramoCeldas.push(celda);
    }

    const invertida = texto.split('').reverse().join('');
    const encontrada = this.restantes.find(
      (p) => p === texto || p === invertida
    );

    if (encontrada) {
      for (const celda of tramoCeldas) {
        celda.marcada = true;
      }
      this.encontradas = [...this.encontradas, encontrada].sort();
      this.restantes = this.restantes.filter((p) => p !== encontrada);

      if (this.restantes.length === 0) {
        this.terminado = true;
      }
    }

    this.primeraSel = null;
    this.segundaSel = null;
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
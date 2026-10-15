import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
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
import { arrowBack, helpCircleOutline, refreshOutline, trashOutline } from 'ionicons/icons';
import { TutorialJuegoComponent } from '../../components/tutorial-juego/tutorial-juego.component';
import { TUTORIAL_TRES_EN_LINEA } from '../juegos/tutoriales';

/** Ficha del tablero: X (usuario), O (IA) o vacío. */
export type FichaTres = 'X' | 'O' | null;

/** Dificultad elegible para la partida. */
export type DificultadTres = 'facil' | 'medio' | 'dificil';

/** Una opción de dificultad mostrada en la pantalla. */
export interface OpcionDificultad {
  valor: DificultadTres;
  etiqueta: string;
}

/** Combinaciones ganadoras (filas, columnas y diagonales). */
const COMBINACIONES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

/**
 * Probabilidad de que la IA en dificultad difícil no juegue su mejor jugada.
 * Con Minimax perfecto es imposible ganarle, así que de vez en cuando
 * elige una jugada de segundo nivel para que sí haya partidas ganables.
 */
const PROBABILIDAD_ERROR_DIFICIL = 0.1;

@Component({
  selector: 'app-tic-tac-toe',
  templateUrl: './tic-tac-toe.page.html',
  styleUrls: ['./tic-tac-toe.page.scss'],
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
export class TicTacToePage implements OnDestroy {

  /** True mientras se muestra el tutorial de "Cómo jugar". */
  mostrarTutorial = true;
  pasosTutorial = TUTORIAL_TRES_EN_LINEA;

  tablero: FichaTres[] = Array(9).fill(null);
  turno: FichaTres = 'X';
  ganador: FichaTres = null;
  lineaGanadora: number[] | null = null;
  empate = false;
  pensando = false;

  dificultad: DificultadTres = 'medio';
  dificultades: OpcionDificultad[] = [
    { valor: 'facil', etiqueta: 'Fácil' },
    { valor: 'medio', etiqueta: 'Medio' },
    { valor: 'dificil', etiqueta: 'Difícil' }
  ];

  victorias = 0;
  derrotas = 0;
  empates = 0;

  private readonly CLAVE_STATS = 'sc_tres_en_linea_stats_v1';
  private iaPendiente: any = null;

  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ arrowBack, helpCircleOutline, refreshOutline, trashOutline });
    this.cargarStats();
  }

  /** True cuando la partida ya no puede continuar. */
  get juegoTerminado(): boolean {
    return this.ganador !== null || this.empate;
  }

  /** Mensaje según el estado actual de la partida. */
  get mensaje(): string {
    if (this.ganador === 'X') {
      return '¡Felicidades, ganaste!';
    }
    if (this.ganador === 'O') {
      return 'Ganó la IA... ¡inténtalo otra vez!';
    }
    if (this.empate) {
      return '¡Empate!';
    }
    return this.pensando ? 'La IA está pensando...' : 'Tu turno: toca una casilla';
  }

  /** Título y detalle para la pantalla final. */
  get tituloFinal(): string {
    if (this.ganador === 'X') { return '¡Has ganado!'; }
    if (this.ganador === 'O') { return 'Ganó la IA'; }
    return 'Empate';
  }

  get mensajeFinal(): string {
    if (this.ganador === 'X') { return 'Genial, has sido más astuto que la IA.'; }
    if (this.ganador === 'O') { return 'Puedes intentarlo de nuevo con otra dificultad.'; }
    return 'Nadie ganó esta vez. Inténtalo de nuevo.';
  }

  /** Cambia la dificultad y empieza una partida limpia. */
  cambiarDificultad(valor: DificultadTres): void {
    if (this.dificultad === valor) {
      return;
    }
    this.dificultad = valor;
    this.reiniciarPartida();
  }

  /** Coloca la ficha X del usuario en la casilla indicada. */
  colocar(indice: number): void {
    if (this.juegoTerminado || this.pensando || this.turno !== 'X' || this.tablero[indice] !== null) {
      return;
    }
    this.tablero[indice] = 'X';
    this.resolver();

    if (!this.juegoTerminado) {
      this.turno = 'O';
      this.pensando = true;
      // La IA "piensa" con una pausa breve para que el juego se sienta natural.
      // Se guarda el temporizador para poder cancelarlo si se reinicia la partida.
      this.iaPendiente = setTimeout(() => this.responderIA(), 350 + Math.random() * 350);
    }
  }

  /** La IA elige una jugada según la dificultad. */
  private responderIA(): void {
    this.iaPendiente = null;
    const mover = this.elegirMovimientoIA();
    this.pensando = false;
    if (mover !== null) {
      this.tablero[mover] = 'O';
      this.turno = 'X';
      this.resolver();
    }
    // Fuerza el renderizado inmediato de la jugada de la IA (temporizadores
    // no siempre disparan la detección de cambios).
    this.cdr.detectChanges();
  }

  /** Devuelve una jugada válida para la IA según la dificultad. */
  private elegirMovimientoIA(): number | null {
    const libres = this.casillasLibres();
    if (libres.length === 0) {
      return null;
    }

    switch (this.dificultad) {
      case 'facil':
        // Movimiento totalmente aleatorio.
        return libres[Math.floor(Math.random() * libres.length)];

      case 'medio':
        return this.movimientoMedio(libres);

      case 'dificil':
        return this.mejorMovimientoMinimax(libres);
    }
  }

  /**
   * Dificultad media: gana si puede, intenta bloquear a veces
   * y aprovecha el centro. Si hay varias opciones, elige al azar.
   */
  private movimientoMedio(libres: number[]): number {
    const gano = this.movimientosQueGanan('O');
    if (gano.length > 0) {
      return gano[Math.floor(Math.random() * gano.length)];
    }

    // Bloquea (no siempre, para que no sea monótono).
    if (Math.random() < 0.75) {
      const bloqueo = this.movimientosQueGanan('X');
      if (bloqueo.length > 0) {
        return bloqueo[Math.floor(Math.random() * bloqueo.length)];
      }
    }

    // También puede aprovechar el centro.
    if (Math.random() < 0.5 && this.tablero[4] === null) {
      return 4;
    }

    return libres[Math.floor(Math.random() * libres.length)];
  }

  /** Casillas donde la ficha dada lograría la victoria en el siguiente turno. */
  private movimientosQueGanan(ficha: Exclude<FichaTres, null>): number[] {
    const result: number[] = [];
    for (let i = 0; i < 9; i++) {
      if (this.tablero[i] !== null) {
        continue;
      }
      const clon = [...this.tablero];
      clon[i] = ficha;
      if (this.evaluar(clon) === ficha) {
        result.push(i);
      }
    }
    return result;
  }

  /**
   * Dificultad difícil: Minimax con desempate aleatorio entre jugadas de
   * igual valor (la IA no repite siempre la misma partida).
   *
   * Una IA perfecta impediría ganar siempre, así que la mayoría de las veces
   * juega óptimo y, con una probabilidad pequeña, elige una jugada del
   * segundo mejor nivel para que el modo sí pueda vencerse.
   */
  private mejorMovimientoMinimax(libres: number[]): number {
    const clon = [...this.tablero];

    const puntuaciones = libres.map((casilla) => {
      clon[casilla] = 'O';
      const valor = this.minimax(clon, 0, false);
      clon[casilla] = null;
      return { valor, casilla };
    });
    puntuaciones.sort((a, b) => b.valor - a.valor);

    const mejorValor = puntuaciones[0].valor;
    const mejores = puntuaciones.filter((p) => p.valor === mejorValor);

    const segundoValor = puntuaciones.find((p) => p.valor < mejorValor)?.valor ?? null;
    const deSegundoNivel = segundoValor !== null
      ? puntuaciones.filter((p) => p.valor === segundoValor)
      : [];

    const grupo = (Math.random() < PROBABILIDAD_ERROR_DIFICIL && deSegundoNivel.length > 0)
      ? deSegundoNivel
      : mejores;

    return grupo[Math.floor(Math.random() * grupo.length)].casilla;
  }

  /** Algoritmo Minimax: la IA (O) maximiza y el jugador (X) minimiza. */
  private minimax(tablero: FichaTres[], profundidad: number, esMaximizador: boolean): number {
    const ganador = this.evaluar(tablero);
    if (ganador === 'O') { return 10 - profundidad; }
    if (ganador === 'X') { return profundidad - 10; }
    if (!tablero.includes(null)) { return 0; }

    const ficha: FichaTres = esMaximizador ? 'O' : 'X';
    let mejor = esMaximizador ? -Infinity : Infinity;

    for (let i = 0; i < 9; i++) {
      if (tablero[i] !== null) {
        continue;
      }
      tablero[i] = ficha;
      const valor = this.minimax(tablero, profundidad + 1, !esMaximizador);
      tablero[i] = null;
      mejor = esMaximizador ? Math.max(mejor, valor) : Math.min(mejor, valor);
    }

    return mejor;
  }

  /** Indices de las casillas todavía vacías. */
  private casillasLibres(): number[] {
    return this.tablero
      .map((casilla, i) => (casilla === null ? i : -1))
      .filter((i) => i >= 0);
  }

  /** Devuelve el ganador del tablero dado, o null si no hay tres en línea. */
  private evaluar(tablero: FichaTres[]): FichaTres {
    for (const [a, b, c] of COMBINACIONES) {
      if (tablero[a] && tablero[a] === tablero[b] && tablero[a] === tablero[c]) {
        return tablero[a];
      }
    }
    return null;
  }

  /** Busca la línea ganadora de la ficha indicada. */
  private buscarLinea(ficha: FichaTres): number[] | null {
    for (const linea of COMBINACIONES) {
      const [a, b, c] = linea;
      if (this.tablero[a] === ficha && this.tablero[b] === ficha && this.tablero[c] === ficha) {
        return linea;
      }
    }
    return null;
  }

  /** Actualiza ganador/empate y lleva el registro de estadísticas. */
  private resolver(): void {
    const ganador = this.evaluar(this.tablero);
    if (ganador === 'X') {
      this.ganador = 'X';
      this.lineaGanadora = this.buscarLinea('X');
      this.turno = null;
      this.victorias++;
      this.guardarStats();
    } else if (ganador === 'O') {
      this.ganador = 'O';
      this.lineaGanadora = this.buscarLinea('O');
      this.turno = null;
      this.derrotas++;
      this.guardarStats();
    } else if (!this.tablero.includes(null)) {
      this.empate = true;
      this.turno = null;
      this.empates++;
      this.guardarStats();
    }
  }

  /** Empieza una partida nueva sin tocar las estadísticas. */
  reiniciarPartida(): void {
    // Cancela el "pensamiento" de la IA pendiente y cambia de dificultad sin efectos.
    if (this.iaPendiente !== null) {
      clearTimeout(this.iaPendiente);
      this.iaPendiente = null;
    }
    this.tablero = Array(9).fill(null);
    this.turno = 'X';
    this.ganador = null;
    this.lineaGanadora = null;
    this.empate = false;
    this.pensando = false;
  }

  /** Borra el marcador de victorias, derrotas y empates. */
  reiniciarEstadisticas(): void {
    this.victorias = 0;
    this.derrotas = 0;
    this.empates = 0;
    this.guardarStats();
    this.reiniciarPartida();
  }

  /** Guarda el marcador en el dispositivo. */
  private guardarStats(): void {
    try {
      const stats = { victorias: this.victorias, derrotas: this.derrotas, empates: this.empates };
      localStorage.setItem(this.CLAVE_STATS, JSON.stringify(stats));
    } catch {
      // Almacenamiento no disponible.
    }
  }

  /** Recupera el marcador guardado en el dispositivo. */
  private cargarStats(): void {
    try {
      const datos = localStorage.getItem(this.CLAVE_STATS);
      if (!datos) { return; }
      const stats = JSON.parse(datos) as { victorias: number; derrotas: number; empates: number };
      this.victorias = stats.victorias ?? 0;
      this.derrotas = stats.derrotas ?? 0;
      this.empates = stats.empates ?? 0;
    } catch {
      // Datos corruptos: se ignoran y se parte de cero.
    }
  }

  /** Vuelve a la lista de juegos. */
  volver(): void {
    void this.router.navigate(['/juegos']);
  }

  ngOnDestroy(): void {
    if (this.iaPendiente !== null) {
      clearTimeout(this.iaPendiente);
      this.iaPendiente = null;
    }
  }

  /*
   // Sonido breve al colocar ficha (Web Audio API). Descomentar para activar.
   // private sonido(bien: boolean): void {
   //   const ctx = new AudioContext();
   //   const osc = ctx.createOscillator();
   //   osc.frequency.value = bien ? 660 : 330;
   //   osc.connect(ctx.destination);
   //   osc.start();
   //   osc.stop(ctx.currentTime + 0.15);
   // }
   */
}
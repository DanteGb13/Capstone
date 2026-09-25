import { Component, OnDestroy } from '@angular/core';
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
import { arrowBack, refreshOutline, play } from 'ionicons/icons';

/** Fase actual del juego. */
export type FaseSimon = 'listo' | 'mostrando' | 'entrada' | 'fin';

/** Nombres de los cuatro botones de colores (índice 0..3). */
const COLORES_SIMON = ['rojo', 'azul', 'verde', 'amarillo'];

@Component({
  selector: 'app-memoria-secuencias',
  templateUrl: './memoria-secuencias.page.html',
  styleUrls: ['./memoria-secuencias.page.scss'],
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
export class MemoriaSecuenciasPage implements OnDestroy {

  colores = COLORES_SIMON;

  /** Secuencia generada por la aplicación (índices de color). */
  secuencia: number[] = [];
  /** Cuántas luces de la secuencia lleva acertadas el usuario. */
  pasoEntrada = 0;

  fase: FaseSimon = 'listo';
  /** Luz encendida actualmente (null = ninguna). */
  activo: number | null = null;

  nivel = 0;
  puntaje = 0;
  mejor = 0;
  partidas = 0;

  /** Secuencias ya generadas en esta sesión para no repetirlas. */
  private secuenciasUsadas: string[] = [];
  private timers: any[] = [];
  private readonly CLAVE_MEJOR = 'sc_simon_mejor_v1';

  constructor(private router: Router) {
    addIcons({ arrowBack, refreshOutline, play });
    this.cargarMejor();
  }

  /** Velocidad de las luces: más rápida a medida que sube el nivel. */
  get velocidad(): number {
    return Math.max(260, 950 - this.nivel * 45);
  }

  /** Mensaje según la fase del juego. */
  get mensaje(): string {
    switch (this.fase) {
      case 'mostrando':
        return 'Memoriza la secuencia...';
      case 'entrada':
        return this.pasoEntrada < this.secuencia.length
          ? `Repite la secuencia (paso ${this.pasoEntrada + 1} de ${this.secuencia.length})`
          : '¡Muy bien!';
      case 'fin':
        return 'Fin del juego';
      default:
        return 'Observa y repite la secuencia de colores.';
    }
  }

  /** ¿El juego está en plena partida (mostrando o en entrada)? */
  get enPartida(): boolean {
    return this.fase === 'mostrando' || this.fase === 'entrada';
  }

  /** Empieza una partida nueva con una secuencia diferente. */
  comenzar(): void {
    this.limpiarTimers();
    this.secuenciasUsadas = [];
    this.secuencia = [];
    this.pasoEntrada = 0;
    this.nivel = 0;
    this.puntaje = 0;
    this.activo = null;
    this.partidas++;
    this.fase = 'mostrando';
    this.avanzarNivel();
  }

  /** Agrega un color a la secuencia y la reproduce. */
  private avanzarNivel(): void {
    this.nivel++;
    this.secuencia.push(this.generarColorNuevo());
    this.pasoEntrada = 0;
    this.mostrarSecuencia();
  }

  /**
   * Elige un color nuevo evitando repetir secuencias ya vistas
   * en esta sesión (cada partida es diferente).
   */
  private generarColorNuevo(): number {
    for (let intento = 0; intento < 60; intento++) {
      const color = Math.floor(Math.random() * COLORES_SIMON.length);
      const clave = [...this.secuencia, color].join('-');
      if (!this.secuenciasUsadas.includes(clave)) {
        this.secuenciasUsadas.push(clave);
        return color;
      }
    }
    const color = Math.floor(Math.random() * COLORES_SIMON.length);
    this.secuenciasUsadas.push([...this.secuencia, color].join('-'));
    return color;
  }

  /** Enciende las luces de la secuencia, una por una. */
  private mostrarSecuencia(): void {
    this.fase = 'mostrando';
    this.activo = null;
    const vel = this.velocidad;
    const pausa = Math.max(120, vel * 0.35);
    const self = this;

    const reproducir = (indice: number): void => {
      if (indice >= self.secuencia.length) {
        self.fase = 'entrada';
        self.pasoEntrada = 0;
        return;
      }

      self.activo = self.secuencia[indice];
      self.timers.push(setTimeout(() => (self.activo = null), vel));
      self.timers.push(setTimeout(() => reproducir(indice + 1), vel + pausa));
    };

    this.timers.push(setTimeout(() => reproducir(0), 550));
  }

  /** Maneja un toque del usuario sobre un botón de color. */
  tocar(color: number): void {
    if (this.fase !== 'entrada') {
      return;
    }
    // Nivel ya completado (esperando pasar al siguiente): ignora el toque.
    if (this.pasoEntrada >= this.secuencia.length) {
      return;
    }

    // Retroalimentación visual inmediata.
    this.activo = color;
    this.timers.push(setTimeout(() => {
      if (this.fase === 'entrada') {
        this.activo = null;
      }
    }, 230));

    const esperado = this.secuencia[this.pasoEntrada];
    if (color !== esperado) {
      this.terminar();
      return;
    }

    this.pasoEntrada++;
    if (this.pasoEntrada >= this.secuencia.length) {
      // Nivel completado: suma puntos y avanza.
      this.puntaje += this.nivel * 10;
      this.timers.push(setTimeout(() => {
        if (this.fase !== 'fin') {
          this.avanzarNivel();
        }
      }, 750));
    }
  }

  /** Finaliza la partida con la secuencia fallida. */
  private terminar(): void {
    this.limpiarTimers();
    this.fase = 'fin';
    this.activo = null;

    if (this.puntaje > this.mejor) {
      this.mejor = this.puntaje;
      this.guardarMejor();
    }
  }

  get nuevoRecord(): boolean {
    return this.fase === 'fin' && this.puntaje === this.mejor && this.puntaje > 0;
  }

  /** Limpia todos los temporizadores pendientes. */
  private limpiarTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
  }

  /** Guarda el mejor puntaje en el dispositivo. */
  private guardarMejor(): void {
    try {
      localStorage.setItem(this.CLAVE_MEJOR, String(this.mejor));
    } catch {
      // Almacenamiento no disponible.
    }
  }

  /** Recupera el mejor puntaje guardado. */
  private cargarMejor(): void {
    try {
      const valor = localStorage.getItem(this.CLAVE_MEJOR);
      if (valor !== null) {
        this.mejor = Number(valor) || 0;
      }
    } catch {
      this.mejor = 0;
    }
  }

  /** Vuelve a la lista de juegos. */
  volver(): void {
    void this.router.navigate(['/juegos']);
  }

  /*
   // Sonido por color (Web Audio API). Descomentar para activar.
   // private sonido(color: number): void {
   //   const ctx = new AudioContext();
   //   const osc = ctx.createOscillator();
   //   osc.frequency.value = 220 + color * 70;
   //   osc.connect(ctx.destination);
   //   osc.start();
   //   osc.stop(ctx.currentTime + 0.2);
   // }
   */

  ngOnDestroy(): void {
    this.limpiarTimers();
  }
}
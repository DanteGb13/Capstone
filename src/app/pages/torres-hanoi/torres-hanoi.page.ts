import { Component, ElementRef, OnDestroy, QueryList, ViewChild, ViewChildren } from '@angular/core';
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
import { arrowBack, refreshOutline } from 'ionicons/icons';

/** Cantidad de discos permitida. */
export type CantidadDiscos = 3 | 4 | 5;

/** Récords guardados por cantidad de discos. */
export interface RegistroRecord {
  [discos: number]: number;
}

/* Medidas (px) usadas por la animación de disco volador. */
const ALTO_DISCO_PX = 30;
const PASO_PILA_PX = 34; // alto del disco + separación entre discos.
const ALTO_BASE_PX = 16;

@Component({
  selector: 'app-torres-hanoi',
  templateUrl: './torres-hanoi.page.html',
  styleUrls: ['./torres-hanoi.page.scss'],
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
export class TorresHanoiPage implements OnDestroy {

  opcionesDiscos: CantidadDiscos[] = [3, 4, 5];
  cantidad: CantidadDiscos = 3;

  /** Torres: cada número es el tamaño del disco (mayor = base). */
  torres: number[][] = [[], [], []];
  movimientos = 0;
  segundos = 0;
  terminado = false;
  torreSel: number | null = null;
  moviendo = false;
  msj = '';
  msjError = false;
  nuevoRecordStar = false;

  /** Velocidad de la animación, distinta en cada partida. */
  velocidad = 420;

  /** Número de partidas iniciadas. */
  partidas = 0;

  mejores: RegistroRecord = {};

  private cronoId: any = null;
  private tiempoIniciado = false;
  /** Identificador único de la partida actual (cambia al reiniciar). */
  private idPartida = 0;
  private vueloEl: HTMLElement | null = null;
  private readonly CLAVE_MEJORES = 'sc_hanoi_records_v1';
  private readonly CLAVE_PARTIDAS = 'sc_hanoi_partidas_v1';

  @ViewChild('tableroHanoi') tableroRef!: ElementRef<HTMLElement>;
  @ViewChildren('torre') torreEls!: QueryList<ElementRef<HTMLElement>>;

  constructor(private router: Router) {
    addIcons({ arrowBack, refreshOutline });
    this.cargarMejores();
    this.cargarPartidas();
    this.reiniciar();
  }

  /** Número mínimo teórico de movimientos para esta cantidad de discos. */
  get minMovimientos(): number {
    return Math.pow(2, this.cantidad) - 1;
  }

  /** Mejor récord guardado para la cantidad de discos actual. */
  get record(): number | null {
    return this.mejores[this.cantidad] ?? null;
  }

  /** Tiempo transcurrido en formato m:ss. */
  get tiempoTexto(): string {
    return `${Math.floor(this.segundos / 60)}:${(this.segundos % 60).toString().padStart(2, '0')}`;
  }

  /** Cambia la cantidad de discos y reinicia la partida. */
  cambiarCantidad(valor: CantidadDiscos): void {
    if (this.cantidad === valor) {
      return;
    }
    this.cantidad = valor;
    this.reiniciar();
  }

  /** Prepara una partida nueva. */
  reiniciar(): void {
    this.detenerCrono();
    this.tiempoIniciado = false;
    this.moviendo = false;
    this.torreSel = null;
    this.terminado = false;
    this.nuevoRecordStar = false;
    this.movimientos = 0;
    this.segundos = 0;
    this.msj = '';
    this.msjError = false;

    // Invalida cualquier animación de disco en vuelo de la partida anterior.
    this.idPartida++;
    this.limpiarVuelo();

    // La primera torre se llena con todos los discos (grande en la base).
    this.torres = [[], [], []];
    for (let disco = this.cantidad; disco >= 1; disco--) {
      this.torres[0].push(disco);
    }

    // Cada partida usa una velocidad de animación distinta.
    this.velocidad = 340 + Math.round(Math.random() * 260);

    // Contador de partidas iniciadas.
    this.partidas++;
    this.guardarPartidas();
  }

  /** Procesa un toque sobre una torre. */
  tapTorre(indice: number): void {
    if (this.terminado || this.moviendo) {
      return;
    }

    // Primera selección: se elige la torre de origen.
    if (this.torreSel === null) {
      if (this.torres[indice].length === 0) {
        return;
      }
      this.torreSel = indice;
      this.msj = '';
      return;
    }

    const desde = this.torreSel;
    // Tocar la misma torre cancela la selección.
    if (desde === indice) {
      this.torreSel = null;
      return;
    }

    const disco = this.torres[desde][this.torres[desde].length - 1];
    const topeDestino = this.torres[indice].length > 0
      ? this.torres[indice][this.torres[indice].length - 1]
      : Infinity;

    this.torreSel = null;

    // Movimiento inválido: disco grande sobre uno pequeño.
    if (disco > topeDestino) {
      this.msj = 'No puedes colocar un disco grande sobre uno pequeño.';
      this.msjError = true;
      setTimeout(() => (this.msjError = false), 1300);
      return;
    }

    this.moverDisco(desde, indice, disco);
  }

  /** Ejecuta un movimiento válido con animación. */
  private moverDisco(desde: number, hasta: number, disco: number): void {
    if (!this.tiempoIniciado) {
      this.tiempoIniciado = true;
      this.iniciarCrono();
    }
    this.moviendo = true;

    const id = this.idPartida;
    void this.animarVuelo(desde, hasta).then(() => {
      // La partida cambió mientras el disco volaba: no tocar las torres.
      if (this.idPartida !== id) {
        return;
      }
      this.torres[desde].pop();
      this.torres[hasta].push(disco);
      this.movimientos++;
      this.moviendo = false;
      this.revisarVictoria();
    });
  }

  /**
   * Crea un disco "volador" temporal y lo anima desde la torre de origen
   * hasta la de destino usando la Web Animations API.
   */
  private animarVuelo(desde: number, hasta: number): Promise<void> {
    const contenedor = this.tableroRef?.nativeElement;
    const torres = this.torreEls?.toArray();

    if (!contenedor || !torres || torres.length < 3) {
      return Promise.resolve();
    }

    const origenEl = torres[desde].nativeElement;
    const destinoEl = torres[hasta].nativeElement;
    const disco = this.torres[desde][this.torres[desde].length - 1];

    const contRect = contenedor.getBoundingClientRect();
    const orgRect = origenEl.getBoundingClientRect();
    const dstRect = destinoEl.getBoundingClientRect();

    const anchoDisco = Math.round(origenEl.clientWidth * this.anchoDiscoPorc(disco) / 100);
    const xIni = orgRect.left + orgRect.width / 2 - anchoDisco / 2 - contRect.left;
    const xFin = dstRect.left + dstRect.width / 2 - anchoDisco / 2 - contRect.left;

    const desdeCount = this.torres[desde].length;
    const hastaCount = this.torres[hasta].length;
    const yIni = orgRect.bottom - ALTO_BASE_PX - (desdeCount - 1) * PASO_PILA_PX - ALTO_DISCO_PX - contRect.top;
    const yFin = dstRect.bottom - ALTO_BASE_PX - hastaCount * PASO_PILA_PX - ALTO_DISCO_PX - contRect.top;

    const vuelo = document.createElement('div');
    vuelo.className = 'disco-volador';
    vuelo.style.width = `${anchoDisco}px`;
    vuelo.style.height = `${ALTO_DISCO_PX}px`;
    vuelo.style.borderRadius = '12px';
    vuelo.style.background = this.colorDisco(disco);
    vuelo.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.18)';
    contenedor.appendChild(vuelo);
    this.vueloEl = vuelo;

    const elevacion = 130;

    const animacion = vuelo.animate(
      [
        { transform: `translate(${xIni}px, ${yIni - elevacion}px)` },
        { transform: `translate(${xFin}px, ${yFin - elevacion}px)` },
        { transform: `translate(${xFin}px, ${yFin}px)` }
      ],
      { duration: this.velocidad, easing: 'ease-in-out' }
    );

    return animacion.finished
      .catch(() => {
        // Animación cancelada (el disco fue retirado al reiniciar).
      })
      .then(() => {
        if (this.vueloEl === vuelo) {
          this.vueloEl = null;
        }
        vuelo.remove();
      });
  }

  /** Retira y elimina el disco que esté volando, si lo hay. */
  private limpiarVuelo(): void {
    if (this.vueloEl !== null) {
      this.vueloEl.remove();
      this.vueloEl = null;
    }
  }

  /** Comprueba si el jugador ya armó la torre final. */
  private revisarVictoria(): void {
    if (this.torres[2].length !== this.cantidad) {
      return;
    }
    this.detenerCrono();
    this.terminado = true;

    const actual = this.mejores[this.cantidad];
    if (actual === undefined || this.movimientos < actual) {
      this.mejores[this.cantidad] = this.movimientos;
      this.nuevoRecordStar = true;
      this.guardarMejores();
    }
  }

  /** Ancho (en %) que ocupa un disco dentro de su torre. */
  anchoDiscoPorc(disco: number): number {
    return 18 + disco * 12;
  }

  /** Degradado de color del disco según su tamaño. */
  colorDisco(disco: number): string {
    const mapa: Record<number, string> = {
      1: 'linear-gradient(90deg, #9c3ded, #c084fc)',
      2: 'linear-gradient(90deg, #8b2fd6, #a78bfa)',
      3: 'linear-gradient(90deg, #7715c7, #8b5cf6)',
      4: 'linear-gradient(90deg, #5f0fa3, #7c3aed)',
      5: 'linear-gradient(90deg, #4b0d85, #6d28d9)'
    };
    return mapa[disco] ?? mapa[3];
  }

  private iniciarCrono(): void {
    this.cronoId = setInterval(() => {
      this.segundos++;
    }, 1000);
  }

  private detenerCrono(): void {
    if (this.cronoId !== null) {
      clearInterval(this.cronoId);
      this.cronoId = null;
    }
  }

  /** Guarda los récords por cantidad de discos. */
  private guardarMejores(): void {
    try {
      localStorage.setItem(this.CLAVE_MEJORES, JSON.stringify(this.mejores));
    } catch {
      // Almacenamiento no disponible.
    }
  }

  /** Recupera los récords guardados. */
  private cargarMejores(): void {
    try {
      const datos = localStorage.getItem(this.CLAVE_MEJORES);
      if (!datos) { return; }
      this.mejores = JSON.parse(datos) as RegistroRecord;
    } catch {
      this.mejores = {};
    }
  }

  /** Guarda el contador de partidas en el dispositivo. */
  private guardarPartidas(): void {
    try {
      localStorage.setItem(this.CLAVE_PARTIDAS, String(this.partidas));
    } catch {
      // Almacenamiento no disponible.
    }
  }

  /** Recupera el contador de partidas guardado. */
  private cargarPartidas(): void {
    try {
      const valor = localStorage.getItem(this.CLAVE_PARTIDAS);
      if (valor !== null) {
        this.partidas = Number(valor) || 0;
      }
    } catch {
      this.partidas = 0;
    }
  }

  /** Vuelve a la lista de juegos. */
  volver(): void {
    void this.router.navigate(['/juegos']);
  }

  /*
   // Sonido al mover un disco (Web Audio API). Descomentar para activar.
   // private sonido(): void {
   //   const ctx = new AudioContext();
   //   const osc = ctx.createOscillator();
   //   osc.frequency.value = 520;
   //   osc.type = 'triangle';
   //   osc.connect(ctx.destination);
   //   osc.start();
   //   osc.stop(ctx.currentTime + 0.12);
   // }
   */

  ngOnDestroy(): void {
    this.detenerCrono();
  }
}
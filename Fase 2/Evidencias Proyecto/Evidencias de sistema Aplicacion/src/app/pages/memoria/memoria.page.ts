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
import { arrowBack, albumsOutline, helpCircleOutline, refreshOutline } from 'ionicons/icons';
import { TutorialJuegoComponent } from '../../components/tutorial-juego/tutorial-juego.component';
import { TUTORIAL_MEMORIA } from '../juegos/tutoriales';
import { suspenderZoomJuego, reanudarZoomJuego } from '../../services/font-size/font-size';

/** Una carta del tablero de memoria. */
export interface CartaMemoria {
  id: number;
  emoji: string;
  parejaId: number;
  volteada: boolean;
  encontrada: boolean;
}

/** Pares de imágenes disponibles para la partida. */
const PARES: { parejaId: number; emoji: string }[] = [
  { parejaId: 1, emoji: '🍎' },
  { parejaId: 2, emoji: '🌳' },
  { parejaId: 3, emoji: '🐱' },
  { parejaId: 4, emoji: '🐶' },
  { parejaId: 5, emoji: '🌞' },
  { parejaId: 6, emoji: '🐟' }
];

@Component({
  selector: 'app-memoria',
  templateUrl: './memoria.page.html',
  styleUrls: ['./memoria.page.scss'],
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
export class MemoriaPage implements OnDestroy {

  /** True mientras se muestra el tutorial de "Cómo jugar". */
  mostrarTutorial = true;
  pasosTutorial = TUTORIAL_MEMORIA;

  cartas: CartaMemoria[] = [];

  /** Impide girar cartas mientras se revisa una pareja. */
  podemosJugar = true;

  movimientos = 0;
  minutos = 0;
  segundos = 0;
  terminado = false;

  private cronoId: any = null;
  private tiempoIniciado = false;
  private volteandas: CartaMemoria[] = [];
  /** Evita repintar cuando la página ya fue destruida. */
  private destruido = false;

  constructor(private router: Router, private cdr: ChangeDetectorRef) {
    addIcons({ arrowBack, albumsOutline, helpCircleOutline, refreshOutline });
    suspenderZoomJuego();
    this.iniciar();
  }

  /** Construye un nuevo mazo barajado y deja todo en cero. */
  private iniciar(): void {
    this.detenerCrono();
    this.tiempoIniciado = false;
    this.podemosJugar = true;
    this.movimientos = 0;
    this.minutos = 0;
    this.segundos = 0;
    this.terminado = false;
    this.volteandas = [];

    const mazo: CartaMemoria[] = [];
    for (const par of PARES) {
      mazo.push(
        { id: mazo.length, emoji: par.emoji, parejaId: par.parejaId, volteada: false, encontrada: false },
        { id: mazo.length + 1, emoji: par.emoji, parejaId: par.parejaId, volteada: false, encontrada: false }
      );
    }
    this.cartas = this.barajar(mazo);
  }

  /** Baraja un arreglo (algoritmo de Fisher-Yates). */
  private barajar<T>(arreglo: T[]): T[] {
    const copia = [...arreglo];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  }

  /** Gira una carta y evalua las parejas. */
  voltear(carta: CartaMemoria): void {
    if (!this.podemosJugar || carta.encontrada || carta.volteada) {
      return;
    }

    if (!this.tiempoIniciado) {
      this.iniciarCrono();
    }

    carta.volteada = true;
    this.volteandas.push(carta);

    if (this.volteandas.length !== 2) {
      return;
    }

    this.movimientos++;
    const [a, b] = this.volteandas;

    if (a.emoji === b.emoji) {
      a.encontrada = true;
      b.encontrada = true;
      this.volteandas = [];
      this.verificarFin();
      return;
    }

    // Pareja incorrecta: se da la vuelta tras un instante.
    this.podemosJugar = false;
    setTimeout(() => {
      a.volteada = false;
      b.volteada = false;
      this.podemosJugar = true;
      this.volteandas = [];
      if (!this.destruido) {
        this.cdr.detectChanges();
      }
    }, 1100);
  }

  private iniciarCrono(): void {
    this.tiempoIniciado = true;
    this.cronoId = setInterval(() => {
      this.segundos++;
      if (this.segundos === 60) {
        this.segundos = 0;
        this.minutos++;
      }
      // Los temporizadores no disparan la detección de cambios en esta app,
      // así que se fuerza el renderizado para que el tiempo se vea avanzar.
      if (!this.destruido) {
        this.cdr.detectChanges();
      }
    }, 1000);
  }

  private detenerCrono(): void {
    if (this.cronoId !== null) {
      clearInterval(this.cronoId);
      this.cronoId = null;
    }
  }

  private verificarFin(): void {
    if (this.cartas.every((c) => c.encontrada)) {
      this.detenerCrono();
      setTimeout(() => {
        this.terminado = true;
        if (!this.destruido) {
          this.cdr.detectChanges();
        }
      }, 650);
    }
  }

  /** Tiempo transcurrido en formato m:ss. */
  get tiempoTexto(): string {
    return `${this.minutos}:${this.segundos.toString().padStart(2, '0')}`;
  }

  /** Pone una partida nueva. */
  jugarDeNuevo(): void {
    this.iniciar();
  }

  /** Vuelve a la lista de juegos. */
  volver(): void {
    void this.router.navigate(['/juegos']);
  }

  ngOnDestroy(): void {
    this.destruido = true;
    this.detenerCrono();
    reanudarZoomJuego();
  }
}
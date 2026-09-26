import { Component } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardTitle
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  arrowBack,
  albumsOutline,
  gridOutline,
  extensionPuzzleOutline,
  appsOutline,
  flashOutline,
  play
} from 'ionicons/icons';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';

/**
 * Tarjeta de un juego disponible en la sección Bienestar.
 */
export interface JuegoDisponible {
  nombre: string;
  descripcion: string;
  icono: string;
  dificultad: string;
  ruta: string;
}

/** Catálogo de juegos que se muestran en la página principal. */
const JUEGOS_DISPONIBLES: JuegoDisponible[] = [
  {
    nombre: 'Memoria',
    descripcion: 'Encuentra las parejas de imágenes.',
    icono: 'albums-outline',
    dificultad: 'Fácil',
    ruta: '/juegos/memoria'
  },
  {
    nombre: 'Sopa de letras',
    descripcion: 'Busca las palabras ocultas en la cuadrícula.',
    icono: 'grid-outline',
    dificultad: 'Media',
    ruta: '/juegos/sopa-letras'
  },
  {
    nombre: 'Rompecabeza',
    descripcion: 'Ordena las piezas para armar la imagen. Usa tu propia foto.',
    icono: 'extension-puzzle-outline',
    dificultad: 'Media',
    ruta: '/juegos/rompecabezas'
  },
  {
    nombre: 'Tres en línea',
    descripcion: 'Completa una línea de tres. Juega contra la IA.',
    icono: 'apps-outline',
    dificultad: '3 niveles',
    ruta: '/juegos/tic-tac-toe'
  },
  {
    nombre: 'Memoria de secuencias',
    descripcion: 'Obsérvalas, memorízalas y repite las secuencias de luces.',
    icono: 'flash-outline',
    dificultad: 'Progresiva',
    ruta: '/juegos/memoria-secuencias'
  }
];

@Component({
  selector: 'app-juegos',
  templateUrl: './juegos.page.html',
  styleUrls: ['./juegos.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonCard,
    IonCardTitle
  ]
})
export class JuegosPage {

  juegos: JuegoDisponible[] = JUEGOS_DISPONIBLES;

  constructor(
    private router: Router,
    private navRol: NavegacionRolService
  ) {
    addIcons({
      arrowBack,
      albumsOutline,
      gridOutline,
      extensionPuzzleOutline,
      appsOutline,
      flashOutline,
      play
    });
  }

  /** Abre el juego elegido. */
  jugar(evento: Event, juego: JuegoDisponible): void {
    evento.stopPropagation();
    void this.router.navigate([juego.ruta]);
  }

  /** Vuelve al panel principal según el rol del usuario. */
  volver(): void {
    void this.navRol.irAPanelPrincipal();
  }
}
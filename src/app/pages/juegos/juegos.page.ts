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
  helpCircleOutline,
  gridOutline,
  extensionPuzzleOutline,
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
  ruta: string;
}

/** Catálogo de juegos que se muestran en la página principal. */
const JUEGOS_DISPONIBLES: JuegoDisponible[] = [
  {
    nombre: 'Memoria',
    descripcion: 'Encuentra las parejas de imágenes.',
    icono: 'albums-outline',
    ruta: '/juegos/memoria'
  },
  {
    nombre: 'Trivia',
    descripcion: 'Responde preguntas de cultura general.',
    icono: 'help-circle-outline',
    ruta: '/juegos/trivia'
  },
  {
    nombre: 'Sopa de letras',
    descripcion: 'Busca las palabras ocultas en la cuadrícula.',
    icono: 'grid-outline',
    ruta: '/juegos/sopa-letras'
  },
  {
    nombre: 'Rompecabezas',
    descripcion: 'Ordena las piezas para armar la imagen.',
    icono: 'extension-puzzle-outline',
    ruta: '/juegos/rompecabezas'
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
      helpCircleOutline,
      gridOutline,
      extensionPuzzleOutline,
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
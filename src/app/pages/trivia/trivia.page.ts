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
import { arrowBack, helpCircleOutline } from 'ionicons/icons';

/** Una pregunta del juego de trivia. */
export interface PreguntaTrivia {
  pregunta: string;
  opciones: string[];
  /** Índice de la opción correcta dentro de opciones[]. */
  correcta: number;
}

/** Fase en la que se encuentra la partida. */
export type FaseTrivia = 'inicio' | 'jugando' | 'resultados';

/** Banco de preguntas de cultura general (pensadas para adultos mayores). */
const PREGUNTAS: PreguntaTrivia[] = [
  {
    pregunta: '¿Cuántos días tiene una semana?',
    opciones: ['5', '6', '7', '8'],
    correcta: 2
  },
  {
    pregunta: '¿De qué color es el cielo en un día despejado?',
    opciones: ['Verde', 'Azul', 'Rojo', 'Amarillo'],
    correcta: 1
  },
  {
    pregunta: '¿Cuál es la capital de Chile?',
    opciones: ['Valparaíso', 'Concepción', 'Santiago', 'Antofagasta'],
    correcta: 2
  },
  {
    pregunta: '¿Qué planeta es conocido como "el planeta rojo"?',
    opciones: ['Venus', 'Marte', 'Júpiter', 'Mercurio'],
    correcta: 1
  },
  {
    pregunta: '¿Cuánto es 5 + 3?',
    opciones: ['6', '7', '8', '9'],
    correcta: 2
  },
  {
    pregunta: '¿En qué estación del año hace más frío?',
    opciones: ['Invierno', 'Verano', 'Primavera', 'Otoño'],
    correcta: 0
  },
  {
    pregunta: '¿En qué mes se celebra la Navidad?',
    opciones: ['Octubre', 'Noviembre', 'Diciembre', 'Enero'],
    correcta: 2
  },
  {
    pregunta: '¿Qué animal produce la miel?',
    opciones: ['La hormiga', 'La mosca', 'El colibrí', 'La abeja'],
    correcta: 3
  },
  {
    pregunta: '¿Cuál es el órgano que usamos para respirar?',
    opciones: ['El corazón', 'Los pulmones', 'El estómago', 'Los riñones'],
    correcta: 1
  },
  {
    pregunta: '¿Cuántos lados tiene un triángulo?',
    opciones: ['Dos', 'Tres', 'Cuatro', 'Seis'],
    correcta: 1
  }
];

@Component({
  selector: 'app-trivia',
  templateUrl: './trivia.page.html',
  styleUrls: ['./trivia.page.scss'],
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
export class TriviaPage {

  fase: FaseTrivia = 'inicio';
  indice = 0;
  seleccionada: number | null = null;
  puntaje = 0;

  constructor(private router: Router) {
    addIcons({ arrowBack, helpCircleOutline });
  }

  /** Pregunta visible actualmente. */
  get pregunta(): PreguntaTrivia {
    return PREGUNTAS[this.indice];
  }

  /** Número total de preguntas del juego. */
  get totalPreguntas(): number {
    return PREGUNTAS.length;
  }

  get hayMasPreguntas(): boolean {
    return this.indice < PREGUNTAS.length - 1;
  }

  get respuestaCorrecta(): boolean {
    return this.seleccionada === this.pregunta.correcta;
  }

  /** Empieza una partida desde cero. */
  comenzar(): void {
    this.indice = 0;
    this.puntaje = 0;
    this.seleccionada = null;
    this.fase = 'jugando';
  }

  /** Marca la opción elegida y suma puntos si es correcta. */
  elegir(opcion: number): void {
    if (this.seleccionada !== null) {
      return;
    }
    this.seleccionada = opcion;
    if (opcion === this.pregunta.correcta) {
      this.puntaje++;
    }
  }

  /** Avanza a la siguiente pregunta o muestra los resultados. */
  siguiente(): void {
    this.seleccionada = null;
    if (this.hayMasPreguntas) {
      this.indice++;
    } else {
      this.fase = 'resultados';
    }
  }

  /** Mensaje amigable según el puntaje obtenido. */
  get mensajeResultado(): string {
    const total = this.totalPreguntas;
    if (this.puntaje === total) {
      return '¡Perfecto! Respondiste todas las preguntas correctamente.';
    }
    if (this.puntaje >= total * 0.7) {
      return '¡Muy bien! Te fue genial, sigue practicando.';
    }
    if (this.puntaje >= total * 0.4) {
      return 'Buen intento. ¡Puedes mejorar en la próxima partida!';
    }
    return 'No te preocupes. Practica un poco más y lo lograrás.';
  }

  /** Vuelve a empezar otra partida. */
  jugarDeNuevo(): void {
    this.comenzar();
  }

  /** Vuelve a la lista de juegos. */
  volver(): void {
    void this.router.navigate(['/juegos']);
  }
}
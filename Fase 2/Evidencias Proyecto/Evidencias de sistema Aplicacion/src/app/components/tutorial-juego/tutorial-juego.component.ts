import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';

/** Un paso del tutorial: un emoji grande y la explicación en palabras simples. */
export interface PasoTutorial {
  icono: string;
  texto: string;
}

/**
 * Pantalla de "Cómo jugar" que se muestra antes de empezar cada juego.
 * Muestra un solo paso a la vez (nunca hay que deslizar, ni siquiera con la
 * letra extra grande) y tiene un botón X para salir sin empezar a jugar.
 * Está pensada para adultos mayores: letra grande y botones anchos.
 */
@Component({
  selector: 'app-tutorial-juego',
  templateUrl: './tutorial-juego.component.html',
  styleUrls: ['./tutorial-juego.component.scss'],
  imports: [IonButton, IonIcon]
})
export class TutorialJuegoComponent {
  @Input() titulo = 'Cómo jugar';
  @Input() introduccion = '';
  @Input() pasos: PasoTutorial[] = [];
  @Output() comenzar = new EventEmitter<void>();
  @Output() cerrar = new EventEmitter<void>();

  /** Índice del paso que se está mostrando (uno por pantalla). */
  indice = 0;

  constructor() {
    addIcons({ closeOutline });
  }

  get total(): number {
    return this.pasos.length;
  }

  get pasoActual(): PasoTutorial | null {
    return this.pasos[this.indice] ?? null;
  }

  get esPrimero(): boolean {
    return this.indice === 0;
  }

  get esUltimo(): boolean {
    return this.indice >= this.total - 1;
  }

  /** Vuelve al paso anterior. */
  anterior(): void {
    if (this.indice > 0) {
      this.indice--;
    }
  }

  /** Avanza al paso siguiente; en el último, cierra y empieza el juego. */
  siguiente(): void {
    if (this.esUltimo) {
      this.comenzar.emit();
      return;
    }
    this.indice++;
  }

  /** Cierra las instrucciones sin empezar a jugar. */
  salir(): void {
    this.cerrar.emit();
  }
}
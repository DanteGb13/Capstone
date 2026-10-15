import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { VERSION_APP } from '../../../version';
import { RUTA_INDICE_PRIVACIDAD, TOTAL_DOCUMENTOS, formatearActualizacion } from './documentos';

/**
 * Documento 4 — Estándares y buenas prácticas.
 *
 * Cada norma dice tres cosas: qué es, en qué se relaciona con esta app y qué
 * buenas prácticas se están aplicando. Y las cuatro, el estado: referencia de
 * trabajo, sin certificación. La advertencia va arriba y no al final porque es
 * lo primero que hay que dejar claro.
 */
@Component({
  selector: 'app-privacidad-estandares',
  templateUrl: './privacidad-estandares.page.html',
  styleUrls: ['./privacidad-base.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon]
})
export class PrivacidadEstandaresPage {

  readonly total = TOTAL_DOCUMENTOS;
  readonly actualizacion = formatearActualizacion(VERSION_APP);

  constructor(private router: Router) {
    addIcons({ chevronBackOutline, shieldCheckmarkOutline });
  }

  volver() {
    this.router.navigate([RUTA_INDICE_PRIVACIDAD]);
  }
}

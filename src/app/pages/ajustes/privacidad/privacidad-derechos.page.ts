import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline } from 'ionicons/icons';
import { VERSION_APP } from '../../../version';
import { RUTA_INDICE_PRIVACIDAD, TOTAL_DOCUMENTOS, formatearActualizacion } from './documentos';

/**
 * Documento 5 — Derechos sobre los datos.
 *
 * Cada derecho dice dos cosas: dónde se ejerce dentro de la app y, cuando no se
 * puede hacer desde la app, exactamente a quién se escribe y qué se pone en el
 * mensaje. No hay "pendiente de indicar" en ningún punto: si una acción no
 * existe en pantalla, se dice que no existe y se da la alternativa real.
 */
@Component({
  selector: 'app-privacidad-derechos',
  templateUrl: './privacidad-derechos.page.html',
  styleUrls: ['./privacidad-base.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon]
})
export class PrivacidadDerechosPage {

  readonly total = TOTAL_DOCUMENTOS;
  readonly actualizacion = formatearActualizacion(VERSION_APP);

  constructor(private router: Router) {
    addIcons({ chevronBackOutline });
  }

  volver() {
    this.router.navigate([RUTA_INDICE_PRIVACIDAD]);
  }
}

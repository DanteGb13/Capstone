import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline } from 'ionicons/icons';
import { VERSION_APP } from '../../../version';
import { RUTA_INDICE_PRIVACIDAD, TOTAL_DOCUMENTOS, formatearActualizacion } from './documentos';

/**
 * Documento 2 — Términos y condiciones.
 *
 * Son las reglas de uso, no un contrato firmado: por eso el texto explica qué
 * espera la app de cada persona en lugar de citar cláusulas. Lo que no se puede
 * comprobar (por ejemplo, una ley aplicable) queda fuera en vez de inventarse.
 */
@Component({
  selector: 'app-privacidad-terminos',
  templateUrl: './privacidad-terminos.page.html',
  styleUrls: ['./privacidad-base.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon]
})
export class PrivacidadTerminosPage {

  readonly total = TOTAL_DOCUMENTOS;
  readonly actualizacion = formatearActualizacion(VERSION_APP);

  constructor(private router: Router) {
    addIcons({ chevronBackOutline });
  }

  volver() {
    this.router.navigate([RUTA_INDICE_PRIVACIDAD]);
  }
}

import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline } from 'ionicons/icons';
import { VERSION_APP, BUILD_APP } from '../../../version';
import {
  DOCUMENTOS_PRIVACIDAD,
  RUTA_INDICE_PRIVACIDAD,
  TOTAL_DOCUMENTOS,
  formatearActualizacion
} from './documentos';

/**
 * Documento 6 — Contacto y fecha de actualización.
 *
 * El canal real es el correo con el que se registró la cuenta: es el mismo que
 * usa la app para mandar los códigos de verificación, así que escribir desde
 * otro correo no sirve para probar que la solicitud es de quien dice ser.
 *
 * La fecha no se escribe a mano, sale de `version.ts`, que ya se bumpea en cada
 * compilación.
 */
@Component({
  selector: 'app-privacidad-contacto',
  templateUrl: './privacidad-contacto.page.html',
  styleUrls: ['./privacidad-base.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon]
})
export class PrivacidadContactoPage {

  readonly total = TOTAL_DOCUMENTOS;
  readonly documentos = DOCUMENTOS_PRIVACIDAD;
  readonly actualizacion = formatearActualizacion(VERSION_APP);
  readonly version = `${VERSION_APP} · ${BUILD_APP}`;

  constructor(private router: Router) {
    addIcons({ chevronBackOutline });
  }

  volver() {
    this.router.navigate([RUTA_INDICE_PRIVACIDAD]);
  }
}

import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline } from 'ionicons/icons';
import { VERSION_APP } from '../../../version';
import { RUTA_INDICE_PRIVACIDAD, TOTAL_DOCUMENTOS, formatearActualizacion } from './documentos';

/**
 * Documento 3 — Política de seguridad.
 *
 * Cada punto describe una medida que se puede comprobar en el código (por
 * ejemplo, el enlace de una foto que dura una hora) o, cuando no se puede
 * comprobar, se dice openly que no existe. Por eso NO hay punto de copias de
 * seguridad: no hay forma de verificar que existan y una promesa falsa en un
 * documento de seguridad es peor que el silencio.
 */
@Component({
  selector: 'app-privacidad-seguridad',
  templateUrl: './privacidad-seguridad.page.html',
  styleUrls: ['./privacidad-base.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon]
})
export class PrivacidadSeguridadPage {

  readonly total = TOTAL_DOCUMENTOS;
  readonly actualizacion = formatearActualizacion(VERSION_APP);

  constructor(private router: Router) {
    addIcons({ chevronBackOutline });
  }

  volver() {
    this.router.navigate([RUTA_INDICE_PRIVACIDAD]);
  }
}

import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { VERSION_APP } from '../../../version';
import { DOCUMENTOS_PRIVACIDAD, TOTAL_DOCUMENTOS, formatearActualizacion } from './documentos';

/**
 * Índice de la sección "Políticas, Privacidad y Seguridad".
 *
 * Esta pantalla no explica nada: sólo dice qué hay y abre el documento. La
 * razón es práctica. Todo en un solo scroll obligaba a bajar hasta el último
 * punto para ver qué había, y con un índice la persona elige por dónde empezar.
 *
 * El aviso de que la app no es un sistema de emergencias se queda ACÁ, y no en
 * uno de los documentos: es la única frase de esta sección que tiene que
 * verse sí o sí, sin importar por dónde empiece a leer.
 */
@Component({
  selector: 'app-privacidad',
  templateUrl: './privacidad.page.html',
  styleUrls: ['./privacidad-base.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon]
})
export class PrivacidadPage {

  readonly documentos = DOCUMENTOS_PRIVACIDAD;
  readonly total = TOTAL_DOCUMENTOS;
  readonly actualizacion = formatearActualizacion(VERSION_APP);
  readonly anioActual = new Date().getFullYear();

  constructor(private router: Router) {
    addIcons({ chevronBackOutline, chevronForwardOutline, shieldCheckmarkOutline });
  }

  abrir(ruta: string) {
    this.router.navigateByUrl(ruta);
  }

  volver() {
    this.router.navigate(['/ajustes']);
  }
}

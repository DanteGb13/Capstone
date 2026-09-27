import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { VERSION_APP } from '../../../version';
import { RUTA_INDICE_PRIVACIDAD, TOTAL_DOCUMENTOS, formatearActualizacion } from './documentos';

/**
 * Documento 1 — Política de privacidad.
 *
 * Todos los datos que se listan abajo salen de las tablas que la app usa de
 * verdad (usuario, direccion, ubicacion, historial_desplazamiento, zona_segura,
 * zona_viaje, sos_alerta, alarma_recordatorio, contacto_emergencia,
 * push_tokens, fotos-perfil), de los permisos que realmente pide y de los
 * servicios externos a los que realmente llama. Cuando algo no se puede
 * comprobar desde el código, no se escribe: es mejor callar que prometer.
 */
@Component({
  selector: 'app-privacidad-datos',
  templateUrl: './privacidad-datos.page.html',
  styleUrls: ['./privacidad-base.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon]
})
export class PrivacidadDatosPage {

  readonly total = TOTAL_DOCUMENTOS;
  readonly actualizacion = formatearActualizacion(VERSION_APP);

  constructor(private router: Router) {
    addIcons({ chevronBackOutline, shieldCheckmarkOutline });
  }

  irAPermisos() {
    this.router.navigate(['/permisos']);
  }

  volver() {
    this.router.navigate([RUTA_INDICE_PRIVACIDAD]);
  }
}

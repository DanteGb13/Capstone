import { Component } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonRange
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, checkmarkOutline } from 'ionicons/icons';
import {
  ColorblindService,
  ModoDaltonismo
} from '../../../services/colorblind/colorblind.service';

@Component({
  selector: 'app-filtro-color',
  templateUrl: './filtro-color.page.html',
  styleUrls: ['./filtro-color.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonRange
  ]
})
export class FiltroColorPage {

  seleccionActual: ModoDaltonismo;
  intensidad: number;

  /**
   * Muestras de la vista previa: los tokens REALES de la app (rojo de SOS,
   * verde de "todo bien", ámbar de aviso) con su figura.
   *
   * Van con el color original en línea, a propósito. Como el filtro ya está
   * aplicado a `ion-app`, el navegador los pinta por la matriz y el usuario ve
   * exactamente el mismo rojo que verá en su botón de emergencia. Ponerlos
   * con `var(--sc-danger)` y el filtro activo equivaldría a transformarlos dos
   * veces y la vista previa mentiría.
   *
   * La figura (▲/■/◆) va siempre, con filtro o sin él: es la parte que hace
   * la app usable cuando el color no se distingue.
   */
  readonly muestras = [
    { nombre: 'ALERTA', figura: '▲', color: '#dc2626' },
    { nombre: 'TODO BIEN', figura: '■', color: '#22a447' },
    { nombre: 'AVISO', figura: '◆', color: '#e07b00' }
  ];

  constructor(
    private router: Router,
    public colorService: ColorblindService
  ) {
    addIcons({ chevronBackOutline, checkmarkOutline });
    this.seleccionActual = this.colorService.obtener();
    this.intensidad = this.colorService.obtenerIntensidad();
  }

  get filtroActivo(): boolean {
    return this.seleccionActual !== 'ninguno';
  }

  /**
   * El cambio se guarda en el momento. Un filtro de color que solo se aplica
   * al pulsar "Guardar" obliga a elegir a ciegas, y sin esto la previsualización
   * no serviría de nada: no se puede saber si el filtro elegido conviene hasta
   * ver la pantalla con el filtro puesto.
   */
  seleccionar(modo: ModoDaltonismo) {
    this.seleccionActual = modo;
    this.colorService.guardar(modo);
  }

  cambiarIntensidad(valor: number) {
    this.intensidad = valor;
    this.colorService.guardarIntensidad(valor);
  }

  volver() {
    this.router.navigate(['/ajustes']);
  }
}

import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonRange,
  IonToggle
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline,
  volumeHighOutline,
  informationCircleOutline
} from 'ionicons/icons';
import { VozService } from '../../../services/voz/voz.service';

@Component({
  selector: 'app-voz',
  templateUrl: './voz.page.html',
  styleUrls: ['./voz.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonRange,
    IonToggle
  ]
})
export class VozPage implements OnInit {

  /** Se avisa cuando el sistema no deja encender, para no dejarlo mudo. */
  aviso = '';

  constructor(
    private router: Router,
    public voz: VozService
  ) {
    addIcons({ chevronBackOutline, volumeHighOutline, informationCircleOutline });
  }

  async ngOnInit() {
    await this.voz.leerInfo();
  }

  async cambiar(encendido: boolean) {
    this.aviso = '';

    const ok = await this.voz.establecer(encendido);

    // `establecer` devuelve false cuando no se pudo encender. El interruptor
    // se revierte solo en ese caso, porque decir "Activada" sin hablar sería
    // peor que no decir nada.
    if (!ok) {
      this.aviso = this.voz.info().lectorExterno
        ? 'Tu teléfono ya tiene activada la TalkBack, que lee la pantalla por ti. Usa esa y deja esta opción apagada.'
        : 'No se pudo encender la lectura en voz alta.';
    }
  }

  async velocidad(valor: number) {
    await this.voz.cambiarVelocidad(valor);
  }

  async probar() {
    await this.voz.leerPantalla();
  }

  async abrirAccesibilidad() {
    await this.voz.abrirAccesibilidad();
  }

  volver() {
    this.router.navigate(['/ajustes']);
  }
}

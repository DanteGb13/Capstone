import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  arrowForward,
  bulb,
  call,
  checkmarkCircle,
  footsteps,
  heart,
  location,
  notifications,
  people,
  play,
  refresh,
  shieldCheckmark,
  warning
} from 'ionicons/icons';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-inicio',
  templateUrl: 'inicio.page.html',
  styleUrls: ['inicio.page.scss'],
  imports: [WebNav, RouterLink, IonContent, IonIcon],
})
export class InicioPage {

  /**
   * El iframe de YouTube se crea recién cuando se toca el póster.
   *
   * Cargarlo de entrada metía en cada visita a la portada el reproductor
   * completo de YouTube (cerca de medio mega y varios cientos de
   * milisegundos) para un video que la mayoría no reproduce. La miniatura
   * es una imagen suelta: pesa poco y se ve igual.
   *
   * Va como signal porque el proyecto corre sin zone.js: un booleano suelto
   * no repintaría la vista al cambiar.
   */
  videoActivo = signal(false);

  /**
   * Miniatura del video. Si el video no tiene la de alta resolución, el
   * `error` de la imagen la cambia por la estándar para no dejar el póster
   * vacío.
   */
  miniatura = 'https://i.ytimg.com/vi/8StE-gyXxBA/maxresdefault.jpg';
  private readonly miniaturaEstandar = 'https://i.ytimg.com/vi/8StE-gyXxBA/hqdefault.jpg';

  constructor() {
    addIcons({
      arrowForward,
      bulb,
      call,
      checkmarkCircle,
      footsteps,
      heart,
      location,
      notifications,
      people,
      play,
      refresh,
      shieldCheckmark,
      warning
    });
  }

  abrirVideo(): void {
    this.videoActivo.set(true);
  }

  /** Segunda calidad de miniatura, por si la grande no existe. */
  miniaturaAlterna(): void {
    this.miniatura = this.miniaturaEstandar;
  }

  /**
   * Estado de la demostración de los dos teléfonos:
   *   · `reposo`      → todo tranquilo, se ve el botón SOS
   *   · `confirmando` → el cartel de "¿seguro que avisamos?" (como la app)
   *   · `sos`         → aviso enviado y la alerta en el otro teléfono
   *
   * Va como signal porque el proyecto corre sin zone.js.
   */
  demostracion = signal<'reposo' | 'confirmando' | 'sos'>('reposo');

  /** El adulto toca el SOS: primero se pide confirmar, no se avisa aún. */
  abrirSosDemo(): void {
    this.demostracion.set('confirmando');
  }

  /** Confirma el aviso: al cuidador le entra la alerta. */
  confirmarSosDemo(): void {
    this.demostracion.set('sos');
  }

  /** Cancela: se vuelve al estado tranquilo sin avisarle a nadie. */
  cancelarSosDemo(): void {
    this.demostracion.set('reposo');
  }

  /** Vuelve al estado tranquilo para poder probarla otra vez. */
  reiniciarDemo(): void {
    this.demostracion.set('reposo');
  }
}

import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  download,
  informationCircle,
  logoAndroid,
  notifications,
  people,
  phonePortrait,
  qrCode,
  wifi
} from 'ionicons/icons';
import * as QRCode from 'qrcode';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-descarga',
  templateUrl: 'descarga.page.html',
  styleUrls: ['descarga.page.scss'],
  imports: [WebNav, RouterLink, IonContent, IonIcon],
})
export class DescargaPage {

  /**
   * Imagen del código QR, en data URL. Va como signal porque el proyecto
   * corre sin zone.js: asignarla después de un await no repintaría la vista.
   */
  readonly qrUrl = signal('');
  constructor() {
    addIcons({
      download,
      informationCircle,
      logoAndroid,
      notifications,
      people,
      phonePortrait,
      qrCode,
      wifi
    });

    void this.generarQr();
  }

  /**
   * QR que apunta DIRECTO al APK.
   *
   * Apuntaba a esta página, pero eso obligaba a dos pasos (abrir la página y
   * después tocar el botón). Con la cámara abriendo el archivo, el celular
   * baja la app de una: la cámara manda la URL al navegador y el atributo
   * `download` del enlace hace que la guarde en Descargas en vez de
   * intentar abrirla.
   *
   * La ruta es la misma que usan los dos botones de la página, así que si un
   * día el archivo cambia de nombre se corrige en un solo lugar.
   */
  private async generarQr(): Promise<void> {
    try {
      const url = window.location.origin + '/assets/siempre-cerca.apk';
      this.qrUrl.set(await QRCode.toDataURL(url, { width: 240, margin: 2 }));
    } catch {
      // Sin QR la página se ve igual de bien: es un atajo, no el camino
      // principal, y los botones de descarga siguen ahí.
    }
  }
}

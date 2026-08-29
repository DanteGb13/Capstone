import { Component } from '@angular/core';

import {
  IonContent,
  IonButton,
  IonIcon,
  AlertController
} from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  arrowBackOutline,
  searchOutline,
  alertCircleOutline,
  callOutline,
  checkmarkCircleOutline,
  notificationsOutline,
  chevronForwardOutline,
  locationOutline
} from 'ionicons/icons';


@Component({
  selector: 'app-historial',

  templateUrl: './historial.page.html',

  styleUrls: ['./historial.page.scss'],

  imports: [
    IonContent,
    IonButton,
    IonIcon
  ]
})


export class HistorialPage {


  constructor(
    private alertController: AlertController
  ) {

    addIcons({

      arrowBackOutline,

      searchOutline,

      alertCircleOutline,

      callOutline,

      checkmarkCircleOutline,

      notificationsOutline,

      chevronForwardOutline,

      locationOutline

    });

  }


  // ==========================================
  // MOSTRAR UBICACIÓN
  // ==========================================

  async verUbicacion() {


    // Coordenadas de prueba
    // Posteriormente vendrán desde el GPS
    // y la base de datos.

    const latitud = -33.3669;

    const longitud = -70.6784;


    const alert = await this.alertController.create({

      header: 'Ubicación registrada',

      message: `
        <strong>María González</strong>
        <br><br>

        <strong>Latitud:</strong>
        ${latitud}

        <br>

        <strong>Longitud:</strong>
        ${longitud}
      `,

      buttons: [

        {
          text: 'Cerrar',

          role: 'cancel'
        },

        {

          text: 'Abrir mapa',

          handler: () => {

            this.abrirMapa(
              latitud,
              longitud
            );

          }

        }

      ]

    });


    await alert.present();

  }


  // ==========================================
  // ABRIR GOOGLE MAPS
  // ==========================================

  abrirMapa(
    latitud: number,
    longitud: number
  ) {


    const url =
      `https://www.google.com/maps?q=${latitud},${longitud}`;


    window.open(
      url,
      '_blank'
    );

  }

}
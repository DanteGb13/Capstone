import { Component } from '@angular/core';
import { IonButton } from '@ionic/angular/ion-button';
import { IonContent } from '@ionic/angular/ion-content';
import { IonIcon } from '@ionic/angular/ion-icon';
import { IonInput } from '@ionic/angular/ion-input';
import { addIcons } from 'ionicons';

import {
  arrowBackOutline,
  personOutline,
  callOutline,
  mailOutline,
  lockClosedOutline
} from 'ionicons/icons';

@Component({
  selector: 'app-registro',
  templateUrl: './registro.page.html',
  styleUrls: ['./registro.page.scss'],
  imports: [
    IonContent,
    IonButton,
    IonIcon,
    IonInput
  ]
})
export class RegistroPage {

  constructor() {

    addIcons({
      arrowBackOutline,
      personOutline,
      callOutline,
      mailOutline,
      lockClosedOutline
    });

  }

}
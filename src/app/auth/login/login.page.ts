import { Component } from '@angular/core';
import { IonButton, IonContent, IonIcon, IonInput } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { peopleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    IonContent,
    IonIcon,
    IonInput,
    IonButton
  ]
})
export class LoginPage {

  constructor() {
    addIcons({
      peopleOutline
    });
  }

}
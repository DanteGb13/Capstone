import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { IonButton, IonContent, IonHeader, IonIcon, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline, arrowBackOutline, heartOutline, homeOutline } from 'ionicons/icons';

@Component({
  selector: 'app-error',
  templateUrl: './error.page.html',
  styleUrls: ['./error.page.scss'],
  imports: [IonButton, IonContent, IonHeader, IonIcon, IonToolbar]
})
export class ErrorPage {

  constructor(private location: Location) {
    addIcons({ alertCircleOutline, arrowBackOutline, heartOutline, homeOutline });
  }

  volver(): void {
    this.location.back();
  }
}

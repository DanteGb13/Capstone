import { Component } from '@angular/core';
import { IonButton, IonContent } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-planes',
  templateUrl: 'planes.page.html',
  imports: [WebNav, RouterLink, IonContent, IonButton],
})
export class PlanesPage {}
import { Component } from '@angular/core';
import { IonButton, IonContent } from '@ionic/angular';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-descarga',
  templateUrl: 'descarga.page.html',
  imports: [WebNav, IonContent, IonButton],
})
export class DescargaPage {}
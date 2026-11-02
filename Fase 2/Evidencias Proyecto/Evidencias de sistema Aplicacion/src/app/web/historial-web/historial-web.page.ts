import { Component } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-historial-web',
  templateUrl: 'historial-web.page.html',
  styleUrls: ['historial-web.page.scss'],
  imports: [WebNav, IonContent],
})
export class HistorialWebPage {}

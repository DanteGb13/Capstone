import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent } from '@ionic/angular';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-inicio',
  templateUrl: 'inicio.page.html',
  styleUrls: ['inicio.page.scss'],
  imports: [WebNav, RouterLink, IonContent, IonButton],
})
export class InicioPage {}

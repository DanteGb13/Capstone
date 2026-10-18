import { Component } from '@angular/core';
import { IonButton, IonContent } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-panel-control',
  templateUrl: 'panel-control.page.html',
  styleUrls: ['panel-control.page.scss'],
  imports: [WebNav, RouterLink, IonContent, IonButton],
})
export class PanelControlPage {}
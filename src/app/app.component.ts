import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { Router } from '@angular/router';
import { AlarmasService } from './services/alarmas/alarmas';
import { FontSizeService } from './services/font-size/font-size';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor(
    private router: Router,
    private alarmasService: AlarmasService,
    private fontSizeService: FontSizeService
  ) {
    this.alarmasService.escucharTap(() => {
      this.router.navigate(['/recordatorios']);
    });
  }
}
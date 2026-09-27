import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { Router } from '@angular/router';
import { AlarmasService } from './services/alarmas/alarmas';
import { FontSizeService } from './services/font-size/font-size';
import { PresenciaService } from './services/Backend/presencia/presencia';
import { PushNotificationService } from './services/Backend/push-notification/push-notification';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private presenciaService = inject(PresenciaService);
  private pushService = inject(PushNotificationService);

  constructor(
    private router: Router,
    private alarmasService: AlarmasService,
    private fontSizeService: FontSizeService
  ) {
    this.alarmasService.escucharTap(() => {
      this.router.navigate(['/recordatorios']);
    });

    // Deja constancia de que la app está activa (estado "en línea" para el cuidador)
    this.presenciaService.iniciar();

    // Tocar una alerta SOS con la app cerrada tiene que confirmarse aunque
    // el panel del cuidador todavía no se haya abierto.
    this.pushService.escucharDesdeArranque();
  }
}
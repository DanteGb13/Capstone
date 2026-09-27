import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { Router } from '@angular/router';
import { AlarmasService } from './services/alarmas/alarmas';
import { FontSizeService } from './services/font-size/font-size';
import { PresenciaService } from './services/Backend/presencia/presencia';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private presenciaService = inject(PresenciaService);

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
  }
}
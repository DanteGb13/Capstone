import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-configuracion',
  templateUrl: 'configuracion.page.html',
  styleUrls: ['configuracion.page.scss'],
  imports: [WebNav, IonContent],
})
export class ConfiguracionPage implements OnInit {

  cargando = true;
  perfil: PerfilResumen | null = null;

  private cdr = inject(ChangeDetectorRef);
  private perfilCache = inject(PerfilCacheService);

  async ngOnInit() {
    this.perfil = await this.perfilCache.perfil();
    this.cargando = false;
    this.refrescar();
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

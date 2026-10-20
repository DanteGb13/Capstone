import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-mi-perfil',
  templateUrl: 'mi-perfil.page.html',
  styleUrls: ['mi-perfil.page.scss'],
  imports: [WebNav, IonContent],
})
export class MiPerfilPage implements OnInit {

  cargando = true;
  perfil: PerfilResumen | null = null;

  private cdr = inject(ChangeDetectorRef);
  private perfilCache = inject(PerfilCacheService);

  async ngOnInit() {
    this.perfil = await this.perfilCache.perfil();
    this.cargando = false;
    this.refrescar();
  }

  get direccionLegible(): string {
    const d = this.perfil?.direccion;
    if (!d) return 'Sin dirección registrada';
    return [d.calle, d.numero, d.comuna, d.region].filter(Boolean).join(', ');
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

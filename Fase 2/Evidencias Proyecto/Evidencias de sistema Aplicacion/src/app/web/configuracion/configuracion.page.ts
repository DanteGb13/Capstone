import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';
import { WebNav } from '../web-nav/web-nav';

@Component({
  selector: 'app-configuracion',
  templateUrl: 'configuracion.page.html',
  styleUrls: ['configuracion.page.scss'],
  imports: [WebNav, IonContent, IonSegment, IonSegmentButton, IonLabel],
})
export class ConfiguracionPage implements OnInit {

  /** Slide visible: la cuenta, el sistema o lo que se registra. */
  vista: 'cuenta' | 'sistema' | 'privacidad' = 'cuenta';

  cargando = true;
  perfil: PerfilResumen | null = null;

  readonly hostSupabase = this.hostDe(environment.supabaseUrl);
  readonly entorno = environment.production ? 'Producción' : 'Desarrollo';
  readonly plataforma = Capacitor.isNativePlatform() ? 'App móvil' : 'Navegador (web)';

  private cdr = inject(ChangeDetectorRef);
  private perfilCache = inject(PerfilCacheService);

  async ngOnInit() {
    this.perfil = await this.perfilCache.perfil();
    this.cargando = false;
    this.refrescar();
  }

  alCambiarVista(evento: Event) {
    const valor = (evento.target as HTMLIonSegmentElement | null)?.value;
    if (valor === 'cuenta' || valor === 'sistema' || valor === 'privacidad') {
      this.vista = valor;
    }
    this.refrescar();
  }

  private hostDe(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '—';
    }
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';
import { WebNav } from '../web-nav/web-nav';
import { SupabaseClientProvider } from '../../core/supabase-client';

interface SuscripcionAdministrada {
  id: string;
  usuario_id: string;
  nombre: string;
  correo: string;
  plan_codigo: 'mensual' | 'anual' | string;
  estado: string;
  inicia_en: string | null;
  vence_en: string | null;
  mejora_en: string | null;
  plan_anterior_codigo: string | null;
}

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
  suscripciones: SuscripcionAdministrada[] = [];
  cargandoSuscripciones = false;
  mensajeSuscripciones = '';

  readonly hostSupabase = this.hostDe(environment.supabaseUrl);
  readonly entorno = environment.production ? 'Producción' : 'Desarrollo';
  readonly plataforma = Capacitor.isNativePlatform() ? 'App móvil' : 'Navegador (web)';

  private cdr = inject(ChangeDetectorRef);
  private perfilCache = inject(PerfilCacheService);
  private clienteSupabase = inject(SupabaseClientProvider).get();

  async ngOnInit() {
    this.perfil = await this.perfilCache.perfil();
    if (this.perfil?.rol === 'Administrador') await this.cargarSuscripciones();
    this.cargando = false;
    this.refrescar();
  }

  async cargarSuscripciones(): Promise<void> {
    this.cargandoSuscripciones = true;
    this.mensajeSuscripciones = '';
    const { data, error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'listar' },
    });
    if (error) {
      this.mensajeSuscripciones = 'No se pudieron cargar las suscripciones.';
    } else {
      this.suscripciones = Array.isArray(data?.suscripciones) ? data.suscripciones : [];
    }
    this.cargandoSuscripciones = false;
    this.refrescar();
  }

  async revertirMejora(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!window.confirm(`¿Revertir la mejora de ${suscripcion.nombre || suscripcion.correo}? Se aplicará reembolso si corresponde.`)) {
      return;
    }
    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'revertir_mejora', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo revertir la mejora.';
    } else {
      this.mensajeSuscripciones = 'Mejora revertida y plan mensual restaurado.';
      await this.cargarSuscripciones();
    }
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

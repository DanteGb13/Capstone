import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { refreshOutline } from 'ionicons/icons';
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
  selector: 'app-finanzas',
  templateUrl: 'finanzas.page.html',
  styleUrls: ['finanzas.page.scss'],
  imports: [WebNav, IonContent, IonIcon, FormsModule],
})
export class FinanzasPage implements OnInit {

  busqueda = '';
  filtroEstado = '';
  suscripciones: SuscripcionAdministrada[] = [];
  cargandoSuscripciones = false;
  mensajeSuscripciones = '';

  private cdr = inject(ChangeDetectorRef);
  private clienteSupabase = inject(SupabaseClientProvider).get();

  constructor() {
    addIcons({ refreshOutline });
  }

  get suscripcionesFiltradas(): SuscripcionAdministrada[] {
    const texto = this.normalizar(this.busqueda);
    return this.suscripciones.filter(suscripcion =>
      (!texto || this.normalizar(suscripcion.nombre).includes(texto) || this.normalizar(suscripcion.correo).includes(texto))
      && (!this.filtroEstado || suscripcion.estado === this.filtroEstado));
  }

  async ngOnInit() {
    await this.cargarSuscripciones();
  }

  async cargarSuscripciones(): Promise<void> {
    this.cargandoSuscripciones = true;
    this.mensajeSuscripciones = '';
    const { data, error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'listar' },
    });
    if (error) {
      const detalle = await this.detalleError(error, data);
      this.mensajeSuscripciones = detalle
        ? `No se pudieron cargar las suscripciones. ${detalle}`
        : 'No se pudieron cargar las suscripciones.';
    } else {
      this.suscripciones = Array.isArray(data?.suscripciones) ? data.suscripciones : [];
    }
    this.cargandoSuscripciones = false;
    this.refrescar();
  }

  async activar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!window.confirm(`¿Activar la suscripción de ${suscripcion.nombre || suscripcion.correo}?`)) {
      return;
    }
    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'activar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo activar la suscripción.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  async cancelar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!window.confirm(`¿Cancelar la suscripción de ${suscripcion.nombre || suscripcion.correo}?`)) {
      return;
    }
    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'cancelar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo cancelar la suscripción.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  nombrePlan(plan: string): string {
    return plan === 'anual' ? 'Plan anual' : plan === 'mensual' ? 'Plan mensual' : plan;
  }

  textoEstado(estado: string): string {
    return estado === 'activa' ? 'Activa' : estado === 'cancelada' ? 'Cancelada' : estado;
  }

  vigencia(suscripcion: SuscripcionAdministrada): string {
    if (!suscripcion.inicia_en && !suscripcion.vence_en) return '—';
    const inicio = suscripcion.inicia_en ? this.formatearFecha(suscripcion.inicia_en) : 'Sin inicio';
    const vencimiento = suscripcion.vence_en ? this.formatearFecha(suscripcion.vence_en) : 'Sin vencimiento';
    return `${inicio} - ${vencimiento}`;
  }

  private formatearFecha(fecha: string): string {
    const valor = new Date(fecha);
    return Number.isNaN(valor.getTime()) ? '—' : valor.toLocaleDateString('es-CL');
  }

  private normalizar(texto: string): string {
    return (texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  private async detalleError(error: unknown, data: unknown): Promise<string> {
    console.error('admin-suscripciones listar:', error);
    const detalleDato = (data as { detalle?: unknown } | null)?.detalle;
    if (typeof detalleDato === 'string') return detalleDato;

    const contexto = (error as { context?: Response })?.context;
    if (contexto && typeof contexto.json === 'function') {
      try {
        const respuesta = await contexto.clone().json() as { detalle?: unknown; error?: unknown };
        if (typeof respuesta.detalle === 'string') return respuesta.detalle;
        if (typeof respuesta.error === 'string') return respuesta.error;
      } catch {
        // El servidor no devolvió JSON.
      }
    }
    return '';
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

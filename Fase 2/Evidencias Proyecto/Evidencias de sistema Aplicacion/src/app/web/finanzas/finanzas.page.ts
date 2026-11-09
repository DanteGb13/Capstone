import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { createOutline, downloadOutline } from 'ionicons/icons';
import { WebNav } from '../web-nav/web-nav';
import { SupabaseClientProvider } from '../../core/supabase-client';

interface SuscripcionAdministrada {
  /** Null cuando el cuidador todavía no tiene ninguna suscripción. */
  id: string | null;
  usuario_id: string;
  nombre: string;
  correo: string;
  plan_codigo: 'mensual' | 'anual' | string | null;
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
  /** '' = todos, 'con' = con suscripción, 'sin' = sin suscripción,
   * 'cancelada' = con la suscripción cancelada. */
  filtroSuscripcion = '';
  /** '' = todos, 'mensual' o 'anual'. */
  filtroPlan = '';
  suscripciones: SuscripcionAdministrada[] = [];
  paginaActual = 1;
  tamanoPagina = 11;
  cargandoSuscripciones = false;
  mensajeSuscripciones = '';

  private cdr = inject(ChangeDetectorRef);
  private alertCtrl = inject(AlertController);
  private clienteSupabase = inject(SupabaseClientProvider).get();

  constructor() {
    addIcons({ createOutline, downloadOutline });
  }

  get suscripcionesFiltradas(): SuscripcionAdministrada[] {
    const texto = this.normalizar(this.busqueda);
    return this.suscripciones.filter(suscripcion =>
      (!texto || this.normalizar(suscripcion.nombre).includes(texto) || this.normalizar(suscripcion.correo).includes(texto))
      && this.coincideConSuscripcion(suscripcion)
      && this.coincideConPlan(suscripcion));
  }

  get suscripcionesPagina(): SuscripcionAdministrada[] {
    const inicio = (this.paginaActual - 1) * this.tamanoPagina;
    return this.suscripcionesFiltradas.slice(inicio, inicio + this.tamanoPagina);
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.suscripcionesFiltradas.length / this.tamanoPagina));
  }

  get paginasVisibles(): number[] {
    const total = this.totalPaginas;
    const actual = this.paginaActual;

    if (total <= 7) {
      return Array.from({ length: total }, (_, indice) => indice + 1);
    }

    const paginas: number[] = [1];
    const inicio = Math.max(2, actual - 1);
    const fin = Math.min(total - 1, actual + 1);

    if (inicio > 2) paginas.push(-1);
    for (let pagina = inicio; pagina <= fin; pagina++) paginas.push(pagina);
    if (fin < total - 1) paginas.push(-1);
    paginas.push(total);

    return paginas;
  }

  get numeroPrimerCuidador(): number {
    return this.suscripcionesFiltradas.length ? (this.paginaActual - 1) * this.tamanoPagina + 1 : 0;
  }

  get numeroUltimoCuidador(): number {
    return Math.min(this.paginaActual * this.tamanoPagina, this.suscripcionesFiltradas.length);
  }

  /** Al cambiar un filtro se vuelve a la primera página: si no, se puede
   * quedar apuntando a una página que ya no existe. */
  alCambiarFiltros(): void {
    this.paginaActual = 1;
    this.refrescar();
  }

  alCambiarTamanoPagina(): void {
    this.paginaActual = 1;
    this.refrescar();
  }

  irAPagina(pagina: number): void {
    this.paginaActual = Math.max(1, Math.min(pagina, this.totalPaginas));
    this.refrescar();
  }

  /** Descarga en CSV todos los cuidadores que pasan el buscador y los filtros
   * (no sólo la página visible). */
  descargarCsv(): void {
    const filas = this.suscripcionesFiltradas;
    if (!filas.length) return;

    const contenido = [
      ['Cuidador', 'Correo', 'Plan', 'Estado', 'Inicio', 'Vencimiento'],
      ...filas.map(suscripcion => [
        suscripcion.nombre || 'Sin nombre',
        suscripcion.correo,
        this.nombrePlan(suscripcion.plan_codigo),
        this.textoEstado(suscripcion.estado),
        this.formatoCsvFecha(suscripcion.inicia_en),
        this.formatoCsvFecha(suscripcion.vence_en),
      ]),
    ]
      .map(fila => fila.map(valor => `"${String(valor).replaceAll('"', '""')}"`).join(','))
      .join('\r\n');

    const archivo = new Blob(['\ufeff', contenido], { type: 'text/csv;charset=utf-8' });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = `finanzas_suscripciones_${new Date().toISOString().slice(0, 10)}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  private coincideConSuscripcion(suscripcion: SuscripcionAdministrada): boolean {
    // Las categorías no se pisan: "Con suscripción" excluye a las canceladas
    // para que "Canceladas" muestre sólo esas y no se repitan en ambas.
    switch (this.filtroSuscripcion) {
      case 'con':
        return suscripcion.estado !== 'sin_suscripcion' && suscripcion.estado !== 'cancelada';
      case 'sin':
        return suscripcion.estado === 'sin_suscripcion';
      case 'cancelada':
        return suscripcion.estado === 'cancelada';
      default:
        return true;
    }
  }

  private coincideConPlan(suscripcion: SuscripcionAdministrada): boolean {
    return !this.filtroPlan || suscripcion.plan_codigo === this.filtroPlan;
  }

  private formatoCsvFecha(fecha: string | null): string {
    return fecha ? this.formatearFecha(fecha) : '';
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

  async abrirGestion(suscripcion: SuscripcionAdministrada): Promise<void> {
    const opciones = this.opcionesPara(suscripcion);

    const alerta = await this.alertCtrl.create({
      header: suscripcion.nombre || suscripcion.correo || 'Sin nombre',
      subHeader: this.subtituloMenu(suscripcion),
      message: this.resumenMenu(suscripcion),
      cssClass: 'finanzas-alerta',
      buttons: [
        ...opciones.map(opcion => ({
          text: opcion.texto,
          role: opcion.role,
          // 'destructive' ya se pinta sola (Ionic le pone la clase por el rol).
          cssClass: opcion.role === 'destructive' ? undefined : 'alerta-btn-accion',
        })),
        { text: 'Volver', role: 'cancel' },
      ],
    });
    await alerta.present();

    const { role } = await alerta.onDidDismiss();
    switch (role) {
      case 'activar-mensual':
        await this.activar(suscripcion, 'mensual');
        break;
      case 'activar-anual':
        await this.activar(suscripcion, 'anual');
        break;
      case 'activar':
        await this.activar(suscripcion);
        break;
      case 'destructive':
        await this.inhabilitar(suscripcion);
        break;
      case 'mejorar':
        await this.mejorar(suscripcion);
        break;
      case 'degradar':
        await this.degradar(suscripcion);
        break;
    }
  }

  /** Opciones de la mini ventana según lo que tenga el cuidador. */
  private opcionesPara(suscripcion: SuscripcionAdministrada): { texto: string; role: string }[] {
    // Sin licencia todavía: se elige el plan con el que se activa.
    if (!suscripcion.id) {
      return [
        { texto: 'Activar mensual', role: 'activar-mensual' },
        { texto: 'Activar anual', role: 'activar-anual' },
      ];
    }

    const cambiarPlan = suscripcion.plan_codigo === 'mensual'
      ? { texto: 'Mejorar a anual', role: 'mejorar' }
      : { texto: 'Degradar a mensual', role: 'degradar' };

    const estado = suscripcion.estado === 'activa'
      ? { texto: 'Inhabilitar', role: 'destructive' }
      : { texto: 'Activar', role: 'activar' };

    return [cambiarPlan, estado];
  }

  private subtituloMenu(suscripcion: SuscripcionAdministrada): string {
    const plan = suscripcion.id ? this.nombrePlan(suscripcion.plan_codigo) : 'Sin suscripción';
    return `${plan} · ${this.textoEstado(suscripcion.estado)}`;
  }

  /** Segunda línea de la ventana: qué pasa con la vigencia de la suscripción. */
  private resumenMenu(suscripcion: SuscripcionAdministrada): string {
    if (!suscripcion.id) {
      return 'Todavía no tiene licencia.\nElige el plan que quieres activar.';
    }
    if (suscripcion.estado === 'activa') {
      const vencimiento = suscripcion.vence_en ? this.formatearFecha(suscripcion.vence_en) : '';
      return vencimiento ? `Vence el ${vencimiento}.` : 'Sin fecha de vencimiento.';
    }
    return `La suscripción está ${this.textoEstado(suscripcion.estado).toLowerCase()}.\nPuedes activarla de nuevo cuando quieras.`;
  }

  async activar(suscripcion: SuscripcionAdministrada, planElegido?: string): Promise<void> {
    // Sin `id` el cuidador todavía no tiene licencia: se activa por usuario y
    // se manda el plan para que el servidor la cree.
    const esNueva = !suscripcion.id;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: esNueva
        ? { accion: 'activar', usuario_id: suscripcion.usuario_id, plan_codigo: planElegido ?? 'mensual' }
        : { accion: 'activar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = esNueva
        ? 'No se pudo activar la licencia del cuidador.'
        : 'No se pudo activar la suscripción.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  /** Deja la suscripción como cancelada (el servidor usa la acción 'cancelar'). */
  async inhabilitar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!suscripcion.id) return;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'cancelar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo inhabilitar la suscripción.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  /** Mejora la suscripción mensual activa a anual (acción sólo del panel). */
  async mejorar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!suscripcion.id) return;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'mejorar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo mejorar el plan a anual.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  /** Degrada la suscripción anual a mensual (acción sólo del panel). */
  async degradar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!suscripcion.id) return;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'degradar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo degradar el plan a mensual.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  nombrePlan(plan: string | null): string {
    if (plan === 'anual') return 'Plan anual';
    if (plan === 'mensual') return 'Plan mensual';
    return plan ?? 'Sin plan';
  }

  textoEstado(estado: string): string {
    switch (estado) {
      case 'activa': return 'Activa';
      case 'cancelada': return 'Cancelada';
      case 'vencida': return 'Vencida';
      case 'sin_suscripcion': return 'Sin suscripción';
      default: return estado;
    }
  }

  vigencia(suscripcion: SuscripcionAdministrada): string {
    // Sin plan no hay ninguna vigencia que mostrar.
    if (!suscripcion.plan_codigo) return 'No disponible';
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
   * await NO repinta la vista por sí solo, y `markForCheck` sólo la marca
   * como sucia. Hace falta forzar la pasada de detección para que el cambio
   * se vea al instante y no recién al siguiente clic.
   */
  private refrescar() {
    this.cdr.markForCheck();
    this.cdr.detectChanges();
  }
}

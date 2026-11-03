import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IonContent } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';
import { jsPDF } from 'jspdf';
import { ActivatedRoute } from '@angular/router';

interface Kpi {
  etiqueta: string;
  valor: string;
  icono: string;
  grupo?: 'comercial' | 'operativa';
  descripcion?: string;
  destacado?: boolean;
}

interface PuntoIngreso {
  fecha: string;
  valor: number;
  altura: number;
  etiqueta: string;
}

interface PuntoRetencion {
  fecha: string;
  parejas: number;
}

interface PuntoAlertas {
  fecha: string;
  sos: number;
  zona: number;
  senal: number;
}

const RANGOS = [7, 30, 90];

@Component({
  selector: 'app-panel-control',
  templateUrl: 'panel-control.page.html',
  styleUrls: ['panel-control.page.scss'],
  imports: [WebNav, DecimalPipe, IonContent],
})
export class PanelControlPage implements OnInit {

  cargando = true;
  error = '';

  kpis: Kpi[] = [];
  readonly rangos = RANGOS;
  dias = 30;
  filtroRol = '';

  totalUsuarios = 0;
  adultosMayores = 0;
  cuidadores = 0;
  otrosUsuarios = 0;
  licenciasActivas = 0;
  usuariosActivos = 0;
  adultosActivos = 0;
  cuidadoresActivos = 0;
  eventosPeriodos = 0;
  ingresos = 0;
  serieIngresos: PuntoIngreso[] = [];
  serieIngresosMensuales: PuntoIngreso[] = [];
  serieSosMensuales: PuntoIngreso[] = [];
  serieActividadDiaria: PuntoIngreso[] = [];
  mttrMinutos = 0;
  adultosOnline = 0;
  adultosSinSenal = 0;
  alertasSos = 0;
  alertasZona = 0;
  alertasSinSenal = 0;
  adultosTotales = 0;
  cuidadoresVinculados = 0;
  adultosVinculados = 0;
  invitados = 0;
  usuariosFuncionalidades = 0;
  filtroLicencia = '';
  filtroVinculacion = '';
  serieRetencion: PuntoRetencion[] = [];
  serieAlertas: PuntoAlertas[] = [];

  get porcentajeAdultosVinculados(): number {
    return this.adultosMayores > 0
      ? Math.round(this.adultosVinculados * 100 / this.adultosMayores)
      : 0;
  }

  get adultosMayoresSinCuidador(): number {
    return Math.max(this.adultosMayores - this.adultosVinculados, 0);
  }

  /** Host de Supabase, sin la URL completa: alcanza para saber a qué base
   *  apunta esta instalación. */
  readonly hostSupabase = this.hostDe(environment.supabaseUrl);
  readonly entorno = environment.production ? 'Producción' : 'Desarrollo';
  readonly plataforma = Capacitor.isNativePlatform() ? 'App móvil' : 'Navegador (web)';

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);
  private route = inject(ActivatedRoute);
  private cargaId = 0;

  async ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('volverDescargar') === '1') {
      const dias = Number(params.get('dias'));
      if ([7, 30, 90].includes(dias)) this.dias = dias;
      this.filtroRol = params.get('rol') ?? '';
      this.filtroLicencia = params.get('licencia') ?? '';
      this.filtroVinculacion = params.get('vinculacion') ?? '';
    }
    await this.cargarKpis();
    this.cargando = false;
    this.refrescar();
    if (params.get('volverDescargar') === '1') {
      setTimeout(() => void this.descargarPdf(), 300);
    }
  }

  /**
   * Contadores del panel. Todo en la base y con la sesión del admin: si la
   * lectura falla (sin migración, sin política, sin red) la tarjeta queda en
   * "—" y la grilla de accesos sigue funcionando igual.
   */
  private async cargarKpis() {
    const cargaId = ++this.cargaId;
    this.refrescar();
    try {
      const cliente = this.supabaseService.getClient();

      const { data, error } = await cliente.rpc('admin_estadisticas_panel', {
        p_dias: this.dias,
        p_rol: this.filtroRol || null,
        p_licencia: this.filtroLicencia || null,
        p_vinculacion: this.filtroVinculacion || null
      });
      if (error) throw new Error(error.message);
      if (cargaId !== this.cargaId) return;

      const panel = (data ?? {}) as any;
      this.totalUsuarios = Number(panel.total_usuarios ?? 0);
      this.adultosMayores = Number(panel.adultos_mayores ?? 0);
      this.cuidadores = Number(panel.cuidadores ?? 0);
      this.otrosUsuarios = Math.max(this.totalUsuarios - this.adultosMayores - this.cuidadores, 0);
      this.licenciasActivas = Number(panel.licencias_activas ?? 0);
      this.usuariosActivos = Number(panel.usuarios_activos ?? 0);
      this.adultosActivos = Number(panel.adultos_activos ?? 0);
      this.cuidadoresActivos = Number(panel.cuidadores_activos ?? 0);
      this.eventosPeriodos = Number(panel.eventos ?? 0);
      this.ingresos = Number(panel.ingresos ?? 0);
      this.mttrMinutos = Number(panel.mttr_minutos ?? 0);
      this.adultosOnline = Number(panel.adultos_online ?? 0);
      this.adultosSinSenal = Number(panel.adultos_sin_senal ?? 0);
      this.alertasSos = Number(panel.alertas_sos ?? 0);
      this.alertasZona = Number(panel.alertas_zona ?? 0);
      this.alertasSinSenal = Number(panel.alertas_sin_senal ?? 0);
      this.adultosTotales = Number(panel.adultos_total ?? 0);
      this.cuidadoresVinculados = Number(panel.cuidadores_vinculados ?? 0);
      this.adultosVinculados = Number(panel.adultos_vinculados ?? 0);
      this.usuariosFuncionalidades = Number(panel.uso_funcionalidades ?? 0);
      this.invitados = Number(panel.invitados ?? 0);
      this.crearSerieIngresos(Array.isArray(panel.ingresos_por_dia) ? panel.ingresos_por_dia : []);
      this.crearSerieMensual(Array.isArray(panel.ingresos_mensuales) ? panel.ingresos_mensuales : []);
      this.crearSerieSosMensual(Array.isArray(panel.alertas_sos_mensuales) ? panel.alertas_sos_mensuales : []);
      this.crearSerieActividad(Array.isArray(panel.actividad_por_dia) ? panel.actividad_por_dia : []);

      const activos = Number(panel.usuarios_activos ?? 0);
      this.kpis = [
        { icono: '$', etiqueta: 'Ingresos del periodo', valor: this.formatearDinero(this.ingresos), grupo: 'comercial', destacado: true },
        { icono: 'L', etiqueta: 'Licencias pagadas', valor: this.formatear(this.licenciasActivas), grupo: 'comercial' },
        { icono: 'U', etiqueta: 'Usuarios totales', valor: this.formatear(this.totalUsuarios), grupo: 'comercial' },
        { icono: 'AM', etiqueta: 'Adultos mayores', valor: this.formatear(this.adultosMayores), grupo: 'operativa' },
        { icono: 'C', etiqueta: 'Cuidadores', valor: this.formatear(this.cuidadores), grupo: 'operativa' },
        { icono: '✓', etiqueta: 'Usuarios activos', valor: this.formatear(activos), grupo: 'operativa' },
        {
          icono: 'F',
          etiqueta: 'Uso funciones clave',
          valor: `${this.porcentajeFuncionalidades}%`,
          grupo: 'operativa',
          descripcion: 'Acciones de SOS, avisos o recordatorios en el periodo'
        }
      ];
    } catch (e: any) {
      if (cargaId !== this.cargaId) return;
      this.error = e?.message || '';
      this.kpis = [
        { icono: '$', etiqueta: 'Ingresos del periodo', valor: '—' },
        { icono: 'U', etiqueta: 'Usuarios totales', valor: '—' },
        { icono: 'AM', etiqueta: 'Adultos mayores', valor: '—' },
        { icono: 'C', etiqueta: 'Cuidadores', valor: '—' },
        { icono: 'L', etiqueta: 'Licencias pagadas', valor: '—' },
        { icono: 'F', etiqueta: 'Uso funciones clave', valor: '—' },
        { icono: '✓', etiqueta: 'Usuarios activos', valor: '—' }
      ];
    }
    this.refrescar();
  }

  private formatear(valor: number): string {
    return new Intl.NumberFormat('es-CL').format(valor);
  }

  private formatearDinero(valor: number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(valor);
  }

  get ingresosFormateados(): string {
    return this.formatearDinero(this.ingresos);
  }

  get porcentajeLicencias(): number {
    return this.totalUsuarios ? Math.round(this.licenciasActivas * 100 / this.totalUsuarios) : 0;
  }

  get tasaConversion(): number {
    return this.porcentajeLicencias;
  }

  get porcentajeFuncionalidades(): number {
    return this.totalUsuarios ? Math.round(this.usuariosFuncionalidades * 100 / this.totalUsuarios) : 0;
  }

  get claseMttr(): string {
    if (this.mttrMinutos > 5) return 'alto';
    if (this.mttrMinutos >= 3) return 'medio';
    return 'bajo';
  }

  get porcentajeUso(): number {
    return this.totalUsuarios ? Math.min(100, Math.round(this.usuariosActivos * 100 / this.totalUsuarios)) : 0;
  }

  get anchoAdultosActivos(): number {
    const total = Math.max(this.adultosMayores, 1);
    return Math.min(100, Math.round(this.adultosActivos * 100 / total));
  }

  get anchoCuidadoresActivos(): number {
    const total = Math.max(this.cuidadores, 1);
    return Math.min(100, Math.round(this.cuidadoresActivos * 100 / total));
  }

  get donaUsuarios(): string {
    const total = this.totalUsuarios || 1;
    const adulto = this.adultosMayores * 100 / total;
    const cuidadorFin = adulto + this.cuidadoresVinculados * 100 / total;
    return `conic-gradient(#7c3aed 0 ${adulto}%, #2dd4bf ${adulto}% ${cuidadorFin}%, #e7e5eb ${cuidadorFin}% 100%)`;
  }

  private crearSerieMensual(filas: any[]) {
    const maximo = Math.max(...filas.map(fila => Number(fila.monto ?? 0)), 1);
    this.serieIngresosMensuales = filas.map(fila => {
      const partes = String(fila.mes).split('-');
      const fecha = partes.length === 2
        ? new Date(Number(partes[0]), Number(partes[1]) - 1, 1).toLocaleDateString('es-CL', { month: 'short', year: '2-digit' })
        : String(fila.mes);
      const valor = Number(fila.monto ?? 0);
      return {
        fecha,
        valor,
        altura: valor ? Math.max(valor * 100 / maximo, 8) : 3,
        etiqueta: `${this.formatearDinero(valor)} - ${fecha}`
      };
    });
  }

  private crearSerieSosMensual(filas: any[]) {
    const porMes = new Map(
      filas.map(fila => [String(fila.mes ?? ''), Number(fila.cantidad ?? 0)])
    );
    const ahora = new Date();
    const serieCompleta = [];

    for (let indice = 11; indice >= 0; indice--) {
      const fecha = new Date(ahora.getFullYear(), ahora.getMonth() - indice, 1);
      const mes = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
      serieCompleta.push({ mes, cantidad: porMes.get(mes) ?? 0 });
    }

    const maximo = Math.max(...serieCompleta.map(fila => fila.cantidad), 1);
    this.serieSosMensuales = serieCompleta.map(fila => {
      const partes = String(fila.mes ?? '').split('-');
      const fecha = partes.length === 2
        ? new Date(Number(partes[0]), Number(partes[1]) - 1, 1).toLocaleDateString('es-CL', { month: 'short' })
        : String(fila.mes ?? '');
      const valor = Number(fila.cantidad ?? 0);
      return {
        fecha,
        valor,
        altura: valor ? Math.max(valor * 82 / maximo, 12) : 4,
        etiqueta: `${valor} alertas SOS - ${fecha}`
      };
    });
  }

  private crearSerieActividad(filas: any[]) {
    const maximo = Math.max(...filas.map(fila => Number(fila.usuarios ?? 0)), 1);
    this.serieActividadDiaria = filas.map(fila => {
      const valor = Number(fila.usuarios ?? 0);
      const fecha = new Date(String(fila.fecha ?? '').slice(0, 10) + 'T12:00:00');
      const etiqueta = fecha.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
      return {
        fecha: etiqueta,
        valor,
        altura: valor ? Math.max(valor * 82 / maximo, 8) : 3,
        etiqueta: `${valor} usuarios activos - ${etiqueta}`
      };
    });
  }

  abreviar(valor: number): string {
    if (valor >= 1000000) return `${(valor / 1000000).toFixed(1)}M`;
    if (valor >= 1000) return `${Math.round(valor / 1000)}K`;
    return String(valor);
  }

  private crearSerieIngresos(filas: any[]) {
    const maximo = Math.max(...filas.map(fila => Number(fila.monto ?? 0)), 1);
    this.serieIngresos = filas.map(fila => {
      const fecha = new Date(String(fila.fecha).slice(0, 10) + 'T12:00:00');
      const valor = Number(fila.monto ?? 0);
      return {
        fecha: fecha.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }),
        valor,
        altura: valor ? Math.max(valor * 100 / maximo, 5) : 3,
        etiqueta: `${this.formatearDinero(valor)} - ${fecha.toLocaleDateString('es-CL')}`
      };
    });
  }

  alCambiarRango(evento: Event) {
    const valor = Number((evento.target as HTMLSelectElement | null)?.value);
    if (!RANGOS.includes(valor) || valor === this.dias) return;
    this.dias = valor;
    void this.cargarKpis();
    this.refrescar();
  }

  alCambiarRol(evento: Event) {
    const valor = String((evento.target as HTMLSelectElement | null)?.value ?? '');
    this.filtroRol = valor === 'adulto mayor' || valor === 'cuidador' ? valor : '';
    void this.cargarKpis();
    this.refrescar();
  }

  alCambiarLicencia(evento: Event) {
    const valor = String((evento.target as HTMLSelectElement | null)?.value ?? '');
    this.filtroLicencia = valor === 'gratis' || valor === 'premium' ? valor : '';
    void this.cargarKpis();
    this.refrescar();
  }

  alCambiarVinculacion(evento: Event) {
    const valor = String((evento.target as HTMLSelectElement | null)?.value ?? '');
    this.filtroVinculacion = valor === 'vinculados' || valor === 'sin_cuidador' ? valor : '';
    void this.cargarKpis();
    this.refrescar();
  }

  async descargarPdf() {
    const elemento = document.querySelector('.panel-page');
    if (!(elemento instanceof HTMLElement)) return;

    const { default: html2canvas } = await import('html2canvas');
    const lienzo = await html2canvas(elemento, {
      backgroundColor: '#ffffff',
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true
    });
    const imagen = lienzo.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margen = 8;
    const ancho = 210 - margen * 2;
    const alto = lienzo.height * ancho / lienzo.width;

    if (alto <= 277) {
      pdf.addImage(imagen, 'PNG', margen, margen, ancho, alto);
    } else {
      let desplazamiento = 0;
      let pagina = 0;
      while (desplazamiento < lienzo.height) {
        const canvasPagina = document.createElement('canvas');
        canvasPagina.width = lienzo.width;
        canvasPagina.height = Math.min(lienzo.height - desplazamiento, Math.round(lienzo.width * 277 / ancho));
        canvasPagina.getContext('2d')?.drawImage(
          lienzo, 0, desplazamiento, lienzo.width, canvasPagina.height,
          0, 0, lienzo.width, canvasPagina.height
        );
        if (pagina > 0) pdf.addPage();
        const altoPagina = canvasPagina.height * ancho / lienzo.width;
        pdf.addImage(canvasPagina.toDataURL('image/png'), 'PNG', margen, margen, ancho, altoPagina);
        desplazamiento += canvasPagina.height;
        pagina++;
      }
    }

    pdf.save(`panel-control-${this.dias}-dias.pdf`);
    await this.registrarDescarga('Panel de control', 8);
  }

  private async registrarDescarga(reporte: string, elementos: number) {
    await this.supabaseService.getClient().rpc('registrar_evento_seguridad', {
      p_accion: 'exportacion_reporte',
      p_tabla: 'reporte_administrativo',
      p_detalle: {
        reporte,
        tipo: 'panel',
        formato: 'pdf',
        elementos,
        dias: this.dias,
        rol: this.filtroRol,
        licencia: this.filtroLicencia,
        vinculacion: this.filtroVinculacion
      }
    });
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

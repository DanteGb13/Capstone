import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
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
  descripcion?: string;
  destacado?: boolean;
}

interface PuntoIngreso {
  fecha: string;
  valor: number;
  altura: number;
  etiqueta: string;
}

/** 0 = todos los tiempos; el resto, la ventana en días. */
const RANGOS = [0, 7, 30, 90];

@Component({
  selector: 'app-panel-control',
  templateUrl: 'panel-control.page.html',
  styleUrls: ['panel-control.page.scss'],
  imports: [WebNav, DecimalPipe, IonContent, IonIcon],
})
export class PanelControlPage implements OnInit {

  cargando = true;
  error = '';

  constructor() {
    addIcons({ closeOutline });
  }

  kpis: Kpi[] = [];
  readonly rangos = RANGOS;
  /** Por defecto, todo el historial. */
  dias = 0;
  filtroRol = '';

  totalUsuarios = 0;
  adultosMayores = 0;
  cuidadores = 0;
  licenciasActivas = 0;
  usuariosActivos = 0;
  ingresos = 0;
  serieIngresos: PuntoIngreso[] = [];
  serieIngresosMensuales: PuntoIngreso[] = [];
  serieSosMensuales: PuntoIngreso[] = [];
  serieActividadDiaria: PuntoIngreso[] = [];
  mttrMinutos = 0;
  alertasSos = 0;
  alertasZona = 0;
  alertasSinSenal = 0;
  adultosVinculados = 0;
  usuariosFuncionalidades = 0;
  filtroLicencia = '';
  filtroVinculacion = '';

  /** Adultos mayores que tienen al menos un cuidador vinculado. */
  get porcentajeAdultosVinculados(): number {
    return this.adultosMayores > 0
      ? Math.round(this.adultosVinculados * 100 / this.adultosMayores)
      : 0;
  }

  get adultosMayoresSinCuidador(): number {
    return Math.max(this.adultosMayores - this.adultosVinculados, 0);
  }

  /** Cuidadores que todavía no pagan: la oportunidad comercial más directa. */
  get cuidadoresSinLicencia(): number {
    return Math.max(this.cuidadores - this.licenciasActivas, 0);
  }

  /** Alertas que se clasifican por tipo en el ranking: SOS y de zona. */
  get alertasTotales(): number {
    return this.alertasSos + this.alertasZona;
  }

  /** Adultos y cuidadores: lo que muestra el donut, ni más ni menos. */
  get adultosYCuidadores(): number {
    return this.adultosMayores + this.cuidadores;
  }

  /** Mezcla para el donut, en dos franjas: adultos y cuidadores. */
  get mezclaUsuarios(): string {
    const total = this.adultosYCuidadores || 1;
    const adulto = this.adultosMayores * 100 / total;
    return `conic-gradient(#7c3aed 0 ${adulto}%, #2dd4bf ${adulto}% 100%)`;
  }

  /** Polilínea del uso diario, en coordenadas de un SVG de 100×40. */
  get lineaActividad(): string {
    const puntos = this.serieActividadDiaria;
    if (puntos.length < 2) return '';
    const maximo = Math.max(...puntos.map(punto => punto.valor), 1);
    return puntos.map((punto, indice) => {
      const x = indice * 100 / (puntos.length - 1);
      const y = 38 - punto.valor * 36 / maximo;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }

  /** La misma polilínea cerrada abajo, para rellenar el área bajo la curva. */
  get areaActividad(): string {
    const linea = this.lineaActividad;
    return linea ? `0,40 ${linea} 100,40` : '';
  }

  /** Sparkline de ingresos diarios, minúscula, para la tarjeta del KPI. */
  get sparklineIngresos(): string {
    const puntos = this.serieIngresos;
    if (puntos.length < 2) return '';
    const maximo = Math.max(...puntos.map(punto => punto.valor), 1);
    return puntos.map((punto, indice) => {
      const x = indice * 100 / (puntos.length - 1);
      const y = 22 - punto.valor * 20 / maximo;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }

  get primerDiaActividad(): string {
    return this.serieActividadDiaria[0]?.fecha ?? '';
  }

  get ultimoDiaActividad(): string {
    return this.serieActividadDiaria[this.serieActividadDiaria.length - 1]?.fecha ?? '';
  }

  /** ¿Hay algo que limpiar? Si no, el botón no se muestra. */
  get filtrosActivos(): boolean {
    return this.dias !== 0 || !!this.filtroRol || !!this.filtroLicencia || !!this.filtroVinculacion;
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
      if (RANGOS.includes(dias)) this.dias = dias;
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
      this.licenciasActivas = Number(panel.licencias_activas ?? 0);
      this.usuariosActivos = Number(panel.usuarios_activos ?? 0);
      this.ingresos = Number(panel.ingresos ?? 0);
      this.mttrMinutos = Number(panel.mttr_minutos ?? 0);
      this.alertasSos = Number(panel.alertas_sos ?? 0);
      this.alertasZona = Number(panel.alertas_zona ?? 0);
      this.alertasSinSenal = Number(panel.alertas_sin_senal ?? 0);
      this.adultosVinculados = Number(panel.adultos_vinculados ?? 0);
      this.usuariosFuncionalidades = Number(panel.uso_funcionalidades ?? 0);
      this.crearSerieIngresos(Array.isArray(panel.ingresos_por_dia) ? panel.ingresos_por_dia : []);
      this.crearSerieMensual(Array.isArray(panel.ingresos_mensuales) ? panel.ingresos_mensuales : []);
      this.crearSerieSosMensual(Array.isArray(panel.alertas_sos_mensuales) ? panel.alertas_sos_mensuales : []);
      this.crearSerieActividad(Array.isArray(panel.actividad_por_dia) ? panel.actividad_por_dia : []);

      const activos = Number(panel.usuarios_activos ?? 0);
      // Cuatro indicadores, no más: cada uno responde una sola pregunta y
      // el detalle está en los gráficos de abajo.
      this.kpis = [
        {
          icono: '$',
          etiqueta: 'Ingresos del periodo',
          valor: this.formatearDinero(this.ingresos),
          destacado: true
        },
        {
          icono: 'L',
          etiqueta: 'Licencias activas',
          valor: this.formatear(this.licenciasActivas),
          descripcion: `${this.porcentajeLicencias}% de conversión · ${this.formatear(this.cuidadoresSinLicencia)} cuidadores sin licencia`
        },
        {
          icono: '✓',
          etiqueta: 'Usuarios activos',
          valor: this.formatear(activos),
          descripcion: `${this.porcentajeUso}% del total usó la app`
        },
        {
          icono: 'S',
          etiqueta: 'Alertas SOS',
          valor: this.formatear(this.alertasSos)
        }
      ];
    } catch (e: any) {
      if (cargaId !== this.cargaId) return;
      this.error = e?.message || '';
      this.kpis = [
        { icono: '$', etiqueta: 'Ingresos del periodo', valor: '—', destacado: true },
        { icono: 'L', etiqueta: 'Licencias activas', valor: '—' },
        { icono: '✓', etiqueta: 'Usuarios activos', valor: '—' },
        { icono: 'S', etiqueta: 'Alertas SOS', valor: '—' }
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

  /** Semáforo de la cobertura: rojo, ámbar o verde según el umbral. */
  get claseCobertura(): string {
    if (this.porcentajeAdultosVinculados >= 80) return 'verde';
    if (this.porcentajeAdultosVinculados >= 50) return 'ambar';
    return 'rojo';
  }

  get porcentajeUso(): number {
    return this.totalUsuarios ? Math.min(100, Math.round(this.usuariosActivos * 100 / this.totalUsuarios)) : 0;
  }

  private crearSerieMensual(filas: any[]) {
    // La consulta sólo trae los meses que tuvieron pagos: sin rellenar, un mes
    // sin plata desaparecía del gráfico y parecía que el anterior era el
    // último. Se completa el año con los meses vacíos, igual que la serie de
    // alertas SOS.
    const porMes = new Map(
      filas.map(fila => [String(fila.mes ?? ''), Number(fila.monto ?? 0)])
    );
    const ahora = new Date();
    const serieCompleta = [];

    for (let indice = 11; indice >= 0; indice--) {
      const fecha = new Date(ahora.getFullYear(), ahora.getMonth() - indice, 1);
      const mes = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
      serieCompleta.push({ mes, monto: porMes.get(mes) ?? 0 });
    }

    const maximo = Math.max(...serieCompleta.map(fila => fila.monto), 1);
    this.serieIngresosMensuales = serieCompleta.map(fila => {
      const partes = String(fila.mes ?? '').split('-');
      const fecha = partes.length === 2
        ? new Date(Number(partes[0]), Number(partes[1]) - 1, 1).toLocaleDateString('es-CL', { month: 'short', year: '2-digit' })
        : String(fila.mes ?? '');
      const valor = Number(fila.monto ?? 0);
      return {
        fecha,
        valor,
        // Mes vacío: una rayita sobre la línea, para que se vea el hueco.
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

  /** Ingresos de cada día del periodo: alimenta el sparkline del KPI. */
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
    // Los valores son los nombres reales de los roles: 'Usuario' (adulto
    // mayor) y 'Familiar' (cuidador). Con etiquetas como "adulto mayor" el
    // LIKE de la consulta no coincidía con ningún rol y no filtraba nada.
    this.filtroRol = valor === 'Usuario' || valor === 'Familiar' ? valor : '';
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

  /** Vuelve todo a "todos los tiempos, sin filtrar" y recarga. */
  limpiarFiltros(): void {
    if (!this.filtrosActivos) return;
    this.dias = 0;
    this.filtroRol = '';
    this.filtroLicencia = '';
    this.filtroVinculacion = '';
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

    pdf.save(`panel-control-${this.dias === 0 ? 'todos' : this.dias + '-dias'}.pdf`);
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

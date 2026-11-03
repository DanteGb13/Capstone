import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';
import { jsPDF } from 'jspdf';
import { ActivatedRoute } from '@angular/router';

/** Rangos que ofrece el segmento de arriba. */
const RANGOS = [7, 30, 90];

/** Tope de filas que baja de la base antes de agregar en el cliente. */
const LIMITE_FILAS = 50000;
const RUTAS_REALES = new Set([
  '', 'inicio', 'planes', 'descarga', 'contactanos', 'historial-web', 'mi-plan',
  'ubicaciones', 'acceso', 'panel-control', 'analitica', 'usuarios',
  'gestion-usuarios', 'reportes', 'configuracion', 'mi-perfil',
  'cambiar-contrasena', 'home', 'cuidador', 'cuidado', 'ubicacion', 'historial',
  'adulto-cargo', 'contactos-cuidador', 'login', 'registro', 'siguiente-paso',
  'elegir-tipo', 'adulto-mayor', 'actividad-reloj', 'contacto-emergencia',
  'informacion', 'perfil', 'recordatorios', 'mi-ubicacion', 'zona-segura',
  'juegos', 'estado', 'panel-actividad', 'ajustes', 'permisos',
  'permisos-inicial', 'tamano-letra', 'filtro-color', 'voz', 'privacidad',
  'privacidad-datos', 'privacidad-terminos', 'privacidad-seguridad',
  'privacidad-estandares', 'privacidad-derechos', 'privacidad-contacto',
  'recuperar-contrasena', 'correo-contrasena'
]);

interface FilaEvento {
  ruta: string;
  usuario_id: string | null;
  plataforma: string;
  rol?: string;
}

interface RutaContada {
  ruta: string;
  vistas: number;
  proporcion: number;
}

@Component({
  selector: 'app-analitica',
  templateUrl: 'analitica.page.html',
  styleUrls: ['analitica.page.scss'],
  imports: [WebNav, IonContent],
})
export class AnaliticaPage implements OnInit {

  cargando = true;
  error = '';

  /** Días del filtro activo. Se cambia desde el segmento de abajo. */
  dias = 30;
  /** '' = todas. Se filtra en el cliente sobre lo que ya se bajó. */
  filtroPlataforma = '';
  filtroRol = '';

  readonly rangos = RANGOS;

  get etiquetaPlataforma(): string {
    return this.filtroPlataforma === 'web' ? 'Web' : this.filtroPlataforma === 'app' ? 'Aplicación' : 'Todas';
  }

  get etiquetaRol(): string {
    return this.filtroRol === 'adulto mayor'
      ? 'Adulto mayor'
      : this.filtroRol === 'cuidador' ? 'Cuidador'
      : this.filtroRol === 'familia' ? 'Familia' : 'Todos';
  }

  totalVisitas = 0;
  paginasDistintas = 0;
  usuariosActivos = 0;
  visitasWeb = 0;
  visitasApp = 0;
  ranking: RutaContada[] = [];

  /** Todas las filas del rango, para poder filtrar por plataforma sin
   *  volver a consultar. */
  private filas: FilaEvento[] = [];
  private cargaId = 0;

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);
  private route = inject(ActivatedRoute);

  @HostListener('document:click', ['$event'])
  cerrarMenusAlHacerClicFuera(evento: Event) {
    const objetivo = evento.target as HTMLElement;
    if (objetivo.closest('.analitica-filtro')) return;

    document.querySelectorAll<HTMLDetailsElement>('.analitica-filtros details[open]')
      .forEach(menu => menu.open = false);
  }

  async ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('volverDescargar') === '1') {
      const dias = Number(params.get('dias'));
      if ([7, 30, 90].includes(dias)) this.dias = dias;
      this.filtroPlataforma = params.get('plataforma') ?? '';
      this.filtroRol = params.get('rol') ?? '';
    }
    await this.cargar();
    if (params.get('volverDescargar') === '1') {
      setTimeout(() => void this.descargarPdf(), 300);
    }
  }

  private async cargar() {
    const cargaId = ++this.cargaId;
    this.cargando = true;
    this.error = '';
    this.refrescar();

    try {
      const desde = new Date(Date.now() - this.dias * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await this.supabaseService.getClient()
        .from('analitica_eventos')
        .select('ruta, usuario_id, plataforma')
        .gte('fecha', desde)
        .order('fecha', { ascending: false })
        .limit(LIMITE_FILAS);

      if (error) throw new Error(error.message);
      if (cargaId !== this.cargaId) return;

      const filas = (data ?? []) as FilaEvento[];
      const ids = [...new Set(filas.map(fila => fila.usuario_id).filter(Boolean))] as string[];
      const roles = new Map<string, string>();

      if (ids.length) {
        const { data: usuarios, error: errorUsuarios } = await this.supabaseService.getClient()
          .from('usuario')
          .select('id, rol(nombre)')
          .in('id', ids);
        if (errorUsuarios) throw new Error(errorUsuarios.message);

        for (const usuario of usuarios ?? []) {
          const datosUsuario = usuario as any;
          const rol = Array.isArray(datosUsuario.rol)
            ? datosUsuario.rol[0]?.nombre
            : datosUsuario.rol?.nombre;
          roles.set(String(datosUsuario.id), String(rol ?? '').toLowerCase().trim());
        }
      }

      this.filas = filas
        .filter(fila => {
          const ruta = this.normalizarRuta(fila.ruta);
          const primeraRuta = ruta.replace(/^\/+/, '').split('/')[0];
          return !ruta.startsWith('/panel-control')
            && !ruta.startsWith('/analitica')
            && !ruta.startsWith('/usuarios')
            && !ruta.startsWith('/gestion-usuarios')
            && !ruta.startsWith('/reportes')
            && !ruta.startsWith('/configuracion')
            && RUTAS_REALES.has(primeraRuta);
        })
        .map(fila => ({ ...fila, rol: fila.usuario_id ? roles.get(fila.usuario_id) : undefined }));
      this.agregar();

    } catch (e: any) {
      // Lo más probable es que no se haya corrido el SQL todavía, o que el
      // rol Administrador no tenga la política de lectura.
      this.error = e?.message || 'No se pudo leer la analítica.';
    } finally {
      if (cargaId !== this.cargaId) return;
      this.cargando = false;
      this.refrescar();
    }
  }

  /**
   * Recalcula los contadores con el filtro de plataforma aplicado. Sin volver
   * a la base: cambiar de filtro es instantáneo y no gasta consultas.
   */
  private agregar() {
    const filas = this.filas.filter(fila =>
      (!this.filtroPlataforma || fila.plataforma === this.filtroPlataforma) &&
      (!this.filtroRol || fila.rol === this.filtroRol)
    );

    this.totalVisitas = filas.length;
    this.visitasApp = 0;
    this.visitasWeb = 0;

    const porRuta = new Map<string, number>();
    const usuarios = new Set<string>();

    for (const fila of filas) {
      const ruta = this.normalizarRuta(fila.ruta);
      const primeraRuta = ruta.replace(/^\/+/, '').split('/')[0];
      if (!RUTAS_REALES.has(primeraRuta)) continue;
      porRuta.set(ruta, (porRuta.get(ruta) ?? 0) + 1);

      if (fila.plataforma === 'app') {
        this.visitasApp++;
      } else if (fila.plataforma === 'web') {
        this.visitasWeb++;
      }

      if (fila.usuario_id) usuarios.add(fila.usuario_id);
    }

    this.paginasDistintas = porRuta.size;
    this.usuariosActivos = usuarios.size;

    // El maximo se calcula antes de recorrer el ranking para que la barra de
    // cada fila mida contra lo más visto y no haya que ordenar dos veces.
    const maximo = Math.max(...porRuta.values(), 1);

    this.ranking = [...porRuta.entries()]
      .map(([ruta, vistas]) => ({ ruta, vistas, proporcion: vistas / maximo }))
      .sort((a, b) => b.vistas - a.vistas)
      .slice(0, 30);
  }

  alCambiarRango(evento: Event, valor: number) {
    this.cerrarMenu(evento);
    if (!RANGOS.includes(valor) || valor === this.dias) return;
    this.dias = valor;
    void this.cargar();
  }

  alCambiarPlataforma(evento: Event, valor: string) {
    this.cerrarMenu(evento);
    this.filtroPlataforma = valor === 'web' || valor === 'app' ? valor : '';
    this.agregar();
    this.refrescar();
  }

  alCambiarRol(evento: Event, valor: string) {
    this.cerrarMenu(evento);
    this.filtroRol = ['adulto mayor', 'cuidador', 'familia'].includes(valor) ? valor : '';
    this.agregar();
    this.refrescar();
  }

  private cerrarMenu(evento: Event) {
    (evento.currentTarget as HTMLElement | null)?.closest('details')?.removeAttribute('open');
  }

  alAlternarMenu(evento: Event) {
    const menu = evento.currentTarget as HTMLDetailsElement;
    if (!menu.open) return;

    menu.closest('.analitica-filtros')
      ?.querySelectorAll<HTMLDetailsElement>('details[open]')
      .forEach(otroMenu => {
        if (otroMenu !== menu) otroMenu.open = false;
      });
  }

  async descargarPdf() {
    const pdf = new jsPDF();
    const plataforma = this.filtroPlataforma === 'app'
      ? 'Aplicación'
      : this.filtroPlataforma === 'web' ? 'Web' : 'Todas';
    const rol = this.filtroRol === 'adulto mayor'
      ? 'Adulto mayor'
      : this.filtroRol === 'cuidador' ? 'Cuidador' : 'Todos';

    pdf.setFillColor(124, 58, 237);
    pdf.rect(0, 0, 210, 24, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(17);
    pdf.text('Analitica de uso - SiempreCerca', 14, 16);

    pdf.setTextColor(36, 27, 56);
    pdf.setFontSize(11);
    pdf.text(`Periodo: Ultimos ${this.dias} dias`, 14, 36);
    pdf.text(`Plataforma: ${plataforma}`, 14, 43);
    pdf.text(`Tipo de usuario: ${rol}`, 14, 50);

    pdf.setFillColor(248, 246, 252);
    pdf.roundedRect(14, 58, 182, 30, 3, 3, 'F');
    pdf.setFontSize(12);
    pdf.text(`Pantallas vistas: ${this.totalVisitas}`, 20, 70);
    pdf.text(`Paginas distintas: ${this.paginasDistintas}`, 20, 79);
    pdf.text(`Usuarios activos: ${this.usuariosActivos}`, 118, 70);

    pdf.setFontSize(13);
    pdf.text('Paginas mas usadas', 14, 104);
    let y = 114;

    for (const fila of this.ranking) {
      if (y > 270) break;
      pdf.setFontSize(10);
      pdf.setTextColor(74, 70, 82);
      pdf.text(this.rutaLegible(fila.ruta).slice(0, 48), 14, y);
      pdf.setFillColor(238, 234, 244);
      pdf.roundedRect(90, y - 3, 90, 4, 2, 2, 'F');
      pdf.setFillColor(139, 92, 246);
      pdf.roundedRect(90, y - 3, Math.max(2, 90 * fila.proporcion), 4, 2, 2, 'F');
      pdf.setTextColor(36, 27, 56);
      pdf.text(String(fila.vistas), 188, y);
      y += 9;
    }

    pdf.save(`analitica-siemprecerca-${this.dias}-dias.pdf`);
    await this.registrarDescarga('Analítica', this.totalVisitas);
  }

  private async registrarDescarga(reporte: string, elementos: number) {
    await this.supabaseService.getClient().rpc('registrar_evento_seguridad', {
      p_accion: 'exportacion_reporte',
      p_tabla: 'reporte_administrativo',
      p_detalle: {
        reporte,
        tipo: 'analitica',
        formato: 'pdf',
        elementos,
        dias: this.dias,
        plataforma: this.filtroPlataforma,
        rol: this.filtroRol
      }
    });
  }

  /**
   * Muestra la ruta sin el barra inicial y sin los parámetros: `/adulto-mayor?x=1`
   * y `/adulto-mayor` son la misma pantalla y contarlas por separado parte el
   * ranking en dos mitades falsas.
   */
  rutaLegible(ruta: string): string {
    const sinParametros = ruta.split('?')[0];
    return sinParametros.replace(/^\//, '') || 'inicio';
  }

  private normalizarRuta(ruta: string): string {
    return (ruta ?? '/')
      .split('?')[0]
      .replace(/\/+$/, '')
      || '/';
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

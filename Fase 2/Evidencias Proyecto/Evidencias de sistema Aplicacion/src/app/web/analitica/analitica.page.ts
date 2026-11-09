import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';
import { jsPDF } from 'jspdf';
import { ActivatedRoute } from '@angular/router';

/** Rangos que ofrece el filtro de periodo. */
const RANGOS = [7, 30, 90];

/** Tope de filas que baja de la base antes de agregar en el cliente. */
const LIMITE_FILAS = 50000;

/** Cuántas páginas muestra cada ranking. El resto se resume en una línea. */
const TOP_RUTAS = 10;

/**
 * Nombres legibles de las rutas. El slug crudo (`/mi-plan`, `/adulto-mayor`)
 * no le dice nada a quien mira el ranking: con el nombre se ve de qué
 * pantalla se está hablando sin tener que adivinar.
 */
const NOMBRES_RUTAS: Record<string, string> = {
  '': 'Inicio',
  'inicio': 'Inicio',
  'planes': 'Planes',
  'descarga': 'Descarga',
  'contactanos': 'Contáctanos',
  'historial-web': 'Historial (web)',
  'mi-plan': 'Mi plan',
  'ubicaciones': 'Ubicaciones',
  'acceso': 'Acceso',
  'mi-perfil': 'Mi perfil',
  'cambiar-contrasena': 'Cambiar contraseña',
  'configuracion': 'Configuración',
  'home': 'Inicio (app)',
  'cuidador': 'Panel del cuidador',
  'cuidado': 'Panel del cuidador',
  'ubicacion': 'Ubicación del adulto',
  'mi-ubicacion': 'Mi ubicación',
  'historial': 'Historial',
  'adulto-cargo': 'Adultos a cargo',
  'contactos-cuidador': 'Contactos del cuidador',
  'adulto-mayor': 'Ficha del adulto',
  'actividad-reloj': 'Actividad del reloj',
  'contacto-emergencia': 'Contacto de emergencia',
  'informacion': 'Información',
  'perfil': 'Perfil',
  'recordatorios': 'Recordatorios',
  'zona-segura': 'Zonas seguras',
  'juegos': 'Juegos',
  'estado': 'Estado',
  'panel-actividad': 'Panel de actividad',
  'ajustes': 'Ajustes',
  'permisos': 'Permisos',
  'login': 'Iniciar sesión',
  'registro': 'Registro'
};

const RUTAS_REALES = new Set([
  '', 'inicio', 'planes', 'descarga', 'contactanos', 'historial-web', 'mi-plan',
  'ubicaciones', 'acceso', 'panel-control', 'analitica', 'usuarios',
  'gestion-usuarios', 'reportes', 'finanzas', 'configuracion', 'mi-perfil',
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

/** Rutas del propio panel: se miden, pero no embarran el ranking de uso. */
const RUTAS_DEL_PANEL = [
  '/panel-control', '/analitica', '/usuarios', '/gestion-usuarios',
  '/reportes', '/finanzas', '/configuracion'
];

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
  imports: [WebNav, IonContent, IonIcon],
})
export class AnaliticaPage implements OnInit {

  cargando = true;
  error = '';

  constructor() {
    addIcons({ closeOutline });
  }

  /** Días del filtro activo. */
  dias = 30;
  /** '' = todas, 'registrada' = con cuenta, 'anonima' = sin cuenta. */
  filtroSesion = '';
  filtroRol = '';

  readonly rangos = RANGOS;

  totalVisitas = 0;
  paginasDistintas = 0;
  usuariosActivos = 0;
  visitasWeb = 0;
  visitasApp = 0;
  /** Cuántas filas son de visitantes sin cuenta: la otra mitad de la
   *  pregunta, porque /inicio, /planes y /descarga son sobre todo anónimas. */
  visitasAnonimas = 0;

  /** Un ranking por plataforma: mezclarlos en una lista era ilegible. */
  rankingWeb: RutaContada[] = [];
  rankingApp: RutaContada[] = [];
  restantesWeb = 0;
  restantesApp = 0;

  /** Todas las filas del rango, para poder filtrar sin volver a consultar. */
  private filas: FilaEvento[] = [];
  private cargaId = 0;

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);
  private route = inject(ActivatedRoute);

  get etiquetaSesion(): string {
    return this.filtroSesion === 'registrada'
      ? 'Con sesión'
      : this.filtroSesion === 'anonima' ? 'Sin cuenta' : 'Todas';
  }

  get etiquetaRol(): string {
    return this.filtroRol === 'Usuario'
      ? 'Adulto mayor'
      : this.filtroRol === 'Familiar' ? 'Cuidador' : 'Todos';
  }

  /** ¿Hay algo que limpiar? Si no, el botón no se muestra. */
  get filtrosActivos(): boolean {
    return this.dias !== 30 || !!this.filtroSesion || !!this.filtroRol;
  }

  async ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('volverDescargar') === '1') {
      const dias = Number(params.get('dias'));
      if (RANGOS.includes(dias)) this.dias = dias;
      const sesion = params.get('sesion') ?? '';
      this.filtroSesion = sesion === 'registrada' || sesion === 'anonima' ? sesion : '';
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
          roles.set(String(datosUsuario.id), String(rol ?? '').trim());
        }
      }

      this.filas = filas
        .filter(fila => {
          const ruta = this.normalizarRuta(fila.ruta);
          const primeraRuta = ruta.replace(/^\/+/, '').split('/')[0];
          return !RUTAS_DEL_PANEL.some(delPanel => ruta.startsWith(delPanel))
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
   * Recalcula los contadores con los filtros aplicados. Sin volver a la base:
   * cambiar de filtro es instantáneo y no gasta consultas.
   */
  private agregar() {
    const filas = this.filas.filter(fila =>
      (!this.filtroSesion
        || (this.filtroSesion === 'registrada' && !!fila.usuario_id)
        || (this.filtroSesion === 'anonima' && !fila.usuario_id))
      && (!this.filtroRol || fila.rol === this.filtroRol)
    );

    this.totalVisitas = filas.length;

    const porRutaWeb = new Map<string, number>();
    const porRutaApp = new Map<string, number>();
    const usuarios = new Set<string>();
    let visitasWeb = 0;
    let visitasApp = 0;
    let visitasAnonimas = 0;

    for (const fila of filas) {
      const ruta = this.normalizarRuta(fila.ruta);
      const primeraRuta = ruta.replace(/^\/+/, '').split('/')[0];
      if (!RUTAS_REALES.has(primeraRuta)) continue;

      if (fila.plataforma === 'app') {
        porRutaApp.set(ruta, (porRutaApp.get(ruta) ?? 0) + 1);
        visitasApp++;
      } else if (fila.plataforma === 'web') {
        porRutaWeb.set(ruta, (porRutaWeb.get(ruta) ?? 0) + 1);
        visitasWeb++;
      }

      if (fila.usuario_id) usuarios.add(fila.usuario_id);
      else visitasAnonimas++;
    }

    this.visitasWeb = visitasWeb;
    this.visitasApp = visitasApp;
    this.visitasAnonimas = visitasAnonimas;
    this.paginasDistintas = porRutaWeb.size + porRutaApp.size;
    this.usuariosActivos = usuarios.size;

    const web = this.armarRanking(porRutaWeb);
    const app = this.armarRanking(porRutaApp);

    this.rankingWeb = web.filas;
    this.restantesWeb = web.restantes;
    this.rankingApp = app.filas;
    this.restantesApp = app.restantes;
  }

  /**
   * Ranking de una plataforma: las más vistas arriba, la barra de cada una
   * medida contra la más vista de su propio grupo (no contra la otra
   * plataforma, que haría que todas se vean chicas).
   */
  private armarRanking(porRuta: Map<string, number>): { filas: RutaContada[]; restantes: number } {
    const maximo = Math.max(...porRuta.values(), 1);
    const ordenadas = [...porRuta.entries()]
      .map(([ruta, vistas]) => ({ ruta, vistas, proporcion: vistas / maximo }))
      .sort((a, b) => b.vistas - a.vistas);

    return {
      filas: ordenadas.slice(0, TOP_RUTAS),
      restantes: Math.max(ordenadas.length - TOP_RUTAS, 0)
    };
  }

  alCambiarRango(evento: Event) {
    const valor = Number((evento.target as HTMLSelectElement | null)?.value);
    if (!RANGOS.includes(valor) || valor === this.dias) return;
    this.dias = valor;
    void this.cargar();
    this.refrescar();
  }

  alCambiarSesion(evento: Event) {
    const valor = String((evento.target as HTMLSelectElement | null)?.value ?? '');
    this.filtroSesion = valor === 'registrada' || valor === 'anonima' ? valor : '';
    this.agregar();
    this.refrescar();
  }

  alCambiarRol(evento: Event) {
    const valor = String((evento.target as HTMLSelectElement | null)?.value ?? '');
    // Valores reales de rol: 'Usuario' (adulto mayor) y 'Familiar'
    // (cuidador). Con etiquetas como "adulto mayor" no coincidía con ningún
    // rol y el filtro no hacía nada.
    this.filtroRol = valor === 'Usuario' || valor === 'Familiar' ? valor : '';
    this.agregar();
    this.refrescar();
  }

  /** Vuelve a 30 días y sin filtrar. */
  limpiarFiltros(): void {
    if (!this.filtrosActivos) return;
    this.dias = 30;
    this.filtroSesion = '';
    this.filtroRol = '';
    void this.cargar();
    this.refrescar();
  }

  async descargarPdf() {
    const sesion = this.etiquetaSesion;
    const rol = this.etiquetaRol;

    const pdf = new jsPDF();

    pdf.setFillColor(124, 58, 237);
    pdf.rect(0, 0, 210, 24, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(17);
    pdf.text('Analitica de uso - SiempreCerca', 14, 16);

    pdf.setTextColor(36, 27, 56);
    pdf.setFontSize(11);
    pdf.text(`Periodo: Ultimos ${this.dias} dias`, 14, 36);
    pdf.text(`Sesion: ${sesion}`, 14, 43);
    pdf.text(`Tipo de usuario: ${rol}`, 14, 50);

    pdf.setFillColor(248, 246, 252);
    pdf.roundedRect(14, 58, 182, 30, 3, 3, 'F');
    pdf.setFontSize(12);
    pdf.text(`Pantallas vistas: ${this.totalVisitas}`, 20, 70);
    pdf.text(`Paginas distintas: ${this.paginasDistintas}`, 20, 79);
    pdf.text(`Usuarios activos: ${this.usuariosActivos}`, 118, 70);
    pdf.text(`Visitas anonimas: ${this.visitasAnonimas}`, 118, 79);

    let y = 100;
    const bloques: Array<{ titulo: string; filas: RutaContada[]; color: [number, number, number] }> = [
      { titulo: 'Paginas mas usadas - Web', filas: this.rankingWeb, color: [139, 92, 246] },
      { titulo: 'Paginas mas usadas - Aplicacion', filas: this.rankingApp, color: [14, 165, 233] }
    ];

    for (const bloque of bloques) {
      if (!bloque.filas.length) continue;
      if (y > 250) break;

      pdf.setFontSize(13);
      pdf.setTextColor(36, 27, 56);
      pdf.text(bloque.titulo, 14, y);
      y += 8;

      for (const fila of bloque.filas) {
        if (y > 272) break;
        pdf.setFontSize(10);
        pdf.setTextColor(74, 70, 82);
        pdf.text(this.nombreLegible(fila.ruta).slice(0, 44), 14, y);
        pdf.setFillColor(238, 234, 244);
        pdf.roundedRect(92, y - 3, 86, 4, 2, 2, 'F');
        pdf.setFillColor(...bloque.color);
        pdf.roundedRect(92, y - 3, Math.max(2, 86 * fila.proporcion), 4, 2, 2, 'F');
        pdf.setTextColor(36, 27, 56);
        pdf.text(String(fila.vistas), 186, y);
        y += 8;
      }
      y += 6;
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
        sesion: this.filtroSesion,
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

  /** Nombre de pantalla para el ranking, con el slug como respaldo. */
  nombreLegible(ruta: string): string {
    const slug = this.rutaLegible(ruta);
    return NOMBRES_RUTAS[slug] ?? slug;
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
    this.cdr.detectChanges();
  }
}

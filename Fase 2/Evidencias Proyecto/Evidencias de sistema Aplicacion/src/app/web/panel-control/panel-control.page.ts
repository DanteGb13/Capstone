import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

/**
 * Accesos directos del panel. Se guardan como constante porque el orden es
 * el de importancia: lo que más se usa va arriba.
 */
const SECCIONES = [
  {
    ruta: '/analitica',
    titulo: 'Analítica',
    detalle: 'Qué pantallas se usan más y desde dónde.'
  },
  {
    ruta: '/usuarios',
    titulo: 'Usuarios',
    detalle: 'Quién tiene cuenta y cuándo fue la última vez que entró.'
  },
  {
    ruta: '/gestion-usuarios',
    titulo: 'Gestión de usuarios',
    detalle: 'Cambiar rol, activar o desactivar cuentas y ver su actividad.'
  },
  {
    ruta: '/reportes',
    titulo: 'Reportes',
    detalle: 'Exporta los datos de uso a un archivo CSV.'
  },
  {
    ruta: '/configuracion',
    titulo: 'Configuración',
    detalle: 'Cuenta de administración y qué datos se registran.'
  }
];

/** Días que cubren los contadores de arriba. */
const DIAS = 30;

interface Kpi {
  etiqueta: string;
  valor: string;
}

@Component({
  selector: 'app-panel-control',
  templateUrl: 'panel-control.page.html',
  styleUrls: ['panel-control.page.scss'],
  imports: [WebNav, RouterLink, IonContent, IonSegment, IonSegmentButton, IonLabel],
})
export class PanelControlPage implements OnInit {

  /** Slide visible: el resumen con números o la grilla de accesos. */
  vista: 'resumen' | 'accesos' = 'resumen';

  cargando = true;
  error = '';

  kpis: Kpi[] = [];

  /** Host de Supabase, sin la URL completa: alcanza para saber a qué base
   *  apunta esta instalación. */
  readonly hostSupabase = this.hostDe(environment.supabaseUrl);
  readonly entorno = environment.production ? 'Producción' : 'Desarrollo';
  readonly plataforma = Capacitor.isNativePlatform() ? 'App móvil' : 'Navegador (web)';

  readonly secciones = SECCIONES;

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);

  async ngOnInit() {
    await this.cargarKpis();
    this.cargando = false;
    this.refrescar();
  }

  /**
   * Contadores del panel. Todo en la base y con la sesión del admin: si la
   * lectura falla (sin migración, sin política, sin red) la tarjeta queda en
   * "—" y la grilla de accesos sigue funcionando igual.
   */
  private async cargarKpis() {
    try {
      const cliente = this.supabaseService.getClient();

      const [totales, activos, eventos] = await Promise.all([
        this.contar(cliente.from('usuario').select('id', { count: 'exact', head: true })),
        this.contar(cliente.from('usuario').select('id', { count: 'exact', head: true }).eq('estado', true)),
        this.contar(
          cliente
            .from('analitica_eventos')
            .select('id', { count: 'exact', head: true })
            .gte('fecha', new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString())
        )
      ]);

      this.kpis = [
        { etiqueta: 'Cuentas', valor: this.formatear(totales) },
        { etiqueta: 'Cuentas activas', valor: this.formatear(activos) },
        { etiqueta: `Eventos (${DIAS} días)`, valor: this.formatear(eventos) }
      ];
    } catch (e: any) {
      this.error = e?.message || '';
      this.kpis = [
        { etiqueta: 'Cuentas', valor: '—' },
        { etiqueta: 'Cuentas activas', valor: '—' },
        { etiqueta: `Eventos (${DIAS} días)`, valor: '—' }
      ];
    }
  }

  private async contar(consulta: any): Promise<number> {
    const { count, error } = await consulta;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  private formatear(valor: number): string {
    return new Intl.NumberFormat('es-CL').format(valor);
  }

  private hostDe(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '—';
    }
  }

  alCambiarVista(evento: Event) {
    const valor = (evento.target as HTMLIonSegmentElement | null)?.value;
    if (valor === 'resumen' || valor === 'accesos') this.vista = valor;
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

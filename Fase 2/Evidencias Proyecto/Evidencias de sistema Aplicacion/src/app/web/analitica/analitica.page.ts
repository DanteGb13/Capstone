import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

/** Rangos que ofrece el segmento de arriba. */
const RANGOS = [7, 30, 90];

/** Tope de filas que baja de la base antes de agregar en el cliente. */
const LIMITE_FILAS = 50000;

interface FilaEvento {
  ruta: string;
  usuario_id: string | null;
  plataforma: string;
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
  imports: [WebNav, IonContent, IonSegment, IonSegmentButton, IonLabel],
})
export class AnaliticaPage implements OnInit {

  cargando = true;
  error = '';

  /** Días del filtro activo. Se cambia desde el segmento de abajo. */
  dias = 30;
  /** '' = todas. Se filtra en el cliente sobre lo que ya se bajó. */
  filtroPlataforma = '';

  readonly rangos = RANGOS;

  totalVisitas = 0;
  paginasDistintas = 0;
  usuariosActivos = 0;
  visitasWeb = 0;
  visitasApp = 0;
  ranking: RutaContada[] = [];

  /** Todas las filas del rango, para poder filtrar por plataforma sin
   *  volver a consultar. */
  private filas: FilaEvento[] = [];

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando = true;
    this.error = '';
    this.refrescar();

    try {
      const desde = new Date(Date.now() - this.dias * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await this.supabaseService.getClient()
        .from('analitica_eventos')
        .select('ruta, usuario_id, plataforma')
        .gte('fecha', desde)
        .limit(LIMITE_FILAS);

      if (error) throw new Error(error.message);

      this.filas = (data ?? []) as FilaEvento[];
      this.agregar();

    } catch (e: any) {
      // Lo más probable es que no se haya corrido el SQL todavía, o que el
      // rol Administrador no tenga la política de lectura.
      this.error = e?.message || 'No se pudo leer la analítica.';
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

  /**
   * Recalcula los contadores con el filtro de plataforma aplicado. Sin volver
   * a la base: cambiar de filtro es instantáneo y no gasta consultas.
   */
  private agregar() {
    const filas = this.filtroPlataforma
      ? this.filas.filter((f) => f.plataforma === this.filtroPlataforma)
      : this.filas;

    this.totalVisitas = filas.length;
    this.visitasApp = 0;
    this.visitasWeb = 0;

    const porRuta = new Map<string, number>();
    const usuarios = new Set<string>();

    for (const fila of filas) {
      porRuta.set(fila.ruta, (porRuta.get(fila.ruta) ?? 0) + 1);

      if (fila.plataforma === 'app') {
        this.visitasApp++;
      } else {
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
      .slice(0, 15);
  }

  alCambiarRango(evento: Event) {
    const valor = Number((evento.target as HTMLIonSegmentElement | null)?.value);
    if (!RANGOS.includes(valor) || valor === this.dias) return;
    this.dias = valor;
    void this.cargar();
  }

  alCambiarPlataforma(evento: Event) {
    const valor = (evento.target as HTMLIonSegmentElement | null)?.value ?? '';
    this.filtroPlataforma = valor === 'web' || valor === 'app' ? valor : '';
    this.agregar();
    this.refrescar();
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

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

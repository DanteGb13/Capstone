import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

interface DescargaRegistro {
  id: number;
  fecha: string;
  usuario_id: string | null;
  detalle: { reporte?: string; formato?: string; elementos?: number; tipo?: string } | null;
}

interface DescargaVista {
  id: number;
  reporte: string;
  administrador: string;
  fecha: string;
  formato: string;
  elementos: number;
  tipo: string;
  detalle: DescargaRegistro['detalle'];
}

@Component({
  selector: 'app-reportes',
  templateUrl: 'reportes.page.html',
  styleUrls: ['reportes.page.scss'],
  imports: [WebNav, IonContent, FormsModule],
})
export class ReportesPage implements OnInit {
  cargando = true;
  error = '';
  descargas: DescargaVista[] = [];
  fechaDesde = '';
  fechaHasta = '';
  filtroReporte = '';
  filtroFormato = '';
  filaActual = 1;
  filasPorPagina = 10;
  canalDescargas: ReturnType<ReturnType<SupabaseService['getClient']>['channel']> | null = null;

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);

  async ngOnInit() {
    await this.cargar();
    this.canalDescargas = this.supabaseService.getClient()
      .channel('reportes-descargas')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'seguridad_auditoria', filter: 'accion=eq.exportacion_reporte' },
        () => void this.cargar())
      .subscribe();
  }

  get descargasFiltradas(): DescargaVista[] {
    return this.descargas.filter(descarga =>
      (!this.filtroReporte || descarga.tipo === this.filtroReporte) &&
      (!this.filtroFormato || descarga.formato === this.filtroFormato) &&
      (!this.fechaDesde || descarga.fecha.slice(0, 10) >= this.fechaDesde) &&
      (!this.fechaHasta || descarga.fecha.slice(0, 10) <= this.fechaHasta)
    );
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.descargasFiltradas.length / this.filasPorPagina));
  }

  get numeroPrimerRegistro(): number {
    return this.descargasFiltradas.length ? (this.filaActual - 1) * this.filasPorPagina + 1 : 0;
  }

  get numeroUltimoRegistro(): number {
    return Math.min(this.filaActual * this.filasPorPagina, this.descargasFiltradas.length);
  }

  get descargasPagina(): DescargaVista[] {
    const inicio = (this.filaActual - 1) * this.filasPorPagina;
    return this.descargasFiltradas.slice(inicio, inicio + this.filasPorPagina);
  }

  alCambiarFiltros() {
    this.filaActual = 1;
    this.refrescar();
  }

  cambiarPagina(pagina: number) {
    this.filaActual = Math.max(1, Math.min(pagina, this.totalPaginas));
    this.refrescar();
  }

  volverADescargar(descarga: DescargaVista) {
    const filtros = descarga.detalle ?? {};
    const ruta = descarga.tipo === 'panel' ? '/panel-control'
      : descarga.tipo === 'analitica' ? '/analitica' : '/usuarios';
    void this.router.navigate([ruta], {
      queryParams: { volverDescargar: '1', ...filtros }
    });
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    this.refrescar();
    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('seguridad_auditoria')
        .select('id, fecha, usuario_id, detalle')
        .eq('accion', 'exportacion_reporte')
        .order('fecha', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);

      const registros = (data ?? []) as DescargaRegistro[];
      const ids = [...new Set(registros.map(registro => registro.usuario_id).filter(Boolean))] as string[];
      const nombres = new Map<string, string>();
      if (ids.length) {
        const { data: usuarios } = await this.supabaseService.getClient()
          .from('usuario')
          .select('id, nombre, apellidopa, apellidoma')
          .in('id', ids);
        for (const usuario of usuarios ?? []) {
          const dato = usuario as any;
          nombres.set(dato.id, [dato.nombre, dato.apellidopa, dato.apellidoma].filter(Boolean).join(' ').trim());
        }
      }

      this.descargas = registros.map(registro => ({
        id: registro.id,
        reporte: registro.detalle?.reporte ?? this.nombreReporte(registro.detalle?.tipo),
        administrador: nombres.get(registro.usuario_id ?? '') || 'Administrador',
        fecha: registro.fecha,
        formato: (registro.detalle?.formato ?? 'PDF').toUpperCase(),
        elementos: Number(registro.detalle?.elementos ?? 0),
        tipo: registro.detalle?.tipo ?? '',
        detalle: registro.detalle
      }));
      this.filaActual = Math.min(this.filaActual, this.totalPaginas);
    } catch (e: any) {
      this.error = e?.message || 'No se pudieron cargar las descargas.';
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

  formatearFecha(fecha: string): string {
    return new Date(fecha).toLocaleString('es-CL', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  private nombreReporte(tipo?: string): string {
    if (tipo === 'panel') return 'Panel de control';
    if (tipo === 'analitica') return 'Analítica';
    if (tipo === 'usuarios') return 'Usuarios';
    return 'Reporte';
  }

  private normalizar(valor: string): string {
    return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

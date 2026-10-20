import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

/** Días que exporta el reporte. */
const DIAS = 30;

interface FilaEvento {
  ruta: string;
  evento: string;
  plataforma: string;
  fecha: string;
  usuario_id: string | null;
}

@Component({
  selector: 'app-reportes',
  templateUrl: 'reportes.page.html',
  styleUrls: ['reportes.page.scss'],
  imports: [WebNav, IonContent],
})
export class ReportesPage {

  exportando = false;
  mensaje = '';

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);

  async exportarEventos() {
    if (this.exportando) return;

    this.exportando = true;
    this.mensaje = '';
    this.refrescar();

    try {
      const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await this.supabaseService.getClient()
        .from('analitica_eventos')
        .select('fecha, ruta, evento, plataforma, usuario_id')
        .gte('fecha', desde)
        .order('fecha', { ascending: false })
        .limit(50000);

      if (error) throw new Error(error.message);

      const filas = (data ?? []) as FilaEvento[];

      if (!filas.length) {
        this.mensaje = 'No hay eventos en los últimos 30 días.';
        return;
      }

      // Los valores van entre comillas y las comillas dobles internas se
      // duplican: es la única regla del formato CSV y sin ella una ruta con
      // coma o un nombre con acento rompe todas las columnas de la planilla.
      const escapar = (valor: string) => `"${(valor ?? '').replace(/"/g, '""')}"`;

      const encabezado = 'fecha,ruta,evento,plataforma,usuario_id';
      const cuerpo = filas.map((fila) => [
        escapar(fila.fecha),
        escapar(fila.ruta),
        escapar(fila.evento),
        escapar(fila.plataforma),
        escapar(fila.usuario_id ?? '')
      ].join(','));

      const contenido = [encabezado, ...cuerpo].join('\n');

      // BOM UTF-8: sin él, Excel abre el CSV con los acentos rotos
      // ("Paginas", "Analitica") porque asume ASCII. Va como \uFEFF y no como
      // el carácter pegado: en el archivo se ve igual que un espacio.
      const blob = new Blob(['\uFEFF' + contenido], { type: 'text/csv;charset=utf-8;' });

      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `reporte-analitica-${new Date().toISOString().slice(0, 10)}.csv`;
      enlace.click();
      URL.revokeObjectURL(url);

      this.mensaje = `Se exportaron ${filas.length} eventos.`;
    } catch (e: any) {
      this.mensaje = e?.message || 'No se pudo exportar el reporte.';
    } finally {
      this.exportando = false;
      this.refrescar();
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

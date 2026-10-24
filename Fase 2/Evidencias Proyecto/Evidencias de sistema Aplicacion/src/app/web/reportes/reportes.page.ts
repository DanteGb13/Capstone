import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { IonContent, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

/** Rangos que ofrece el segmento de arriba. */
const RANGOS = [7, 30, 90];

/** Qué se exporta. El botón de abajo manda según esto. */
export type TipoReporte = 'uso' | 'cuentas';

interface FilaEvento {
  ruta: string;
  evento: string;
  plataforma: string;
  fecha: string;
  usuario_id: string | null;
}

interface FilaCuenta {
  nombre: string;
  apellidopa: string;
  apellidoma: string;
  correo: string;
  telefono: string;
  estado: boolean | null;
  ultimo_visto: string | null;
  fecha_nacimiento: string | null;
  rol: { nombre: string } | { nombre: string }[] | null;
}

@Component({
  selector: 'app-reportes',
  templateUrl: 'reportes.page.html',
  styleUrls: ['reportes.page.scss'],
  imports: [WebNav, IonContent, IonSegment, IonSegmentButton, IonLabel],
})
export class ReportesPage {

  /** Días del rango activo; se cambia desde el primer segmento. */
  dias = 30;
  /** Qué reporte genera el botón; segundo segmento. */
  reporte: TipoReporte = 'uso';

  readonly rangos = RANGOS;

  exportando = false;
  mensaje = '';

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);

  alCambiarRango(evento: Event) {
    const valor = Number((evento.target as HTMLIonSegmentElement | null)?.value);
    if (!RANGOS.includes(valor)) return;
    this.dias = valor;
    this.mensaje = '';
    this.refrescar();
  }

  alCambiarReporte(evento: Event) {
    const valor = (evento.target as HTMLIonSegmentElement | null)?.value;
    if (valor !== 'uso' && valor !== 'cuentas') return;
    this.reporte = valor;
    this.mensaje = '';
    this.refrescar();
  }

  async exportar() {
    if (this.reporte === 'cuentas') {
      await this.exportarCuentas();
    } else {
      await this.exportarEventos();
    }
  }

  // ---------------------------------------------------------------
  // Reporte de uso (analítica)
  // ---------------------------------------------------------------

  private async exportarEventos() {
    if (this.exportando) return;

    this.exportando = true;
    this.mensaje = '';
    this.refrescar();

    try {
      const desde = new Date(Date.now() - this.dias * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await this.supabaseService.getClient()
        .from('analitica_eventos')
        .select('fecha, ruta, evento, plataforma, usuario_id')
        .gte('fecha', desde)
        .order('fecha', { ascending: false })
        .limit(50000);

      if (error) throw new Error(error.message);

      const filas = (data ?? []) as FilaEvento[];

      if (!filas.length) {
        this.mensaje = `No hay eventos en los últimos ${this.dias} días.`;
        return;
      }

      this.bajarCsv(
        'reporte-uso',
        ['fecha', 'ruta', 'evento', 'plataforma', 'usuario_id'],
        filas.map((fila) => [
          fila.fecha,
          fila.ruta,
          fila.evento,
          fila.plataforma,
          fila.usuario_id ?? ''
        ])
      );

      this.mensaje = `Se exportaron ${filas.length} eventos.`;
      await this.registrarExportacion('uso', filas.length);
    } catch (e: any) {
      this.mensaje = e?.message || 'No se pudo exportar el reporte.';
    } finally {
      this.exportando = false;
      this.refrescar();
    }
  }

  // ---------------------------------------------------------------
  // Reporte de cuentas (quién tiene cuenta y cuándo entró)
  // ---------------------------------------------------------------

  private async exportarCuentas() {
    if (this.exportando) return;

    this.exportando = true;
    this.mensaje = '';
    this.refrescar();

    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('usuario')
        .select('nombre, apellidopa, apellidoma, correo, telefono, estado, ultimo_visto, fecha_nacimiento, rol(nombre)')
        .order('nombre');

      if (error) throw new Error(error.message);

      const filas = ((data ?? []) as FilaCuenta[]).map((fila) => {
        const rolData = fila.rol as any;
        const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;
        return {
          nombre: [fila.nombre, fila.apellidopa, fila.apellidoma].filter(Boolean).join(' ').trim(),
          correo: fila.correo ?? '',
          telefono: fila.telefono ?? '',
          rol: rol ?? '',
          estado: fila.estado !== false ? 'Activa' : 'Desactivada',
          ultimo_visto: fila.ultimo_visto ?? '',
          fecha_nacimiento: fila.fecha_nacimiento ?? ''
        };
      });

      if (!filas.length) {
        this.mensaje = 'No hay cuentas registradas.';
        return;
      }

      this.bajarCsv(
        'reporte-cuentas',
        ['nombre', 'correo', 'telefono', 'rol', 'estado', 'ultimo_visto', 'fecha_nacimiento'],
        filas.map((fila) => [
          fila.nombre,
          fila.correo,
          fila.telefono,
          fila.rol,
          fila.estado,
          fila.ultimo_visto,
          fila.fecha_nacimiento
        ])
      );

      this.mensaje = `Se exportaron ${filas.length} cuentas.`;
      await this.registrarExportacion('cuentas', filas.length);
    } catch (e: any) {
      this.mensaje = e?.message || 'No se pudo exportar el reporte.';
    } finally {
      this.exportando = false;
      this.refrescar();
    }
  }

  // ---------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------

  /**
   * Arma el CSV y lo descarga.
   *
   * Los valores van entre comillas y las comillas dobles internas se
   * duplican: es la única regla del formato CSV y sin ella una ruta con
   * coma o un nombre con acento rompe todas las columnas de la planilla.
   */
  private bajarCsv(
    nombreBase: string,
    encabezado: string[],
    cuerpo: string[][],
  ): void {
    const escapar = (valor: string) => `"${(valor ?? '').replace(/"/g, '""')}"`;

    const contenido = [
      encabezado.join(','),
      ...cuerpo.map((fila) => fila.map(escapar).join(','))
    ].join('\n');

    // BOM UTF-8: sin él, Excel abre el CSV con los acentos rotos
    // ("Paginas", "Analitica") porque asume ASCII. Va como \uFEFF y no como
    // el carácter pegado: en el archivo se ve igual que un espacio.
    const blob = new Blob(['\uFEFF' + contenido], { type: 'text/csv;charset=utf-8;' });

    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `${nombreBase}-${new Date().toISOString().slice(0, 10)}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Deja el hecho de haber exportado registrado en la bitácora de seguridad.
   *
   * Va en un try aparte y a propósito no interrumpe nada: si la migración de
   * la bitácora no está aplicada o no hay sesión válida, la descarga ya se hizo
   * y avisarle al admin que "falló el reporte" sería peor que no registrarlo.
   */
  private async registrarExportacion(tipo: TipoReporte, filas: number) {
    try {
      await this.supabaseService.getClient().rpc('registrar_evento_seguridad', {
        p_accion: 'exportacion_reporte',
        p_tabla: tipo === 'cuentas' ? 'usuario' : 'analitica_eventos',
        p_detalle: { tipo, rango_dias: this.dias, filas }
      });
    } catch {
      // sin bitácora no se rompe la exportación
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

import { Component, Input, OnDestroy, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { PresenciaService, estaEnLinea } from '../../services/Backend/presencia/presencia';

const INTERVALO_MS = 30000;
const CADA_MS_CONSULTA = 40000;

/**
 * Badge "En línea / Sin conexión" de una persona.
 *
 * Se usa en todas las pantallas del cuidador (personas a cargo, ubicación,
 * zona segura, panel) para que en todas partes se vea si el adulto tiene
 * internet con la app activa. Se refresca solo: si el adulto pierde la señal
 * pasa a "Sin conexión" y en cuanto vuelve la señal vuelve a "En línea".
 */
@Component({
  selector: 'app-estado-conexion',
  standalone: true,
  template: `
    <span
      class="conexion"
      [class.en-linea]="enLinea === true"
      [class.sin-linea]="enLinea !== true"
      [class.compacto]="compacto">
      <span class="punto"></span>
      <span class="texto">{{ texto }}</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .conexion {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 11px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        background: #f1f1f4;
        color: #6b7280;
      }

      .conexion.compacto {
        padding: 3px 9px;
        font-size: 11.5px;
      }

      .punto {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9e9e9e;
        flex-shrink: 0;
      }

      .en-linea {
        background: #e7f6ea;
        color: #2e7d32;
      }

      .en-linea .punto {
        background: #43a047;
        box-shadow: 0 0 0 3px rgba(67, 160, 71, 0.2);
      }

      .sin-linea {
        background: #f1f1f4;
        color: #6b7280;
      }
    `
  ]
})
export class EstadoConexionComponent implements OnInit, OnDestroy {

  /** Id del usuario de la persona observada (para refrescar el estado). */
  @Input() idUsuario: string = '';

  /** Último "latido" que ya venía en la lista (evita la consulta inicial). */
  @Input() ultimoVisto: string | null = null;

  /** Texto cuando está en línea. */
  @Input() textoEnLinea: string = 'En línea';

  /** Texto cuando está sin conexión (si va vacío se arma con la hora). */
  @Input() textoSinConexion: string = '';

  /** Versión pequeña para listas de tarjetas. */
  @Input() compacto: boolean = true;

  /** Consultar el estado periódicamente (activar en la persona observada). */
  @Input() refrescar: boolean = false;

  enLinea: boolean | null = null;

  private timer: any = null;
  private ultimaConsulta: number = 0;
  private visto: string | null = null;

  private cd = inject(ChangeDetectorRef);
  private presencia = inject(PresenciaService);

  ngOnInit() {
    this.visto = this.ultimoVisto || null;
    void this.refrescarEstado();

    this.timer = setInterval(() => void this.refrescarEstado(), INTERVALO_MS);
  }

  ngOnDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async refrescarEstado() {
    this.calcular();

    if (this.refrescar && this.idUsuario && Date.now() - this.ultimaConsulta > CADA_MS_CONSULTA) {
      this.ultimaConsulta = Date.now();
      const visto = await this.presencia.obtenerUltimoVisto(this.idUsuario);
      if (visto) this.visto = visto;
      this.calcular();
    }

    this.cd.markForCheck();
  }

  private calcular() {
    this.enLinea = estaEnLinea(this.visto);
  }

  get texto(): string {
    if (this.enLinea === true) return this.textoEnLinea;

    if (this.textoSinConexion) return this.textoSinConexion;

    if (!this.visto) return 'Sin conexión';

    const fecha = new Date(this.visto);
    const edad = Date.now() - fecha.getTime();

    if (!isNaN(edad) && edad >= 0 && edad < 60 * 60 * 1000) {
      return `Sin conexión · hace ${Math.max(1, Math.round(edad / 60000))} min`;
    }

    const hora = fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    return `Sin conexión · última vez ${hora}`;
  }
}

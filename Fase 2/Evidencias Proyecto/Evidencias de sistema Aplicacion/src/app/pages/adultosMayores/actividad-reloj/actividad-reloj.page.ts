import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { Salud, type ResumenSalud } from '../../../services/Backend/salud/salud';

@Component({
  selector: 'app-actividad-reloj',
  templateUrl: './actividad-reloj.page.html',
  styleUrls: ['./actividad-reloj.page.scss'],
  imports: [
    CommonModule,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonSpinner,
    IonTitle,
    IonToolbar
  ]
})
export class ActividadRelojPage implements OnInit {
  private readonly salud = inject(Salud);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  resumen: ResumenSalud | null = null;
  cargando = true;
  error: string | null = null;
  permisosFaltantes: string[] = [];
  fechaHoy = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date());

  constructor() {
    addIcons(icons);
  }

  ngOnInit(): void {
    void this.cargarActividad();
  }

  async cargarActividad(): Promise<void> {
    this.cargando = true;
    this.error = null;

    try {
      const disponibilidad = await this.salud.disponibilidad();
      if (!disponibilidad.disponible) {
        this.error = disponibilidad.motivo;
        return;
      }

      if (!await this.salud.tienePermisos()) {
        this.error = 'Autoriza el acceso a los datos del reloj desde la pantalla anterior.';
        return;
      }

      const faltantes = await this.salud.tiposSinPermiso();
      this.permisosFaltantes = faltantes.map((tipo) => this.salud.traducirTipo(tipo));
      this.resumen = await this.salud.leerResumen();
    } catch (e) {
      console.warn('[Actividad reloj] No se pudieron cargar los datos del reloj:', e);
      this.error = 'No se pudieron leer los datos del reloj. Intenta volver a entrar más tarde.';
    } finally {
      this.cargando = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  valor(value: number | null | undefined): string {
    return value === null || value === undefined ? 'Sin datos' : value.toLocaleString('es-CL');
  }

  duracionSueno(minutos: number | null): string {
    if (minutos === null) return 'Sin datos';

    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return horas > 0 ? `${horas} h ${resto} min` : `${resto} min`;
  }
  hora(fecha: string | null): string | null {
    if (!fecha) return null;

    const valor = new Date(fecha);
    if (!Number.isFinite(valor.getTime())) return null;

    return new Intl.DateTimeFormat('es-CL', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(valor);
  }
}

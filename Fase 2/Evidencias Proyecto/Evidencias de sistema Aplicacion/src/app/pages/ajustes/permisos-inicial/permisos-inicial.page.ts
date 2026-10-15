import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonButton,
  IonSpinner,
  IonProgressBar
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { PermisosService, PermisoInfo, EstadoPermiso } from '../../../services/permisos/permisos.service';
import { NavegacionRolService } from '../../../services/navegacion-rol/navegacion-rol';

/**
 * Pantalla de bienvenida de permisos.
 *
 * Se pide UN permiso a la vez, con la explicación antes del diálogo del
 * sistema. Es el patrón que usan hoy las apps: pedir los cuatro de golpe hace
 * que la gente los niegue en bloque, y los denegados al principio quedan
 * denegados para siempre.
 *
 * Nunca es bloqueante: se puede saltar. Si se salta, el panel muestra un aviso
 * con un botón para volver acá.
 */
@Component({
  selector: 'app-permisos-inicial',
  templateUrl: './permisos-inicial.page.html',
  styleUrls: ['./permisos-inicial.page.scss'],
  imports: [IonContent, IonIcon, IonButton, IonSpinner, IonProgressBar, CommonModule]
})
export class PermisosInicialPage implements OnInit {

  /** Los que faltan pedir, en orden. */
  pendientes: PermisoInfo[] = [];

  /** El permiso que se está explicando en este momento. */
  actual: PermisoInfo | null = null;

  procesando = false;

  cargando = true;

  private isNative = Capacitor.isNativePlatform();

  constructor(
    private router: Router,
    private navRol: NavegacionRolService,
    private permisosService: PermisosService,
    private cdr: ChangeDetectorRef
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    if (!this.isNative) {
      // En el navegador no hay permisos que pedir: se sigue de largo.
      await this.saltar();
      return;
    }
    await this.cargar();
  }

  private async cargar() {
    this.cargando = true;
    this.cdr.detectChanges();

    try {
      const todos = await this.permisosService.verificarTodos();
      // Sólo los que se piden al entrar y siguen apagados.
      this.pendientes = todos.filter(
        (p) => p.momento === 'inicial' && p.estado !== 'concedido' && p.estado !== 'no-aplica'
      );
    } catch (e) {
      console.error('No se pudieron verificar los permisos:', e);
      this.pendientes = [];
    } finally {
      this.cargando = false;
      this.actual = this.pendientes[0] ?? null;
      this.cdr.detectChanges();

      // Si no queda nada por pedir, esta pantalla se queda con "Todo listo"
      // para siempre: hay que salir de ella, si no la app no entra nunca.
      if (!this.actual) {
        await this.terminar();
      }
    }
  }

  get total(): number {
    return this.pendientes.length;
  }

  get hechos(): number {
    return this.pendientes.length > 0 ? this.total - this.pendientes.length + 1 : 0;
  }

  get progreso(): number {
    return this.total === 0 ? 1 : this.hechos / this.total;
  }

  /** Icono del estado actual, para mostrarlo mientras espera la respuesta. */
  estadoDe(p: PermisoInfo): 'ok' | 'falta' | 'bloqueado' {
    if (p.estado === 'concedido') return 'ok';
    if (p.estado === 'bloqueado') return 'bloqueado';
    return 'falta';
  }

  etiqueta(estado: EstadoPermiso): string {
    switch (estado) {
      case 'concedido': return 'Listo';
      case 'bloqueado': return 'Bloqueado';
      case 'denegado': return 'Pendiente';
      default: return 'Comprobando';
    }
  }

  // =====================================================
  // ACCIONES
  // =====================================================

  async activar() {
    if (!this.actual || this.procesando) return;

    this.procesando = true;
    this.cdr.detectChanges();

    try {
      await this.permisosService.pedir(this.actual.id);
    } catch (e) {
      console.warn('No se pudo activar el permiso:', e);
    } finally {
      this.procesando = false;
      await this.avanzar();
    }
  }

  /**
   * "Ahora no". No se marca como preguntado para no gastar el intento: el
   * permiso queda en la lista y se puede volver a pedir desde el panel.
   */
  async despues() {
    if (!this.actual) return;
    await this.avanzar();
  }

  private async avanzar() {
    this.pendientes = this.pendientes.filter((p) => p.id !== this.actual?.id);
    this.actual = this.pendientes[0] ?? null;
    this.cdr.detectChanges();

    if (!this.actual) await this.terminar();
  }

  /** Ir a Ajustes del sistema desde la explicación. */
  async irAAjustes() {
    if (!this.actual) return;
    await this.permisosService.abrirAjustesPara(this.actual.id);
  }

  async saltar() {
    this.permisosService.marcarOnboardingCompletado();
    await this.irAlPanel();
  }

  private async terminar() {
    this.permisosService.marcarOnboardingCompletado();
    await this.irAlPanel();
  }

  private async irAlPanel() {
    await this.navRol.irAPanelPrincipal();
    // Si no se pudo navegar (rol desconocido), al menos no quedar atrapado acá.
    if (this.router.url.includes('permisos-inicial')) {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    }
  }
}

import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonToggle
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { PermisosService, PermisoInfo } from '../../../services/permisos/permisos.service';

@Component({
  selector: 'app-permisos',
  templateUrl: './permisos.page.html',
  styleUrls: ['./permisos.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonToggle,
    CommonModule
  ]
})
export class PermisosPage implements OnInit {

  permisos: PermisoInfo[] = [];
  permisoProcesando: string | null = null;
  toastMensaje = '';
  showToast = false;

  constructor(
    private router: Router,
    private permisosService: PermisosService,
    private cdr: ChangeDetectorRef
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    await this.cargarPermisos();
  }

  async ionViewWillEnter() {
    await this.cargarPermisos();
  }

  async cargarPermisos() {
    try {
      this.permisos = await this.permisosService.obtenerTodosLosPermisos();
    } catch (e) {
      console.error('Error:', e);
    }

    if (!this.permisos || this.permisos.length === 0) {
      this.permisos = this.permisosService.getPermisosPorDefecto();
    }

    this.cdr.detectChanges();
  }

  async onToggleChange(permiso: PermisoInfo, event: any) {
    const activado = event.detail.checked;

    if (activado) {
      await this.activarPermiso(permiso);
    } else {
      await this.desactivarPermiso(permiso);
    }
  }

  private async activarPermiso(permiso: PermisoInfo) {
    this.permisoProcesando = permiso.id;
    this.cdr.detectChanges();

    try {
      const concedido = await this.permisosService.solicitarPermiso(permiso.id);

      if (concedido) {
        this.mostrarToast(`${permiso.nombre} activado correctamente`);
      } else {
        this.mostrarToast(`${permiso.nombre} no se pudo activar. Revisa los ajustes.`);
      }
    } catch (e) {
      this.mostrarToast('Error al solicitar permiso');
    }

    this.permisoProcesando = null;
    await this.cargarPermisos();
  }

  private async desactivarPermiso(permiso: PermisoInfo) {
    this.mostrarToast('Para desactivar, ve a Ajustes del sistema > Apps > SiempreCerca > Permisos');
    await this.permisosService.abrirAjustesApp();
    await this.cargarPermisos();
  }

  private mostrarToast(mensaje: string) {
    this.toastMensaje = mensaje;
    this.showToast = true;
    setTimeout(() => {
      this.showToast = false;
      this.cdr.detectChanges();
    }, 3000);
  }

  volver() {
    this.router.navigate(['/ajustes']);
  }
}

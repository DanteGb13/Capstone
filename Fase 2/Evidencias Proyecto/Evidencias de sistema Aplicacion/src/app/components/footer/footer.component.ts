import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonIcon, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, IonIcon],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {

  @Input() tipo: 'adulto-mayor' | 'cuidador' = 'adulto-mayor';

  private toastCtrl = inject(ToastController);

  constructor(
    private router: Router,
    private navRol: NavegacionRolService
  ) {
    addIcons(icons);
  }

  /** Cada rol tiene su propia pantalla de contactos de emergencia. */
  irContactos() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate([
      this.tipo === 'adulto-mayor' ? '/contacto-emergencia' : '/contactos-cuidador'
    ]);
  }

  async irInicio() {
    await this.navRol.irAPanelPrincipal();
    await this.avisarMenuPrincipal();
  }

  /**
   * Avisa que la casa deja a la persona en el menú principal.
   *
   * El ícono de la casa solo se entiende si ya se sabe qué significa; para las
   * personas mayores el aviso aclara dónde están, incluso si ya estaban en el
   * menú. Se muestra arriba para no tapar el propio menú de abajo.
   */
  private async avisarMenuPrincipal(): Promise<void> {
    try {
      const aviso = await this.toastCtrl.create({
        message: 'Estás en el menú principal',
        duration: 3000,
        position: 'top'
      });
      await aviso.present();
    } catch {
      /* sin UI disponible */
    }
  }

  irAjustes() {
    this.router.navigate(['/ajustes']);
  }
}

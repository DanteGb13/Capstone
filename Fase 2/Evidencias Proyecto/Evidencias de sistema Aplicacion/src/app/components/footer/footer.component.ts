import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
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
  }

  irAjustes() {
    this.router.navigate(['/ajustes']);
  }
}

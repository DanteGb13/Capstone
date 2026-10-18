import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-web-nav',
  templateUrl: 'web-nav.html',
  imports: [RouterLink, RouterLinkActive],
})
export class WebNav {
  /**
   * Menú desplegable de las pantallas chicas. Arriba el ancho el navbar es una
   * sola fila y esto nunca se ve, así que el estado arranca cerrado y no
   * importa que quede en `false` cuando no aplica.
   */
  menuAbierto = false;

  private cdr = inject(ChangeDetectorRef);

  alternarMenu() {
    this.menuAbierto = !this.menuAbierto;
    this.cdr.markForCheck();
  }

  cerrarMenu() {
    if (!this.menuAbierto) return;
    this.menuAbierto = false;
    this.cdr.markForCheck();
  }
}
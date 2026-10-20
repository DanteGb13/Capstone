import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Login } from '../../services/guards/login/login';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';

/**
 * Enlaces del navbar para el rol Administrador.
 *
 * Reemplazan a los de la web pública: el administrador no navega la landing,
 * navega su panel.
 */
const ENLACES_ADMIN = [
  { ruta: '/panel-control', etiqueta: 'Panel' },
  { ruta: '/analitica', etiqueta: 'Analítica' },
  { ruta: '/usuarios', etiqueta: 'Usuarios' },
  { ruta: '/reportes', etiqueta: 'Reportes' },
  { ruta: '/configuracion', etiqueta: 'Configuración' }
];

const ENLACES_PUBLICOS = [
  { ruta: '/inicio', etiqueta: 'Inicio' },
  { ruta: '/planes', etiqueta: 'Planes' },
  { ruta: '/descarga', etiqueta: 'Descarga' },
  { ruta: '/contactanos', etiqueta: 'Contáctanos' }
];

@Component({
  selector: 'app-web-nav',
  templateUrl: 'web-nav.html',
  styleUrls: ['web-nav.scss'],
  imports: [RouterLink, RouterLinkActive],
})
export class WebNav implements OnInit {

  /**
   * Menú desplegable de las pantallas chicas. Arriba del ancho el navbar es una
   * sola fila y esto nunca se ve, así que el estado arranca cerrado y no
   * importa que quede en `false` cuando no aplica.
   */
  menuAbierto = false;

  /** Desplegable del mini perfil: "Perfil" y "Cerrar sesión". */
  perfilAbierto = false;

  /** Mientras se resuelve el rol no se pinta nada de los dos menús: si no,
   *  aparecería la landing un instante en una pantalla que es del panel. */
  cargando = true;

  esAdmin = false;

  /** Hay sesión abierta en la web. No es lo mismo que `esAdmin`: un Familiar
   *  o un Usuario también puede entrar por `/acceso`, aunque no tenga panel. */
  logueado = false;

  perfil: PerfilResumen | null = null;

  /** Iniciales del nombre, para el avatar cuando no hay foto. */
  iniciales = '';

  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private perfilCache = inject(PerfilCacheService);
  private loginService = inject(Login);
  private alertCtrl = inject(AlertController);

  async ngOnInit() {
    try {
      const perfil = await this.perfilCache.perfil();
      this.perfil = perfil;
      this.esAdmin = perfil?.rol === 'Administrador';
      this.logueado = !!perfil;
      this.iniciales = this.calcularIniciales(perfil?.nombreCompleto);
    } catch {
      // Sin perfil no hay rol: se muestra la web pública, que es lo que
      // puede ver cualquiera.
    }

    this.cargando = false;
    this.refrescar();
  }

  get enlaces() {
    return this.esAdmin ? ENLACES_ADMIN : ENLACES_PUBLICOS;
  }

  alternarMenu() {
    this.menuAbierto = !this.menuAbierto;
    if (this.menuAbierto) this.perfilAbierto = false;
    this.refrescar();
  }

  cerrarMenu() {
    if (!this.menuAbierto && !this.perfilAbierto) return;
    this.menuAbierto = false;
    this.perfilAbierto = false;
    this.refrescar();
  }

  alternarPerfil() {
    this.perfilAbierto = !this.perfilAbierto;
    if (this.perfilAbierto) this.menuAbierto = false;
    this.refrescar();
  }

  /**
   * Tocar fuera del navbar cierra los menús. Sin esto quedan abiertos y se
   * pisan con el contenido que queda debajo.
   */
  @HostListener('document:click', ['$event'])
  alTocarFuera(evento: Event) {
    const destino = evento.target as HTMLElement | null;
    if (!destino || destino.closest('.web-nav')) return;
    this.cerrarMenu();
  }

  cerrarSesion() {
    const alerta = this.alertCtrl.create({
      header: 'Cerrar sesión',
      message: 'Vas a salir de tu cuenta en este dispositivo.',
      cssClass: 'alerta-cerrar-sesion',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Cerrar sesión',
          role: 'destructive',
          handler: () => {
            void this.salir();
          }
        }
      ]
    });

    void alerta.then((a) => a.present());
  }

  private async salir() {
    try {
      // Cierra sesión sólo en este dispositivo (scope 'local') y libera el
      // token de push: si no, este celular seguiría recibiendo alertas de la
      // cuenta que salió.
      await this.loginService.cerrarSesion();
    } catch (e) {
      console.warn('No se pudo cerrar sesión desde la navegación:', e);
    }

    this.perfilAbierto = false;
    this.refrescar();

    this.router.navigate(['/inicio'], { replaceUrl: true });
  }

  private calcularIniciales(nombreCompleto: string | undefined | null): string {
    const palabras = (nombreCompleto ?? '').trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return '';

    const primera = palabras[0].charAt(0);
    const segunda = palabras.length > 1 ? palabras[1].charAt(0) : palabras[0].charAt(1) ?? '';

    return (primera + segunda).toUpperCase();
  }

  // La app corre SIN zone.js (zoneless): cambiar el estado después de un
  // await NO repinta la vista por sí solo.
  private refrescar() {
    this.cdr.markForCheck();
  }
}

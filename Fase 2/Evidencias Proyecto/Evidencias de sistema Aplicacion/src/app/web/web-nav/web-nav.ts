import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { AccesoService } from '../acceso/acceso.service';
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
  private acceso = inject(AccesoService);
  private alertCtrl = inject(AlertController);
  private destruccion = inject(DestroyRef);

  async ngOnInit() {
    // Cambiar la foto o el nombre desde Mi Perfil se ve al instante en la
    // barra, sin tener que navegar a otra página. Cada página monta su propio
    // `app-web-nav`, así que si no, este seguiría con el perfil viejo.
    this.perfilCache.cambios$
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe(() => void this.refrescarPerfil());

    await this.refrescarPerfil();
    this.cargando = false;
    this.refrescar();
  }

  /** Vuelve a leer el perfil desde el caché y repinta la barra. */
  private async refrescarPerfil(): Promise<void> {
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
      message: '¿Seguro que quieres cerrar sesión?',
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

  /**
   * Cierra la sesión de la web y vuelve a la landing.
   *
   * Usa `AccesoService` (el de la web) y no el `Login` de la app: ése libera
   * primero el token de push con una consulta de red sin timeout, y si esa
   * consulta se colgaba éste método no llegaba nunca a navegar. La pantalla
   * quedaba "muda", y al tocar después cualquier enlace del panel el guard,
   * que ya no veía sesión, mandaba al acceso de la web.
   *
   * Con el límite de tiempo nadie se queda esperando: o se cierra y se vuelve
   * al inicio, o se avisa en pantalla que no se pudo.
   */
  private async salir() {
    try {
      await this.conLimite(this.acceso.salir(), 6000);
    } catch (e) {
      console.warn('No se pudo cerrar sesión desde la navegación:', e);
      await this.avisarQueFallo();
      return;
    }

    this.menuAbierto = false;
    this.perfilAbierto = false;
    this.perfil = null;
    this.esAdmin = false;
    this.logueado = false;
    this.refrescar();

    this.router.navigate(['/inicio'], { replaceUrl: true });
  }

  /** Rechaza si la promesa no resuelve a tiempo. */
  private conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolver, rechazar) => {
      const reloj = setTimeout(() => rechazar(new Error(`sin respuesta en ${ms} ms`)), ms);
      promesa.then(
        (valor) => { clearTimeout(reloj); resolver(valor); },
        (error) => { clearTimeout(reloj); rechazar(error); }
      );
    });
  }

  /**
   * Aviso visible de que la sesión sigue abierta.
   *
   * Sin esto el fallo se iba al `console.warn` y desde fuera se veía exactamente
   * lo mismo que un cierre que no hace nada.
   */
  private async avisarQueFallo(): Promise<void> {
    try {
      const alerta = await this.alertCtrl.create({
        header: 'No se pudo cerrar sesión',
        message: 'Revisa tu conexión e inténtalo de nuevo.',
        buttons: ['Entendido']
      });
      await alerta.present();
    } catch {
      // Si ni siquiera hay overlay, no queda dónde avisar.
    }
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

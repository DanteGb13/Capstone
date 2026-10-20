import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../supabase/supabase';
import { RUTAS_PANEL_ADMIN } from '../navegacion-rol/navegacion-rol';

/**
 * Registra cada pantalla visitada en `analitica_eventos`.
 *
 * Se arranca desde `AppComponent`, que vive toda la vida de la app, así que
 * cubre igual la web y la versión nativa: la única diferencia es el campo
 * `plataforma`.
 *
 * Lo que NO registra es el panel del administrador (`RUTAS_PANEL_ADMIN`).
 * Contar al admin mirando su propio panel inflaría el ranking de páginas con
 * tráfico que no dice nada sobre el uso real de la app.
 */
@Injectable({ providedIn: 'root' })
export class AnaliticaService {

  private router = inject(Router);
  private supabaseService = inject(SupabaseService);

  /**
   * Se guarda el id en memoria en vez de pedirlo en cada navegación.
   *
   * `getSession()` puede intentar renovar el token si venció, y pedirlo en
   * cada cambio de pantalla justo después de la carrera de refresh tokens con
   * el servicio de segundo plano es una muy mala idea. El evento
   * `onAuthStateChange` ya avisa cuando cambia.
   */
  private usuarioId: string | null = null;

  private rutaAnterior: string | null = null;
  private iniciado = false;

  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;

    // Sincroniza el id guardado con el que ya hay en el cliente.
    void this.supabaseService.getClient().auth.getSession()
      .then(({ data }) => {
        this.usuarioId = data?.session?.user?.id ?? null;
      })
      .catch(() => { /* sin sesión no se registra el usuario, pero sí la ruta */ });

    this.supabaseService.getClient().auth.onAuthStateChange((_evento, sesion) => {
      this.usuarioId = sesion?.user?.id ?? null;
    });

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.registrar(e.urlAfterRedirects));
  }

  private registrar(ruta: string): void {
    if (RUTAS_PANEL_ADMIN.includes(ruta)) return;

    // Las redirecciones encadenadas disparan dos NavigationEnd con la misma
    // URL: sin esto, /panel-control aparecería dos veces en el ranking.
    if (ruta === this.rutaAnterior) return;
    this.rutaAnterior = ruta;

    const plataforma = Capacitor.isNativePlatform() ? 'app' : 'web';

    // Sin await a propósito: registrar un evento no puede frenar la
    // navegación ni dejar la pantalla en blanco si la red falla. Un evento
    // perdido no es grave; una app que no navega, sí.
    void this.supabaseService.getClient()
      .from('analitica_eventos')
      .insert({
        usuario_id: this.usuarioId,
        ruta,
        plataforma
      })
      .then(
        () => { /* ok */ },
        () => { /* sin conexión se pierde el evento y nada más */ }
      );
  }
}

import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../supabase/supabase';

/**
 * Rutas protegidas por rol.
 */
/**
 * Rutas que pertenecen SOLO a un rol.
 * Ojo: authGuard evalúa la URL actual (no el destino). Si una ruta compartida
 * por ambos roles (ej: /zona-segura) está en ambas listas, el guard entra en
 * bucle al intentar salir de ella y la navegación queda "muda".
 */
export const RUTAS_CUIDADOR = [
  '/cuidador',
  '/cuidado',
  '/ubicacion',
  '/historial',
  '/adulto-cargo',
  '/contactos-cuidador',
  '/estado'
];

export const RUTAS_ADULTO_MAYOR = [
  '/adulto-mayor',
  '/contacto-emergencia',
  '/informacion',
  '/recordatorios',
  '/mi-ubicacion'
];

/**
 * Secciones internas del panel de administración.
 *
 * NO se registran en la analítica: el administrador mirando su propio panel
 * no es dato de uso de la app, y contarlo infla las cifras de "páginas más
 * visitadas" con tráfico que no aporta nada.
 */
export const RUTAS_PANEL_ADMIN = [
  '/panel-control',
  '/analitica',
  '/usuarios',
  '/reportes',
  '/configuracion',
  '/mi-perfil'
];

/**
 * Rutas que un Administrador sí puede ver: las páginas públicas de la web y su
 * propio panel. Nada de la app móvil.
 *
 * Es una lista blanca a propósito y no un "todo salvo la app": si mañana se
 * agrega una ruta nueva a la app, el administrador queda fuera por defecto en
 * lugar de poder abrirla. Que las rutas del panel estén aquí también es lo que
 * evita el bucle: el guard lo redirige a una ruta que él mismo permite.
 */
export const RUTAS_ADMIN = [
  ...RUTAS_PANEL_ADMIN,
  '/inicio',
  '/planes',
  '/descarga',
  '/contactanos'
];

@Injectable({
  providedIn: 'root'
})
export class NavegacionRolService {

  private rolCache: string | null = null;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

  /**
   * Obtiene el rol del usuario actual (con caché).
   * La primera vez consulta la BD, después usa caché.
   * Llamar limpiarCache() si el rol puede cambiar (ej: tras completar perfil).
   */
  async obtenerRol(): Promise<string | null> {
    if (this.rolCache) {
      return this.rolCache;
    }

    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;

      const { data: usuario } = await supabase
        .from('usuario')
        .select('rol(nombre)')
        .eq('id', session.user.id)
        .maybeSingle();

      if (usuario?.rol) {
        const rolData = usuario.rol as any;
        this.rolCache = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;
        return this.rolCache;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Limpia la caché del rol (llamar tras registro, cambio de perfil, etc.).
   */
  limpiarCache() {
    this.rolCache = null;
  }

  /**
   * El Administrador es de la web: en la app móvil no hay pantallas para él.
   *
   * Se comprueba en un solo lugar porque desde acá salen todos los destinos:
   * `rutaPrincipal` y `verificarAccesoConRol` son los que usan `authGuard`,
   * `noAuthGuard`, `siguientePasoGuard` y la salida de sesión. Si el control
   * viviera en cada guard por separado, bastaría con olvidarse de uno para
   * que un administrador entrara a la app por ahí.
   */
  private esAdministradorEnApp(rol: string | null): boolean {
    return rol === 'Administrador' && Capacitor.isNativePlatform();
  }

  /**
   * Devuelve la ruta del panel principal según el rol.
   *
   * Administrador va a su panel de la web. En el celular, como no tiene
   * pantallas propias, se manda a la landing pública: es un callejón sin
   * salida (esa ruta no tiene guard), así que no hay bucle de redirecciones.
   */
  rutaPrincipal(rol: string | null): string {
    if (this.esAdministradorEnApp(rol)) return '/inicio';
    if (rol === 'Administrador') return '/panel-control';
    return rol === 'Familiar' ? '/cuidador' : '/adulto-mayor';
  }

  /**
   * Redirige al usuario a su panel principal según su rol.
   */
  async irAPanelPrincipal() {
    const rol = await this.obtenerRol();
    this.router.navigate([this.rutaPrincipal(rol)], { replaceUrl: true });
  }

  /**
   * Verifica si una ruta corresponde al rol, usando un rol que ya se conoce.
   * Síncrona a propósito: authGuard ya pidió el usuario con su rol y repetir
   * la consulta aquí agregaba una espera más antes de abrir cada pantalla.
   */
  verificarAccesoConRol(rol: string | null, url: string): string | null {
    // En la app móvil el Administrador no tiene nada que hacer: cualquier
    // pantalla de la app lo devuelve a la landing pública. Va antes del resto
    // porque en el navegador esa misma persona sí tiene su panel.
    if (this.esAdministradorEnApp(rol)) {
      return this.rutaPrincipal(rol);
    }

    if (rol === 'Administrador') {
      // Lista blanca: fuera de la web pública y de su panel no hay nada para
      // él, así que cubre todas las rutas de la app de una sola vez (home,
      // ajustes, perfil, juegos, zona-segura, privacidad, ...) sin tener que
      // listarlas una por una.
      return RUTAS_ADMIN.includes(url) ? null : this.rutaPrincipal(rol);
    }

    if (rol === 'Familiar' && RUTAS_ADULTO_MAYOR.includes(url)) {
      return this.rutaPrincipal(rol);
    }

    if (rol === 'Usuario' && RUTAS_CUIDADOR.includes(url)) {
      return this.rutaPrincipal(rol);
    }

    return null;
  }

  /**
   * Verifica si una ruta corresponde al rol del usuario.
   * - null si el usuario puede acceder a la ruta.
   * - La ruta del panel correcto si el usuario NO puede acceder.
   */
  async verificarAcceso(url: string): Promise<string | null> {
    return this.verificarAccesoConRol(await this.obtenerRol(), url);
  }

  /**
   * Navega a la ruta solo si el usuario tiene el rol correcto.
   * Si no tiene permiso, lo redirige a su panel principal.
   */
  async navegarSiTieneAcceso(url: string): Promise<boolean> {
    const rutaCorrecta = await this.verificarAcceso(url);
    if (rutaCorrecta) {
      this.router.navigate([rutaCorrecta], { replaceUrl: true });
      return false;
    }
    return true;
  }
}

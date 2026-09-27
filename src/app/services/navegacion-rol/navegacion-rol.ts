import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
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
  '/estado'
];

export const RUTAS_ADULTO_MAYOR = [
  '/adulto-mayor',
  '/contacto-emergencia',
  '/informacion',
  '/recordatorios',
  '/mi-ubicacion'
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
   * Devuelve la ruta del panel principal según el rol.
   */
  rutaPrincipal(rol: string | null): string {
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

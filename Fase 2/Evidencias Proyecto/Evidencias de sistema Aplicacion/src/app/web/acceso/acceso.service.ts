import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase-client';

/**
 * Resultado de mirar la sesión después de entrar.
 *
 * Unión cerrada en vez de un objeto con tres booleanos: así `acceso.page` es
 * obligado a cubrir todos los casos y no puede olvidarse de uno y mandar a la
 * persona a una pantalla que no le corresponde.
 */
export type EstadoAcceso =
  /** Todo bien: hay sesión, perfil completo y rol conocido. */
  | { motivo: 'ok'; rol: string }
  /** No hay sesión guardada (o ya venció). */
  | { motivo: 'sin-sesion' }
  /** Falta RUT o dirección. El alta se termina en la app móvil. */
  | { motivo: 'perfil-incompleto' }
  /** El perfil existe pero su rol no resuelve a un nombre. */
  | { motivo: 'sin-rol' }
  /** La cuenta existe pero fue desactivada por un administrador. */
  | { motivo: 'cuenta-inactiva' }
  /** No se pudo leer nada (red, permisos, error de consulta). */
  | { motivo: 'error' };

/**
 * Acceso de la web.
 *
 * Servicio propio del login de la web, no reutiliza el de la app. Las dos
 * pantallas se parecen por fuera pero no por dentro:
 *
 * - `/login` (app) trae registro, "elegir tipo" y Google, y su `Login` vive
 *   en `services/guards/` junto a los guards de la app móvil.
 * - `/acceso` (web) sólo pide correo y contraseña, y toda su lógica vive
 *   dentro de `web/acceso/`.
 *
 * Lo único que comparte con la app es el cliente de Supabase (`core/`), y es
 * a propósito: dos clientes con la misma llave se pelean por el mismo refresh
 * token en `localStorage`. Ver `core/supabase-client.ts`.
 */
@Injectable({ providedIn: 'root' })
export class AccesoService {

  private cliente = inject(SupabaseClientProvider);


  /**
   * Cierra sesión y devuelve el estado de la cuenta.
   *
   * Lanza con el error de Supabase sin traducir: lo que ve la persona se
   * arma en `mensajeDeError`, y ese texto es sólo para quien tenga que
   * encontrar el problema.
   */
  async iniciarSesion(correo: string, contrasena: string): Promise<void> {
    const { error } = await this.cliente.get().auth.signInWithPassword({
      email: correo,
      password: contrasena,
    });

    if (error) {
      throw error;
    }
  }

  /**
   * Lee la sesión actual y el perfil que le corresponde.
   *
   * Nunca lanza: cualquier falla vuelve como `motivo: 'error'`, porque una
   * pantalla de entrada no puede quedarse colgada esperando la red.
   *
   * Cada caso anómalo deja su traza en consola. El mensaje que se le muestra
   * a la persona es corto y a propósito vago; si hay que diagnosticar algo,
   * la causa está en la consola y no en el texto que ve el usuario.
   */
  async leerEstado(): Promise<EstadoAcceso> {
    try {
      const supabase = this.cliente.get();

      const {
        data: { session },
        error: sesionError,
      } = await supabase.auth.getSession();

      if (sesionError) {
        console.error('[acceso] no se pudo leer la sesión:', sesionError.message);
        return { motivo: 'error' };
      }

      if (!session) {
        return { motivo: 'sin-sesion' };
      }

      const { data: usuario, error: perfilError } = await supabase
        .from('usuario')
        .select('rut, id_direccion, estado, rol(nombre)')
        .eq('id', session.user.id)
        .maybeSingle();

      if (perfilError) {
        // Es el caso que más fácil se pierde: una política de RLS mal hecha
        // no avisa "sin permiso", avanza como un error de consulta y de
        // afuera sólo se ve que "no se pudo leer el rol".
        console.error(
          '[acceso] no se pudo leer el perfil:',
          perfilError.message,
          perfilError.details ?? ''
        );
        return { motivo: 'error' };
      }

      if (!usuario || !usuario.rut || !usuario.id_direccion) {
        return { motivo: 'perfil-incompleto' };
      }

      if (usuario.estado === false) {
        await supabase.auth.signOut({ scope: 'local' });
        return { motivo: 'cuenta-inactiva' };
      }

      const rolData = usuario.rol as { nombre?: string } | { nombre?: string }[] | null;
      const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;

      if (!rol) {
        console.error(
          '[acceso] el perfil no trae rol: `id_rol` apunta a una fila que no existe en `rol`,',
          'o esa fila no es legible. session user id =',
          session.user.id
        );
        return { motivo: 'sin-rol' };
      }

      return { motivo: 'ok', rol };
    } catch (e) {
      console.error('[acceso] error inesperado leyendo el estado:', e);
      return { motivo: 'error' };
    }
  }

  /**
   * Adónde cae cada rol una vez dentro.
   *
   * Está escrita acá y no en `navegacion-rol` porque es el reparto de la web:
   * el servicio de la app decide adónde va un rol en el celular, que es otra
   * pregunta. Si se mueve de un lado a otro, las dos pantallas empiezan a
   * mandar a sitios distintos.
   */
  destinoPara(rol: string): string | null {
    if (rol === 'Administrador') return '/panel-control';
    if (rol === 'Familiar') return '/cuidador';
    if (rol === 'Usuario') return '/adulto-mayor';
    return null;
  }

  /**
   * Mensaje para la persona, nunca el texto del servidor.
   *
   * Dos reglas:
   *
   * 1. "No existe ese correo" y "contraseña equivocada" dicen exactamente lo
   *    mismo. Anunciar que el correo sí está registrado le regala a un
   *    desconocido la mitad de las credenciales y convierte el formulario en
   *    un probador de correos.
   * 2. No se reenvía el texto crudo de Supabase por ningún motivo: podría
   *    traer el correo, el id o el detalle de la consulta fallida.
   */
  mensajeDeError(e: unknown): string {
    const texto = String((e as { message?: string })?.message ?? '').toLowerCase();

    if (
      texto.includes('cuenta está desactivada') ||
      texto.includes('cuenta desactivada') ||
      texto.includes('user is banned') ||
      texto.includes('usuario bloqueado')
    ) {
      return 'Esta cuenta está desactivada. Solicita ayuda a un administrador para volver a activarla.';
    }

    if (texto.includes('invalid login credentials') || texto.includes('user not found')) {
      return 'El correo o la contraseña no coinciden.';
    }

    if (texto.includes('email not confirmed')) {
      return 'Tu correo todavía no está confirmado. Revisa tu bandeja de entrada.';
    }

    if (texto.includes('rate limit') || texto.includes('too many')) {
      return 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.';
    }

    if (
      texto.includes('fetch') ||
      texto.includes('network') ||
      texto.includes('failed') ||
      texto.includes('timeout')
    ) {
      return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
    }

    return 'No se pudo iniciar sesión. Inténtalo de nuevo en unos segundos.';
  }

  /**
   * Sale de la cuenta en este navegador.
   *
   * `scope: 'local'`: cerrar sesión es salir de este dispositivo. El `global`
   * que viene por defecto revoca el refresh token de TODOS los dispositivos,
   * con lo que salir de la web expulsaba a la misma persona del celular.
   */
  async salir(): Promise<void> {
    const { error } = await this.cliente.get().auth.signOut({ scope: 'local' });
    if (error) {
      throw error;
    }
  }
}

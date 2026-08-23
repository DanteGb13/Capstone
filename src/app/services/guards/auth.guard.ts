import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../supabase/supabase';

/**
 * Obtiene el estado actual de la sesión y el perfil del usuario utilizando getSession (rápido y local).
 */
async function obtenerEstadoUsuario(supabaseService: SupabaseService) {
  try {
    const supabase = supabaseService.getClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      return { autenticado: false, perfilCompleto: false, rol: null };
    }

    const user = session.user;
    const { data: usuario, error: usuarioError } = await supabase
      .from('usuario')
      .select(`
        id,
        rut,
        id_direccion,
        id_rol,
        rol (
          id,
          nombre
        )
      `)
      .eq('id', user.id)
      .maybeSingle();

    if (usuarioError || !usuario || !usuario.rut || !usuario.id_direccion) {
      return { autenticado: true, perfilCompleto: false, rol: null };
    }

    const rolData = usuario.rol as any;
    const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;

    return { autenticado: true, perfilCompleto: true, rol };
  } catch {
    return { autenticado: false, perfilCompleto: false, rol: null };
  }
}

/**
 * Guard para páginas públicas como Login y Registro.
 * Si el usuario ya está autenticado, no le permite estar en Login o Registro y lo redirige:
 * - Si su perfil está completo -> a su panel (/adulto-mayor o /cuidador).
 * - Si su perfil está incompleto -> a /siguiente-paso.
 */
export const noAuthGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const estado = await obtenerEstadoUsuario(supabaseService);

  if (estado.autenticado) {
    if (estado.perfilCompleto) {
      if (estado.rol === 'Familiar') {
        router.navigate(['/cuidador'], { replaceUrl: true });
      } else {
        router.navigate(['/adulto-mayor'], { replaceUrl: true });
      }
      return false;
    } else {
      router.navigate(['/siguiente-paso'], { replaceUrl: true });
      return false;
    }
  }

  return true;
};

/**
 * Guard para /siguiente-paso.
 * - Si no está autenticado -> redirige a /login.
 * - Si ya tiene el perfil completo -> redirige a /adulto-mayor o /cuidador (no le deja volver a siguiente-paso).
 * - Si está autenticado y le falta completar el perfil -> permite el acceso.
 */
export const siguientePasoGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const estado = await obtenerEstadoUsuario(supabaseService);

  if (!estado.autenticado) {
    router.navigate(['/login'], { replaceUrl: true });
    return false;
  }

  if (estado.perfilCompleto) {
    if (estado.rol === 'Familiar') {
      router.navigate(['/cuidador'], { replaceUrl: true });
    } else {
      router.navigate(['/adulto-mayor'], { replaceUrl: true });
    }
    return false;
  }

  return true;
};

/**
 * Guard para páginas protegidas (cuidador, adulto-mayor, etc.).
 * - Si no está autenticado -> redirige a /login.
 * - Si está autenticado pero no ha completado el perfil -> redirige a /siguiente-paso.
 * - Si está autenticado y perfil completo -> permite acceso.
 */
export const authGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const estado = await obtenerEstadoUsuario(supabaseService);

  if (!estado.autenticado) {
    router.navigate(['/login'], { replaceUrl: true });
    return false;
  }

  if (!estado.perfilCompleto) {
    router.navigate(['/siguiente-paso'], { replaceUrl: true });
    return false;
  }

  return true;
};

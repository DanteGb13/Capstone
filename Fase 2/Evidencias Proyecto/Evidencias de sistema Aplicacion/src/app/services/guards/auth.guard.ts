import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase';
import { NavegacionRolService, RUTAS_CUIDADOR, RUTAS_ADULTO_MAYOR } from '../navegacion-rol/navegacion-rol';
import { PermisosService } from '../permisos/permisos.service';

/** Espera breve entre reintentos. */
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Estado "permitido" cuando falla la red: no significa que se haya cerrado sesión. */
const ESTADO_SIN_RED = {
  autenticado: true,
  perfilCompleto: true,
  existeUsuario: true,
  rol: null
};

/**
 * Obtiene el estado actual de la sesión y el perfil del usuario utilizando getSession (rápido y local).
 *
 * Ojo: getSession() intenta RENOVAR el token cuando este ya venció. Si en ese
 * instante no hay conexión devuelve error aunque la sesión siga guardada; antes
 * eso terminaba en un falso "cierre de sesión" que expulsaba al usuario al login.
 * Por eso ahora:
 *  - se reintenta una vez si falla la renovación,
 *  - si el error persiste (red) se permite el paso (el servidor sigue validando
 *    el token en cada consulta, así que no se abre ningún acceso),
 *  - si el error viene de la base de datos, no se toma como perfil incompleto.
 */
/**
 * Estado de la sesión y del perfil del usuario.
 *
 * Exportada para que `rol.guard.ts` pueda reutilizarla: consultar el rol otra
 * vez duplicaba la espera antes de abrir cada pantalla.
 */
export async function obtenerEstadoUsuario(supabaseService: SupabaseService) {
  try {
    const supabase = supabaseService.getClient();

    let session: Session | null = null;
    let sessionError: unknown = null;

    for (let intento = 0; intento < 2; intento++) {
      const resultado = await supabase.auth.getSession();
      session = resultado.data?.session ?? null;
      sessionError = resultado.error ?? null;
      if (session || !sessionError) {
        break;
      }
      await esperar(500);
    }

    if (!session) {
      // Error de red al renovar el token: la sesión sigue viva, no se expulsa.
      if (sessionError) {
        return { ...ESTADO_SIN_RED };
      }
      return { autenticado: false, perfilCompleto: false, existeUsuario: false, rol: null };
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

    if (usuarioError) {
      // Falló la consulta del perfil (red/BD): no significa perfil incompleto.
      return { ...ESTADO_SIN_RED };
    }

    if (!usuario || !usuario.rut || !usuario.id_direccion) {
      return { autenticado: true, perfilCompleto: false, existeUsuario: !!usuario, rol: null };
    }

    const rolData = usuario.rol as any;
    const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;

    return { autenticado: true, perfilCompleto: true, existeUsuario: true, rol };
  } catch {
    // Cualquier fallo inesperado tampoco debe cerrar la sesión.
    return { ...ESTADO_SIN_RED };
  }
}

/**
 * Guard para páginas públicas como Login y Registro.
 * Si el usuario ya está autenticado, no le permite estar en Login o Registro y lo redirige:
 * - Si su perfil está completo -> a su panel (/adulto-mayor o /cuidador).
 * - Si su perfil está incompleto -> a /elegir-tipo (elegir Usuario / Familiar).
 */
export const noAuthGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);
  const navRol = inject(NavegacionRolService);

  const estado = await obtenerEstadoUsuario(supabaseService);

  if (estado.autenticado) {
    if (estado.perfilCompleto) {
      router.navigate([navRol.rutaPrincipal(estado.rol)], { replaceUrl: true });
      return false;
    } else {
      // Registro incompleto → siempre /elegir-tipo.
      router.navigate(['/elegir-tipo'], { replaceUrl: true });
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
  const navRol = inject(NavegacionRolService);

  const estado = await obtenerEstadoUsuario(supabaseService);

  if (!estado.autenticado) {
    router.navigate(['/login'], { replaceUrl: true });
    return false;
  }

  if (estado.perfilCompleto) {
    router.navigate([navRol.rutaPrincipal(estado.rol)], { replaceUrl: true });
    return false;
  }

  return true;
};

/**
 * Guard para páginas protegidas (cuidador, adulto-mayor, etc.).
 * - Si no está autenticado -> redirige a /login.
 * - Si está autenticado pero no ha completado el perfil -> redirige a /elegir-tipo.
 * - Si está autenticado y perfil completo -> verifica que el rol coincida con la ruta.
 *   - Si el rol no coincide, redirige a su panel correcto.
 */
export const authGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);
  const navRol = inject(NavegacionRolService);

  const estado = await obtenerEstadoUsuario(supabaseService);

  if (!estado.autenticado) {
    router.navigate(['/login'], { replaceUrl: true });
    return false;
  }

  if (!estado.perfilCompleto) {
    router.navigate(['/elegir-tipo'], { replaceUrl: true });
    return false;
  }

  // El rol ya vino con el usuario que se pidió arriba: usarlo directamente
  // evita otra consulta a la base en cada navegación.
  const rutaIncorrecta = navRol.verificarAccesoConRol(estado.rol, router.url);
  if (rutaIncorrecta) {
    router.navigate([rutaIncorrecta], { replaceUrl: true });
    return false;
  }

  return true;
};

/**
 * Guard de los dos paneles principales: pide la pantalla de permisos la
 * PRIMERA vez que se entra con el perfil completo.
 *
 * Va aparte de authGuard a propósito, y no se engancha a todas las rutas
 * protegidas: así `/permisos`, `/perfil` o `/ajustes` siguen siendo accesibles
 * sin haber pasado por la pantalla de permisos.
 *
 * No bloquea: en cuanto la persona la salta o termina, se marca como hecha y
 * no vuelve a aparecer sola. Los permisos que falten se recuerdan con el aviso
 * del panel.
 */
export const onboardingPermisosGuard: CanActivateFn = () => {
  const router = inject(Router);
  const permisos = inject(PermisosService);

  // Si ya está en la pantalla de permisos, no se redirige (sería un bucle).
  if (router.url.startsWith('/permisos-inicial')) {
    return true;
  }

  if (permisos.onboardingCompletado()) {
    return true;
  }

  router.navigate(['/permisos-inicial'], { replaceUrl: true });
  return false;
};

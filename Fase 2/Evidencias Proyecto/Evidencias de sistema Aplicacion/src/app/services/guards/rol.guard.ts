import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../supabase/supabase';
import { obtenerEstadoUsuario } from './auth.guard';

/**
 * Fábrica de guards por rol.
 *
 * `authGuard` cubre el caso "esta ruta es de Familiar o de Usuario", que son
 * las pantallas de la app. Esta es para el otro caso: páginas que sólo puede
 * abrir un rol concreto, como el panel de la web.
 *
 * Se usa como fábrica y no como un guard fijo para poder reutilizarla:
 *
 *   canActivate: [rolGuard(['Administrador'])]
 *
 * OJO, igual que `authGuard`, esto ordena la navegación pero NO es seguridad.
 * Cualquiera puede saltarse un guard desde el navegador. Lo que de verdad
 * impide leer datos ajenos son las políticas RLS de Supabase.
 */
export const rolGuard = (rolesPermitidos: string[]): CanActivateFn => async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const estado = await obtenerEstadoUsuario(supabaseService);

  // Sin sesión no hay rol: al acceso de cada plataforma. En el celular eso es
  // `/login`; en el navegador sería `/login` también, pero esa ruta tiene
  // `soloAppGuard` y rebotaría de vuelta a `/inicio`, con lo que la web
  // daría dos saltos y acabaría en la landing en vez de en su propio
  // formulario.
  if (!estado.autenticado) {
    router.navigate(
      [Capacitor.isNativePlatform() ? '/login' : '/acceso'],
      { replaceUrl: true }
    );
    return false;
  }

  // El Administrador usa la web, no la app móvil: estas pantallas son de la
  // web, y en el celular no hay nada para él. Sin esto, escribiendo la URL a
  // mano entraría al panel adentro de la app.
  if (estado.rol === 'Administrador' && Capacitor.isNativePlatform()) {
    router.navigate(['/inicio'], { replaceUrl: true });
    return false;
  }

  // Autenticado pero sin el rol: fuera de la pantalla, de vuelta al inicio de
  // la web. No se manda al login porque ahí también lo expulsaría `noAuthGuard`
  // y el usuario quedaría en un bucle de redirecciones.
  if (!estado.rol || !rolesPermitidos.includes(estado.rol)) {
    router.navigate(['/inicio'], { replaceUrl: true });
    return false;
  }

  return true;
};
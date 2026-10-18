import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
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

  // Sin sesión no hay rol: al login, que además es la puerta de entrada tanto
  // de la web como de la app.
  if (!estado.autenticado) {
    router.navigate(['/login'], { replaceUrl: true });
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
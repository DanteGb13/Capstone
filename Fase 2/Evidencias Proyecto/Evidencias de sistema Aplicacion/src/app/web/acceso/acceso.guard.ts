import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AccesoService } from './acceso.service';

/**
 * Guards del acceso de la web.
 *
 * Viven en `web/acceso/` y no en `services/guards/`: ése es el archivo de los
 * guards de la app móvil. Dejar los dos en el mismo lugar fue lo que obligó a
 * poner `if (Capacitor.isNativePlatform())` dentro de guards que en realidad
 * sólo le pertenecen a una plataforma.
 */

/**
 * `/acceso` es el acceso de la web. En el celular se usa `/login`, que trae
 * el registro y el paso de elegir tipo.
 *
 * Sin esto, abriendo la URL a mano se ve el formulario de la web adentro de
 * la app.
 */
export const soloWebGuard: CanActivateFn = () => {
  if (!Capacitor.isNativePlatform()) return true;

  inject(Router).navigate(['/login'], { replaceUrl: true });
  return false;
};

/**
 * Si ya hay sesión, no vuelve a pedir credenciales: manda a su panel.
 *
 * Los demás motivos (`perfil-incompleto`, `sin-rol`, `error`) se dejan pasar
 * a propósito. Son estados que no tienen dónde mandar, y en la pantalla hay
 * un mensaje que explica qué pasa; expulsar de vuelta a la landing sólo
 * borraría ese aviso y dejaría a la persona sin saber por qué no entró.
 */
export const noAccesoGuard: CanActivateFn = async () => {
  const acceso = inject(AccesoService);
  const router = inject(Router);

  const estado = await acceso.leerEstado();

  if (estado.motivo !== 'ok') return true;

  const destino = acceso.destinoPara(estado.rol);
  if (!destino) return true;

  router.navigate([destino], { replaceUrl: true });
  return false;
};

import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { validarPassword } from '../../services/utils/validators';
import { PerfilCacheService } from '../../services/perfil-cache/perfil-cache.service';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

/**
 * Cambio de contraseña desde la web.
 *
 * La app lo hace con `supabase.auth.updateUser({ password })` usando la
 * sesión abierta, así que no necesita ninguna Edge Function: es exactamente
 * la misma llamada. Se pide la contraseña actual como en la app, con los
 * mismos mensajes y las mismas reglas de `validarPassword`.
 */
@Component({
  selector: 'app-cambiar-contrasena',
  templateUrl: 'cambiar-contrasena.page.html',
  styleUrls: ['cambiar-contrasena.page.scss'],
  imports: [WebNav, IonContent, FormsModule, RouterLink],
})
export class CambiarContrasenaPage {

  contrasenaActual = '';
  nuevaContrasena = '';
  confirmarContrasena = '';

  /** Mostrar/ocultar cada fila, igual que en la app. */
  mostrarActual = false;
  mostrarNueva = false;
  mostrarConfirmar = false;

  cargando = false;
  exito = '';

  /** Sólo una cosa falla a la vez: la primera regla que no se cumple. */
  error = '';
  recuperacionActiva = false;

  private cdr = inject(ChangeDetectorRef);
  private perfilCache = inject(PerfilCacheService);
  private supabaseService = inject(SupabaseService);

  constructor() {
    this.supabaseService.getClient().auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') {
        this.recuperacionActiva = true;
        this.refrescar();
      }
    });
  }

  async cambiar() {
    this.error = '';
    this.exito = '';

    if (!this.recuperacionActiva && !this.contrasenaActual.trim()) {
      this.error = 'Ingresa tu contraseña actual.';
      this.refrescar();
      return;
    }

    if (!this.nuevaContrasena) {
      this.error = 'Ingresa la nueva contraseña.';
      this.refrescar();
      return;
    }

    const resultado = validarPassword(this.nuevaContrasena);
    if (!resultado.valida) {
      this.error = resultado.mensaje || 'Contraseña no válida.';
      this.refrescar();
      return;
    }

    if (this.nuevaContrasena === this.contrasenaActual) {
      this.error = 'La nueva contraseña debe ser diferente a la actual.';
      this.refrescar();
      return;
    }

    if (this.nuevaContrasena !== this.confirmarContrasena) {
      this.error = 'Las contraseñas no coinciden.';
      this.refrescar();
      return;
    }

    if (this.cargando) return;

    this.cargando = true;
    this.refrescar();

    try {
      const { error } = await this.supabaseService.getClient()
        .auth
        .updateUser({ password: this.nuevaContrasena });

      if (error) {
        this.error = error.message || 'No se pudo actualizar la contraseña.';
        return;
      }

      // El navbar y los paneles no guardan la contraseña, pero el caché de
      // perfil sí se limpia por costumbre en toda operación de cuenta: así
      // nadie queda con datos de antes del cambio.
      this.perfilCache.limpiar();
      await this.registrarAuditoria();

      this.exito = 'Contraseña actualizada correctamente.';
      this.contrasenaActual = '';
      this.nuevaContrasena = '';
      this.confirmarContrasena = '';
      this.mostrarActual = false;
      this.mostrarNueva = false;
      this.mostrarConfirmar = false;
    } catch (e: any) {
      this.error = e?.message && !(e instanceof TypeError)
        ? e.message
        : 'Error de conexión. Intenta nuevamente.';
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

  /**
   * Va a la bitácora junto con los demás cambios de cuenta. La migración
   * que agrega `cambio_contrasena` a la lista permitida puede no estar
   * aplicada todavía; si falla, no se deshace un cambio que ya se hizo.
   */
  private async registrarAuditoria(): Promise<void> {
    try {
      await this.supabaseService.getClient()
        .rpc('registrar_evento_seguridad', {
          p_accion: 'cambio_contrasena',
          p_plataforma: 'web',
        });
    } catch {
      // La bitácora es una fila más, no el motivo para que falle el cambio.
    }
  }

  /**
   * La app corre SIN zone.js (zoneless): `markForCheck()` después de un
   * await deja la vista sin repintar hasta la siguiente vuelta del
   * programador, que a veces es hasta el próximo click. `detectChanges()`
   * repinta en el acto.
   */
  private refrescar() {
    this.cdr.detectChanges();
  }
}

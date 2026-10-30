import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { lockClosedOutline, mailOutline, eyeOutline, eyeOffOutline } from 'ionicons/icons';
import { Router, RouterLink } from '@angular/router';
import { AccesoService } from './acceso.service';

/**
 * Acceso de la web.
 *
 * Todo lo que esta pantalla necesita está en `web/acceso/`: su servicio, sus
 * guards y sus mensajes. No importa nada de `services/`, que es donde vive lo
 * de la app móvil.
 *
 * Es una pantalla de entrada a pantalla completa: no lleva el navbar de la
 * web, que es de las secciones del sitio y no de la puerta de entrar.
 *
 * Cualquier rol puede entrar. Lo que cambia adentro es adónde cae, y ese
 * reparto está en `AccesoService.destinoPara`.
 */
@Component({
  selector: 'app-acceso',
  templateUrl: 'acceso.page.html',
  styleUrls: ['acceso.page.scss'],
  imports: [FormsModule, RouterLink, IonContent, IonIcon, IonSpinner],
})
export class AccesoPage {

  correo = '';
  contrasena = '';

  cargando = false;

  /** Muestra la contraseña en claro mientras esté en `true`. */
  verContrasena = false;

  /** Mensaje bajo el formulario. Vacío mientras no haya nada que avisar. */
  mensajeError = '';

  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private acceso = inject(AccesoService);
  private alertCtrl = inject(AlertController);

  constructor() {
    addIcons({ mailOutline, lockClosedOutline, eyeOutline, eyeOffOutline });
  }

  alternarContrasena() {
    this.verContrasena = !this.verContrasena;
    this.refrescar();
  }

  async entrar() {
    this.mensajeError = '';
    this.refrescar();

    if (!this.correo.trim() || !this.contrasena) {
      await this.mostrarAlerta('Datos incompletos', 'Escribe tu correo y tu contraseña para continuar.');
      this.refrescar();
      return;
    }

    this.cargando = true;
    this.refrescar();

    try {
      await this.acceso.iniciarSesion(this.correo.trim(), this.contrasena);

      const estado = await this.acceso.leerEstado();

      switch (estado.motivo) {
        case 'ok': {
          const destino = this.acceso.destinoPara(estado.rol);
          if (destino) {
            this.router.navigate([destino], { replaceUrl: true });
            return;
          }
          await this.mostrarAlerta('No pudimos abrir tu cuenta', this.avisoDeRolDesconocido(estado.rol));
          break;
        }

        case 'perfil-incompleto':
          // En la app esto cae en `/elegir-tipo`, que en la web no existe:
          // no hay adónde mandar, sólo explicar dónde se termina.
          await this.mostrarAlerta(
            'Registro incompleto',
            'Tu registro aún no está terminado. Complétalo desde la app móvil y vuelve a ingresar.'
          );
          break;

        case 'sin-rol':
          await this.mostrarAlerta('Cuenta no disponible', this.avisoDeRolDesconocido(null));
          break;

        case 'sin-sesion':
          // La sesión se borró entre el `signInWithPassword` y la lectura.
          await this.mostrarAlerta('No se pudo iniciar sesión', 'No pudimos mantener tu sesión abierta. Inténtalo nuevamente.');
          break;

        case 'cuenta-inactiva':
          await this.mensajeCuentaDesactivada();
          break;

        case 'error':
          // La causa exacta ya está en la consola (la dejó `leerEstado`).
          await this.mostrarAlerta(
            'No pudimos verificar tu cuenta',
            'Ocurrió un problema temporal al verificar tu cuenta. Inténtalo nuevamente.'
          );
          break;
      }
    } catch (e) {
      const mensaje = this.acceso.mensajeDeError(e);
      if (mensaje.startsWith('Esta cuenta está desactivada.')) {
        await this.mensajeCuentaDesactivada();
      } else {
        await this.mostrarAlerta('No pudimos iniciar sesión', mensaje);
      }
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

  private avisoDeRolDesconocido(rol: string | null): string {
    const detalle = rol ? ` (${rol})` : '';
    console.warn(`[acceso] sin destino para el rol: ${rol ?? 'null'}`);
    return `No pudimos determinar el tipo de tu cuenta${detalle}. Escríbenos desde Contáctanos.`;
  }

  private async mensajeCuentaDesactivada(): Promise<void> {
    await this.mostrarAlerta(
      'Cuenta desactivada',
      'Esta cuenta está desactivada. Solicita ayuda a un administrador para volver a activarla.'
    );
  }

  private async mostrarAlerta(header: string, message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      cssClass: 'alerta-acceso',
      buttons: [{ text: 'Entendido', role: 'cancel' }]
    });

    await alert.present();
  }

  // La app corre SIN zone.js (zoneless): cambiar el estado después de un
  // await NO repinta la vista por sí solo.
  private refrescar() {
    this.cdr.markForCheck();
  }
}

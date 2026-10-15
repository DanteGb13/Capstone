import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonButton, IonInput, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  mailOutline,
  arrowBackOutline,
  keypadOutline,
  lockClosedOutline,
  checkmarkCircleOutline,
  sendOutline,
  eyeOutline,
  eyeOffOutline
} from 'ionicons/icons';
import { environment } from '../../../environments/environment';
import { validarEmail, validarPassword } from '../../services/utils/validators';

@Component({
  selector: 'app-recuperar-contrasena',
  templateUrl: './recuperar-contrasena.page.html',
  styleUrls: ['./recuperar-contrasena.page.scss'],
  imports: [CommonModule, FormsModule, IonContent, IonIcon, IonButton, IonInput, IonSpinner]
})
export class RecuperarContrasenaPage {

  paso: 'correo' | 'codigo' | 'contrasena' = 'correo';
  correo: string = '';
  codigoVerificacion: string = '';
  nuevaContrasena: string = '';
  confirmarContrasena: string = '';
  cargando: boolean = false;
  errorMensaje: string = '';
  exitoMensaje: string = '';

  mostrarContrasena: boolean = false;
  mostrarConfirmar: boolean = false;

  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({
      mailOutline, arrowBackOutline, keypadOutline,
      lockClosedOutline, checkmarkCircleOutline, sendOutline,
      eyeOutline, eyeOffOutline
    });
  }

  async enviarCodigo() {
    this.errorMensaje = '';
    this.exitoMensaje = '';

    if (!this.correo || this.correo.trim().length === 0) {
      this.errorMensaje = 'Ingresa tu correo electrónico.';
      return;
    }

    if (!validarEmail(this.correo)) {
      this.errorMensaje = 'Formato de correo no válido.';
      return;
    }

    this.cargando = true;

    try {
      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/enviar-codigo-recuperacion`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': environment.supabaseKey,
          },
          body: JSON.stringify({ correo: this.correo.trim() }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        this.errorMensaje = result.error || 'No se pudo enviar el código.';
        return;
      }

      this.paso = 'codigo';
      this.exitoMensaje = result.mensaje || 'Código enviado a tu correo.';
      this.cdr.detectChanges();

    } catch (error) {
      this.errorMensaje = 'Error de conexión. Intenta nuevamente.';
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  async verificarCodigo() {
    this.errorMensaje = '';
    this.exitoMensaje = '';

    const codigo = this.codigoVerificacion.trim();

    if (!codigo) {
      this.errorMensaje = 'Ingresa el código de verificación.';
      return;
    }

    if (!/^\d{6}$/.test(codigo)) {
      this.errorMensaje = 'El código debe tener 6 dígitos.';
      return;
    }

    this.cargando = true;

    try {
      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/verificar-codigo-recuperacion`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': environment.supabaseKey,
          },
          body: JSON.stringify({
            codigo,
            correo: this.correo.trim(),
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        this.errorMensaje = result.error || 'Código de verificación incorrecto.';
        return;
      }

      this.paso = 'contrasena';
      this.cdr.detectChanges();

    } catch (error) {
      this.errorMensaje = 'Error de conexión. Intenta nuevamente.';
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  async cambiarContrasena() {
    this.errorMensaje = '';
    this.exitoMensaje = '';

    if (!this.nuevaContrasena || this.nuevaContrasena.trim().length === 0) {
      this.errorMensaje = 'Ingresa la nueva contraseña.';
      return;
    }

    const resultado = validarPassword(this.nuevaContrasena);
    if (!resultado.valida) {
      this.errorMensaje = resultado.mensaje || 'Contraseña no válida.';
      return;
    }

    if (this.nuevaContrasena !== this.confirmarContrasena) {
      this.errorMensaje = 'Las contraseñas no coinciden.';
      return;
    }

    this.cargando = true;

    try {
      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/verificar-codigo-recuperacion`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': environment.supabaseKey,
          },
          body: JSON.stringify({
            codigo: this.codigoVerificacion.trim(),
            correo: this.correo.trim(),
            nueva_contrasena: this.nuevaContrasena,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        this.errorMensaje = result.error || 'No se pudo cambiar la contraseña.';
        return;
      }

      this.exitoMensaje = 'Contraseña actualizada correctamente. Serás redirigido al login...';
      this.cdr.detectChanges();

      setTimeout(() => {
        this.router.navigate(['/login'], { replaceUrl: true });
      }, 2500);

    } catch (error) {
      this.errorMensaje = 'Error de conexión. Intenta nuevamente.';
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  volver() {
    if (this.paso === 'correo') {
      this.router.navigate(['/login']);
    } else if (this.paso === 'codigo') {
      this.paso = 'correo';
      this.errorMensaje = '';
      this.exitoMensaje = '';
    } else {
      this.paso = 'codigo';
      this.errorMensaje = '';
      this.exitoMensaje = '';
    }
  }
}

import { Component } from '@angular/core';
import { IonButton, IonContent, IonIcon, IonInput } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';

import {
  arrowBackOutline,
  personOutline,
  callOutline,
  mailOutline,
  lockClosedOutline,
  logoGoogle
} from 'ionicons/icons';
import { registro } from '../../services/guards/registro/registro';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-registro',
  templateUrl: './registro.page.html',
  styleUrls: ['./registro.page.scss'],
  imports: [
    IonContent,
    IonButton,
    IonIcon,
    IonInput,
    FormsModule,
    RouterLink
  ]
})
export class RegistroPage {
  nombreCompleto: string = '';
  telefono: string = '';
  correo: string = '';
  contrasena: string = '';
  confirmarContrasena: string = '';

  tipoCuenta: 'Usuario' | 'Familiar' = 'Usuario';

  mensajeError: string = '';
  cargando: boolean = false;

  constructor(
    private registroService: registro
  ) {

    addIcons({
      arrowBackOutline,
      personOutline,
      callOutline,
      mailOutline,
      lockClosedOutline,
      logoGoogle
    });

  }

  seleccionarTipo(tipo: 'Usuario' | 'Familiar') {

    this.tipoCuenta = tipo;

  }

  async registrar() {

    this.mensajeError = '';

    if (
      !this.nombreCompleto ||
      !this.correo ||
      !this.contrasena
    ) {

      this.mensajeError =
        'Completa los campos obligatorios.';

      return;
    }

    if (
      this.contrasena !==
      this.confirmarContrasena
    ) {

      this.mensajeError =
        'Las contraseñas no coinciden.';

      return;
    }

    this.cargando = true;

    try {

      await this.registroService.registrarUsuario({

        nombreCompleto: this.nombreCompleto,

        telefono: this.telefono,

        correo: this.correo,

        contrasena: this.contrasena,

        tipoCuenta: this.tipoCuenta

      });

      console.log(
        'Usuario registrado como:',
        this.tipoCuenta
      );

    } catch (error: any) {

      console.error(
        'Error registrando usuario:',
        error
      );

      this.mensajeError =
        error?.message ||
        'No se pudo registrar el usuario.';

    } finally {

      this.cargando = false;

    }

  }

  async registrarConGoogle() {

    this.mensajeError = '';

    console.log(
      'Registrando con Google como:',
      this.tipoCuenta
    );

    try {

      await this.registroService.registrarConGoogle(
        this.tipoCuenta
      );

    } catch (error: any) {

      console.error(
        'Error registrando con Google:',
        error
      );

      this.mensajeError =
        error?.message ||
        'No se pudo registrar con Google.';

    }

  }
}
  
  

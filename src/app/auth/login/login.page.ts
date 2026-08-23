import { Component, OnInit } from '@angular/core';
import { IonButton, IonContent, IonIcon, IonInput } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { peopleOutline, logoGoogle } from 'ionicons/icons';
import { Login } from '../../services/guards/login/login';
import { SupabaseService } from '../../services/supabase/supabase';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    IonContent,
    IonIcon,
    IonInput,
    IonButton,
    FormsModule,
    RouterLink
  ]
})
export class LoginPage implements OnInit {

  correo: string = '';
  contrasena: string = '';
  mensajeError: string = '';
  cargando: boolean = false;

  constructor(
    private loginService: Login,
    private supabaseService: SupabaseService,
    private router: Router
  ) {
    addIcons({
      peopleOutline,
      logoGoogle
    });
  }

  // ==========================================
  // INICIO DE LA PÁGINA
  // ==========================================

  async ngOnInit() {
    // 1. Escuchar eventos de autenticación de Supabase (especialmente para retorno OAuth de Google)
    const supabase = this.supabaseService.getClient();

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await this.procesarSesionGoogle();
      }
    });

    // 2. Comprobar si ya hay una sesión activa o retorno de Google pendiente
    await this.procesarSesionGoogle();
  }

  private async procesarSesionGoogle() {
    const tipoCuenta = localStorage.getItem('tipo_cuenta_google');

    if (tipoCuenta === 'Usuario' || tipoCuenta === 'Familiar') {
      await this.completarRegistroGoogle(tipoCuenta);
      return;
    }

    // Si no hay registro pendiente, comprobar si el usuario acaba de autenticarse con Google
    try {
      const user = await this.loginService.obtenerUsuarioActual();
      if (user) {
        this.cargando = true;
        await this.redireccionarSegunRol();
      }
    } catch {
      // Si no hay sesión iniciada, el usuario permanece en el formulario de login normalmente
    } finally {
      this.cargando = false;
    }
  }


  // ==========================================
  // LOGIN CON CORREO Y CONTRASEÑA
  // ==========================================

  async ingresar() {

    this.mensajeError = '';


    // Validar campos

    if (
      !this.correo ||
      !this.contrasena
    ) {

      this.mensajeError =
        'Ingresa tu correo y contraseña.';

      return;

    }


    this.cargando = true;


    try {

      // ----------------------------------------
      // LOGIN EN SUPABASE
      // ----------------------------------------

      const data =
        await this.loginService.iniciarSesion(
          this.correo,
          this.contrasena
        );


      console.log(
        'Login exitoso:',
        data.user
      );


      // ----------------------------------------
      // REDIRECCIONAR SEGÚN ROL
      // ----------------------------------------

      await this.redireccionarSegunRol();


    } catch (error: any) {

      console.error(
        'Error iniciando sesión:',
        error
      );


      if (
        error?.message?.includes(
          'Invalid login credentials'
        )
      ) {

        this.mensajeError =
          'Correo o contraseña incorrectos.';

      } else {

        this.mensajeError =
          error?.message ||
          'No se pudo iniciar sesión.';

      }

    } finally {

      this.cargando = false;

    }

  }


  // ==========================================
  // LOGIN CON GOOGLE
  // ==========================================

  async ingresarConGoogle() {

    this.mensajeError = '';

    try {

      /*
       * Este método es SOLO para iniciar sesión
       * con una cuenta Google que ya existe.
       */

      await this.loginService.iniciarSesionGoogle();

    } catch (error: any) {

      console.error(
        'Error iniciando sesión con Google:',
        error
      );

      this.mensajeError =
        error?.message ||
        'No se pudo iniciar sesión con Google.';

    }

  }


  // ==========================================
  // COMPLETAR REGISTRO GOOGLE
  // ==========================================

  private async completarRegistroGoogle(
    tipoCuenta: 'Usuario' | 'Familiar'
  ) {

    this.cargando = true;

    try {

      console.log(
        'Completando registro Google como:',
        tipoCuenta
      );


      // ----------------------------------------
      // COMPLETAR REGISTRO
      // ----------------------------------------

      await this.loginService.completarRegistroGoogle(
        tipoCuenta
      );


      console.log(
        'Registro Google completado correctamente'
      );


      // ----------------------------------------
      // LIMPIAR TIPO DE CUENTA
      // ----------------------------------------

      localStorage.removeItem(
        'tipo_cuenta_google'
      );


      // ----------------------------------------
      // REDIRECCIONAR SEGÚN ROL
      // ----------------------------------------

      await this.redireccionarSegunRol();


    } catch (error: any) {

      console.error(
        'Error completando registro Google:',
        error
      );


      this.mensajeError =
        error?.message ||
        'No se pudo completar el registro.';


    } finally {

      this.cargando = false;

    }

  }


  // ==========================================
  // REDIRECCIÓN SEGÚN ROL
  // ==========================================

  private async redireccionarSegunRol() {

    try {

      // Obtener rol desde Supabase

      const rol =
        await this.loginService.obtenerRolUsuario();


      console.log(
        'Rol detectado:',
        rol
      );


      // ----------------------------------------
      // USUARIO
      // ----------------------------------------

      if (rol === 'Usuario') {

        console.log(
          'Redirigiendo a /home'
        );

        await this.router.navigate([
          '/adulto-mayor'
        ]);

        return;

      }


      // ----------------------------------------
      // FAMILIAR / CUIDADOR
      // ----------------------------------------

      if (rol === 'Familiar') {

        console.log(
          'Redirigiendo a /cuidador'
        );

        await this.router.navigate([
          '/cuidador'
        ]);

        return;

      }


      // ----------------------------------------
      // ROL DESCONOCIDO
      // ----------------------------------------

      throw new Error(
        `Rol no reconocido: ${rol}`
      );

    } catch (error) {

      console.error(
        'Error obteniendo rol:',
        error
      );

      throw error;

    }

  }

}
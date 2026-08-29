import { Component, OnInit } from '@angular/core';
import { IonButton, IonContent, IonIcon, IonInput, NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  peopleOutline,
  logoGoogle,
  mailOutline,
  lockClosedOutline,
  alertCircleOutline
} from 'ionicons/icons';
import { Login } from '../../services/guards/login/login';
import { SupabaseService } from '../../services/supabase/supabase';
import { validarEmail } from '../../services/utils/validators';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    IonContent,
    IonIcon,
    IonInput,
    IonButton,
    CommonModule,
    FormsModule,
    RouterLink
  ]
})
export class LoginPage implements OnInit {

  correo: string = '';
  contrasena: string = '';
  mensajeError: string = '';
  cargando: boolean = false;

  errores: {
    correo?: string;
    contrasena?: string;
  } = {};

  constructor(
    private loginService: Login,
    private supabaseService: SupabaseService,
    private router: Router,
    private navCtrl: NavController
  ) {
    addIcons({
      peopleOutline,
      logoGoogle,
      mailOutline,
      lockClosedOutline,
      alertCircleOutline
    });
  }

  // ==========================================
  // INICIO DE LA PÁGINA Y AUTO-LOGIN
  // ==========================================

  async ngOnInit() {
    const supabase = this.supabaseService.getClient();

    // 1. Comprobar retorno OAuth de Google
    const tipoCuenta = localStorage.getItem('tipo_cuenta_google');
    if (tipoCuenta === 'Usuario' || tipoCuenta === 'Familiar') {
      await this.completarRegistroGoogle(tipoCuenta);
      return;
    }

    // Si venimos de Google sin tipo elegido (cuenta nueva), derivar según
    // si ya existe el usuario en la BD o es la primera vez
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await this.derivarTrasGoogle();
      return;
    }

    // 2. Sin sesión aún: escuchar cambios de autenticación (p.ej. retorno OAuth)
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const tipoGoogle = localStorage.getItem('tipo_cuenta_google');
        if (tipoGoogle === 'Usuario' || tipoGoogle === 'Familiar') {
          await this.completarRegistroGoogle(tipoGoogle);
        } else {
          await this.derivarTrasGoogle();
        }
      }
    });
  }

  // ==========================================
  // VALIDACIONES DE LOGIN
  // ==========================================

  validarCorreo(): boolean {
    if (!this.correo || this.correo.trim().length === 0) {
      this.errores.correo = 'Ingresa tu correo electrónico.';
      return false;
    }
    if (!validarEmail(this.correo)) {
      this.errores.correo = 'Formato de correo no válido.';
      return false;
    }
    delete this.errores.correo;
    return true;
  }

  validarContrasena(): boolean {
    if (!this.contrasena || this.contrasena.trim().length === 0) {
      this.errores.contrasena = 'Ingresa tu contraseña.';
      return false;
    }
    delete this.errores.contrasena;
    return true;
  }

  // ==========================================
  // LOGIN CON CORREO Y CONTRASEÑA
  // ==========================================

  async ingresar() {
    this.mensajeError = '';

    const vEmail = this.validarCorreo();
    const vPass = this.validarContrasena();

    if (!vEmail || !vPass) {
      this.mensajeError = 'Por favor completa los campos correctamente.';
      return;
    }

    this.cargando = true;

    try {
      await this.loginService.iniciarSesion(
        this.correo.trim().toLowerCase(),
        this.contrasena
      );

      await this.redireccionarSegunRol();

    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';

      if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
        this.mensajeError = 'Correo o contraseña incorrectos. Por favor verifica tus datos.';
      } else if (msg.includes('email not confirmed')) {
        this.mensajeError = 'Debes confirmar tu correo electrónico antes de ingresar.';
      } else if (msg.includes('network') || msg.includes('fetch')) {
        this.mensajeError = 'Error de conexión. Comprueba tu acceso a internet.';
      } else {
        this.mensajeError = error?.message || 'No se pudo iniciar sesión. Inténtalo nuevamente.';
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
      await this.loginService.iniciarSesionGoogle();
    } catch (error: any) {
      this.mensajeError = error?.message || 'No se pudo conectar con Google.';
    }
  }

  // ==========================================
  // COMPLETAR REGISTRO GOOGLE
  // ==========================================

  private async completarRegistroGoogle(tipoCuenta: 'Usuario' | 'Familiar') {
    this.cargando = true;
    try {
      await this.loginService.completarRegistroGoogle(tipoCuenta);
      localStorage.removeItem('tipo_cuenta_google');
      await this.navCtrl.navigateRoot('/siguiente-paso', { replaceUrl: true });
    } catch (error: any) {
      this.mensajeError = error?.message || 'No se pudo completar el registro.';
    } finally {
      this.cargando = false;
    }
  }

  // ==========================================
  // REDIRECCIÓN SEGÚN ROL / ESTADO DE PERFIL
  // ==========================================

  /**
   * Para retornos de Google sin tipo preseleccionado:
   * - Si ya existe la fila 'usuario' -> perfil completo o a completar (siguiente-paso).
   * - Si NO existe (cuenta nueva) -> página para elegir Usuario/Familiar.
   */
  private async derivarTrasGoogle() {
    try {
      const supabase = this.supabaseService.getClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }

      const { data: usuario } = await supabase
        .from('usuario')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (usuario) {
        // Ya registrado: seguir flujo normal
        await this.redireccionarSegunRol();
      } else if (localStorage.getItem('datos_registro_temp')) {
        // Registro de correo ya iniciado: ir a completar perfil
        await this.redireccionarSegunRol();
      } else {
        // Cuenta nueva (ej. Google sin elegir tipo): preguntar el tipo
        this.navCtrl.navigateRoot('/elegir-tipo', { replaceUrl: true });
      }
    } catch {
      // Ante dudas, mandar a login
      this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  private async redireccionarSegunRol() {
    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        return;
      }

      const user = session.user;

      // Verificar perfil en tabla usuario
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

      // Si perfil incompleto -> enviar al siguiente paso
      if (!usuario || !usuario.rut || !usuario.id_direccion) {
        await this.navCtrl.navigateRoot('/siguiente-paso', { replaceUrl: true });
        return;
      }

      const rolData = usuario.rol as any;
      const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;

      if (rol === 'Familiar') {
        await this.navCtrl.navigateRoot('/cuidador', { replaceUrl: true });
      } else {
        await this.navCtrl.navigateRoot('/adulto-mayor', { replaceUrl: true });
      }

    } catch (error) {
      // Ignorar error y mantenerse en login si falla la consulta
    }
  }

}
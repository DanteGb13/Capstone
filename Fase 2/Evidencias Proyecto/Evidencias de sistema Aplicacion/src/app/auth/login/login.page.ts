import { ChangeDetectorRef, Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AlertController, IonButton, IonContent, IonIcon, IonInput, IonSpinner, NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
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
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';
import { validarEmail } from '../../services/utils/validators';
import { mensajeErrorApp } from '../../services/utils/mensaje-error';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    IonContent,
    IonIcon,
    IonInput,
    IonButton,
    IonSpinner,
    CommonModule,
    FormsModule,
    RouterLink
  ]
})
export class LoginPage implements OnInit, OnDestroy {

  correo: string = '';
  contrasena: string = '';
  mensajeError: string = '';
  cargando: boolean = false;
  private procesandoGoogle: boolean = false;
  private oauthSub?: Subscription;
  private authSub?: { unsubscribe: () => void };

  errores: {
    correo?: string;
    contrasena?: string;
  } = {};

  private cdr = inject(ChangeDetectorRef);
  private alertController = inject(AlertController);

  // La app corre SIN zone.js (zoneless): cambiar `mensajeError` o `cargando`
  // después de un await NO repinta la vista por sí solo, así que el error
  // quedaba invisible hasta que el usuario tocaba la pantalla.
  private refrescar() {
    this.cdr.markForCheck();
  }

  /** Alerta visible para errores del servidor (nunca texto técnico crudo). */
  private async alertaError(titulo: string, mensaje: string) {
    const alert = await this.alertController.create({
      header: titulo,
      message: mensaje,
      buttons: ['Entendido']
    });
    await alert.present();
  }

  constructor(
    private loginService: Login,
    private supabaseService: SupabaseService,
    private router: Router,
    private navCtrl: NavController,
    private navRol: NavegacionRolService
  ) {
    addIcons({
      peopleOutline,
      logoGoogle,
      mailOutline,
      lockClosedOutline,
      alertCircleOutline
    });
  }

  async ngOnInit() {
    const supabase = this.supabaseService.getClient();

    const tipoCuenta = localStorage.getItem('tipo_cuenta_google');
    if (tipoCuenta === 'Usuario' || tipoCuenta === 'Familiar') {
      await this.completarRegistroGoogle(tipoCuenta);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await this.derivarTrasGoogle();
      return;
    }

    this.oauthSub = this.supabaseService.oauthResult$.subscribe(async (res) => {
      if (!res) {
        return;
      }
      if (res.ok) {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (s?.user && !this.procesandoGoogle) {
          this.procesandoGoogle = true;
          await this.derivarTrasGoogle();
        }
      } else if (res.error) {
        await this.alertaError(
          'No se pudo iniciar con Google',
          mensajeErrorApp(res.error, 'No se pudo iniciar con Google.')
        );
        this.refrescar();
      }
    });

    const authResult = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const tipoGoogle = localStorage.getItem('tipo_cuenta_google');
        if (tipoGoogle === 'Usuario' || tipoGoogle === 'Familiar') {
          await this.completarRegistroGoogle(tipoGoogle);
        } else if (!this.procesandoGoogle) {
          this.procesandoGoogle = true;
          await this.derivarTrasGoogle();
        }
      }
    });
    this.authSub = authResult.data.subscription;
  }

  ngOnDestroy() {
    this.oauthSub?.unsubscribe();
    this.authSub?.unsubscribe();
  }

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

    } catch (error) {
      console.error('Error iniciando sesión:', error);
      await this.alertaError(
        'No se pudo iniciar sesión',
        mensajeErrorApp(error, 'No se pudo iniciar sesión. Inténtalo nuevamente.')
      );
      this.refrescar();
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

  async ingresarConGoogle() {
    this.mensajeError = '';
    try {
      await this.loginService.iniciarSesionGoogle();
    } catch (error) {
      console.error('Error con Google:', error);
      await this.alertaError(
        'No se pudo conectar con Google',
        mensajeErrorApp(error, 'No se pudo conectar con Google.')
      );
      this.refrescar();
    }
  }

  private async completarRegistroGoogle(tipoCuenta: 'Usuario' | 'Familiar') {
    this.cargando = true;
    try {
      await this.loginService.completarRegistroGoogle(tipoCuenta);
      localStorage.removeItem('tipo_cuenta_google');
      this.navRol.limpiarCache();
      await this.navCtrl.navigateRoot('/siguiente-paso', { replaceUrl: true });
    } catch (error) {
      console.error('Error completando registro con Google:', error);
      await this.alertaError(
        'No se pudo completar el registro',
        mensajeErrorApp(error, 'No se pudo completar el registro.')
      );
      this.refrescar();
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

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
        await this.redireccionarSegunRol();
      } else if (localStorage.getItem('datos_registro_temp')) {
        await this.redireccionarSegunRol();
      } else {
        this.navCtrl.navigateRoot('/elegir-tipo', { replaceUrl: true });
      }
    } catch {
      this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  private async redireccionarSegunRol() {
    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        // Sin sesión no hay a dónde redirigir: se avisa y se puede reintentar.
        this.mensajeError =
          'No se pudo confirmar tu sesión. Intenta entrar de nuevo.';
        this.refrescar();
        return;
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

      const rolData = usuario?.rol as any;
      const rolNombre = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;

      // El administrador entra a su panel antes de mirar si el perfil está
      // completo: `/elegir-tipo` pregunta "¿eres Usuario o Familiar?", pregunta
      // que no tiene sentido para alguien que ya tiene rol de Administrador.
      if (rolNombre === 'Administrador' && Capacitor.isNativePlatform()) {
        this.mensajeError =
          'Esta cuenta es de administracion y se usa desde la web. En la app no hay pantallas para ella.';
        await this.loginService.cerrarSesion();
        this.refrescar();
        return;
      }

      if (rolNombre === 'Administrador') {
        this.navRol.limpiarCache();
        await this.navCtrl.navigateRoot('/panel-control', { replaceUrl: true });
        return;
      }

      if (!usuario || !usuario.rut || !usuario.id_direccion) {
        // Registro incompleto → siempre elegir Usuario / Familiar.
        await this.navCtrl.navigateRoot('/elegir-tipo', { replaceUrl: true });
        return;
      }

      this.navRol.limpiarCache();
      await this.navCtrl.navigateRoot(this.navRol.rutaPrincipal(rolNombre), { replaceUrl: true });

    } catch (error) {
      // Antes el catch estaba vacío: si fallaba la consulta del rol, la
      // pantalla quedaba en blanco (sin mensaje y sin navegación).
      console.error('Error decidiendo a dónde entrar:', error);
      this.mensajeError =
        'No se pudo abrir tu cuenta. Revisa tu conexión e intenta de nuevo.';
      this.refrescar();
    }
  }

}

import { ChangeDetectorRef, Component, OnInit, OnDestroy, inject } from '@angular/core';
import { IonButton, IonContent, IonIcon, IonInput, IonSpinner, NavController } from '@ionic/angular';
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

  // La app corre SIN zone.js (zoneless): cambiar `mensajeError` o `cargando`
  // después de un await NO repinta la vista por sí solo, así que el error
  // quedaba invisible hasta que el usuario tocaba la pantalla.
  private refrescar() {
    this.cdr.markForCheck();
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
        this.mensajeError = 'No se pudo iniciar con Google: ' + res.error;
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
    } catch (error: any) {
      this.mensajeError = error?.message || 'No se pudo conectar con Google.';
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
    } catch (error: any) {
      this.mensajeError = error?.message || 'No se pudo completar el registro.';
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

      if (!usuario || !usuario.rut || !usuario.id_direccion) {
        // Registro incompleto → siempre elegir Usuario / Familiar.
        await this.navCtrl.navigateRoot('/elegir-tipo', { replaceUrl: true });
        return;
      }

      this.navRol.limpiarCache();
      await this.navCtrl.navigateRoot(this.navRol.rutaPrincipal(rolNombre), { replaceUrl: true });

    } catch (error) {
    }
  }

}

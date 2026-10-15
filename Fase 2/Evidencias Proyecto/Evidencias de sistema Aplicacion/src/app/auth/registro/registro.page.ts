import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonButton, IonContent, IonIcon, IonInput, IonSpinner, NavController } from '@ionic/angular';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  arrowForwardOutline,
  personOutline,
  callOutline,
  mailOutline,
  lockClosedOutline,
  logoGoogle,
  alertCircleOutline,
  checkmarkCircleOutline
} from 'ionicons/icons';
import { registro } from '../../services/guards/registro/registro';
import { Login } from '../../services/guards/login/login';
import { SupabaseService } from '../../services/supabase/supabase';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';
import {
  validarNombreOApellido,
  validarEmail,
  validarPassword,
  validarTelefonoChileno,
  formatearTelefonoChileno
} from '../../services/utils/validators';

@Component({
  selector: 'app-registro',
  templateUrl: './registro.page.html',
  styleUrls: ['./registro.page.scss'],
  imports: [
    IonContent,
    IonButton,
    IonIcon,
    IonInput,
    IonSpinner,
    CommonModule,
    FormsModule,
    RouterLink
  ]
})
export class RegistroPage implements OnInit, OnDestroy {
  nombreCompleto: string = '';
  telefono: string = '';
  correo: string = '';
  contrasena: string = '';
  confirmarContrasena: string = '';

  tipoCuenta: 'Usuario' | 'Familiar' = 'Usuario';

  mensajeError: string = '';
  mensajeExito: string = '';
  cargando: boolean = false;
  private procesandoGoogle: boolean = false;
  private oauthSub?: Subscription;
  private authSub?: { unsubscribe: () => void };

  // Errores específicos por campo
  errores: {
    nombreCompleto?: string;
    telefono?: string;
    correo?: string;
    contrasena?: string;
    confirmarContrasena?: string;
  } = {};

  formularioIntentado: boolean = false;

  // =====================================================
  // PASOS DEL FORMULARIO
  // =====================================================

  /**
   * El formulario va en 2 pasos en vez de los 5 campos de una vez.
   *
   * Motivo, más allá de que se vea mejor: una pantalla larga con 5 campos es la
   * que más se abandona a la mitad, sobre todo en la primera vez que entra
   * alguien. En el segundo paso el botón "Continuar" además actúa como disparador
   * de la validación de los campos del primero, así que no se avanza con datos
   * malos.
   */
  readonly pasos = [
    { titulo: 'Sobre ti', campos: ['nombreCompleto', 'telefono'] as const },
    { titulo: 'Tu acceso', campos: ['correo', 'contrasena', 'confirmarContrasena'] as const }
  ];

  pasoActual = 0;

  get pasoActualInfo() {
    return this.pasos[this.pasoActual];
  }

  get esUltimoPaso(): boolean {
    return this.pasoActual === this.pasos.length - 1;
  }

  /** Nombre corto del paso, para el indicador de progreso. */
  get etiquetaProgreso(): string {
    return `Paso ${this.pasoActual + 1} de ${this.pasos.length}`;
  }

  /** Avanza al siguiente paso, validando primero los campos del actual. */
  async siguientePaso(): Promise<void> {
    (document.activeElement as HTMLElement)?.blur();

    if (!this.validarPasoActual()) {
      return;
    }

    this.pasoActual = Math.min(this.pasoActual + 1, this.pasos.length - 1);
  }

  pasoAnterior(): void {
    (document.activeElement as HTMLElement)?.blur();
    this.pasoActual = Math.max(this.pasoActual - 1, 0);
  }

  /** Valida sólo los campos del paso visible. */
  private validarPasoActual(): boolean {
    const campos = this.pasoActualInfo.campos;

    if (campos.includes('nombreCompleto' as never)) this.validarCampoNombre();
    if (campos.includes('telefono' as never)) this.validarCampoTelefono();
    if (campos.includes('correo' as never)) this.validarCampoCorreo();
    if (campos.includes('contrasena' as never)) this.validarCampoContrasena();
    if (campos.includes('confirmarContrasena' as never)) this.validarCampoConfirmar();

    // Se recorren los errores del paso: si hay alguno, no se avanza.
    return !campos.some((campo) => !!this.errores[campo]);
  }

  constructor(
    private registroService: registro,
    private loginService: Login,
    private supabaseService: SupabaseService,
    private router: Router,
    private navCtrl: NavController,
    private navRol: NavegacionRolService
  ) {
    addIcons({
      arrowBackOutline,
      arrowForwardOutline,
      personOutline,
      callOutline,
      mailOutline,
      lockClosedOutline,
      logoGoogle,
      alertCircleOutline,
      checkmarkCircleOutline
    });
  }

  async ngOnInit() {
    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        const { data: usuario } = await supabase
          .from('usuario')
          .select('id, rut, id_direccion, rol(nombre)')
          .eq('id', session.user.id)
          .maybeSingle();

        if (usuario && usuario.rut && usuario.id_direccion) {
          const rolData = usuario.rol as any;
          const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;
          this.navRol.limpiarCache();
          await this.navCtrl.navigateRoot(this.navRol.rutaPrincipal(rol), { replaceUrl: true });
        } else {
          // Perfil incompleto → siempre elegir Usuario / Familiar
          await this.navCtrl.navigateRoot('/elegir-tipo', { replaceUrl: true });
        }
        return;
      }
    } catch {
      // Continuar en registro
    }

    // Reaccionar al retorno de Google OAuth (deep link en móvil)
    const tipoGoogle = localStorage.getItem('tipo_cuenta_google');
    if (tipoGoogle === 'Usuario' || tipoGoogle === 'Familiar') {
      await this.completarRegistroGoogle(tipoGoogle);
      return;
    }

    this.oauthSub = this.supabaseService.oauthResult$.subscribe(async (res) => {
      if (!res) {
        return;
      }
      if (res.ok) {
        const { data: { session: s } } = await this.supabaseService.getClient().auth.getSession();
        const tipo = this.obtenerTipoGoogle();
        if (s?.user && tipo && !this.procesandoGoogle) {
          await this.completarRegistroGoogle(tipo);
        }
      } else if (res.error) {
        this.mensajeError = 'No se pudo registrar con Google: ' + res.error;
      }
    });

    const authResult = this.supabaseService.getClient().auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const tipo = this.obtenerTipoGoogle();
        if (tipo && !this.procesandoGoogle) {
          await this.completarRegistroGoogle(tipo);
        }
      }
    });
    this.authSub = authResult.data.subscription;
  }

  ngOnDestroy() {
    this.oauthSub?.unsubscribe();
    this.authSub?.unsubscribe();
  }

  private obtenerTipoGoogle(): 'Usuario' | 'Familiar' | null {
    const tipo = localStorage.getItem('tipo_cuenta_google');
    if (tipo === 'Usuario' || tipo === 'Familiar') {
      return tipo;
    }
    return null;
  }

  private async completarRegistroGoogle(tipoCuenta: 'Usuario' | 'Familiar') {
    this.cargando = true;
    this.procesandoGoogle = true;
    try {
      await this.loginService.completarRegistroGoogle(tipoCuenta);
      localStorage.removeItem('tipo_cuenta_google');
      this.navRol.limpiarCache();
      await this.navCtrl.navigateRoot('/siguiente-paso', { replaceUrl: true });
    } catch (error: any) {
      this.procesandoGoogle = false;
      this.mensajeError = error?.message || 'No se pudo completar el registro con Google.';
    } finally {
      this.cargando = false;
    }
  }

  // Validación en tiempo real del campo Nombre Completo
  validarCampoNombre() {
    if (!this.nombreCompleto || this.nombreCompleto.trim().length === 0) {
      this.errores.nombreCompleto = 'El nombre completo es obligatorio.';
      return false;
    }
    if (!validarNombreOApellido(this.nombreCompleto)) {
      this.errores.nombreCompleto = 'No se permiten números ni símbolos (solo letras y tildes).';
      return false;
    }
    const palabras = this.nombreCompleto.trim().split(/\s+/);
    if (palabras.length < 2) {
      this.errores.nombreCompleto = 'Ingresa al menos un nombre y un apellido.';
      return false;
    }
    delete this.errores.nombreCompleto;
    return true;
  }

  // Validación y formateo del Teléfono Chileno
  validarCampoTelefono() {
    if (!this.telefono || this.telefono.trim().length === 0) {
      this.errores.telefono = 'El teléfono es obligatorio.';
      return false;
    }
    if (!validarTelefonoChileno(this.telefono)) {
      this.errores.telefono = 'Ingresa un número chileno válido (9 dígitos, ej: 912345678).';
      return false;
    }
    delete this.errores.telefono;
    return true;
  }

  formatearTelefonoEnBlur() {
    if (this.telefono && validarTelefonoChileno(this.telefono)) {
      this.telefono = formatearTelefonoChileno(this.telefono);
    }
    this.validarCampoTelefono();
  }

  // Validación del Correo Electrónico
  validarCampoCorreo() {
    if (!this.correo || this.correo.trim().length === 0) {
      this.errores.correo = 'El correo electrónico es obligatorio.';
      return false;
    }
    if (!validarEmail(this.correo)) {
      this.errores.correo = 'Ingresa un correo electrónico válido (ej: nombre@ejemplo.com).';
      return false;
    }
    delete this.errores.correo;
    return true;
  }

  // Validación de Contraseña
  validarCampoContrasena() {
    const res = validarPassword(this.contrasena);
    if (!res.valida) {
      this.errores.contrasena = res.mensaje;
      return false;
    }
    delete this.errores.contrasena;

    // Si ya escribió confirmación, revalidar coincidencia
    if (this.confirmarContrasena) {
      this.validarCampoConfirmar();
    }
    return true;
  }

  // Validación de Confirmar Contraseña
  validarCampoConfirmar() {
    if (!this.confirmarContrasena) {
      this.errores.confirmarContrasena = 'Debes confirmar tu contraseña.';
      return false;
    }
    if (this.contrasena !== this.confirmarContrasena) {
      this.errores.confirmarContrasena = 'Las contraseñas no coinciden.';
      return false;
    }
    delete this.errores.confirmarContrasena;
    return true;
  }

  validarTodoElFormulario(): boolean {
    this.formularioIntentado = true;
    const vNombre = this.validarCampoNombre();
    const vTel = this.validarCampoTelefono();
    const vCorreo = this.validarCampoCorreo();
    const vPass = this.validarCampoContrasena();
    const vConf = this.validarCampoConfirmar();

    return vNombre && vTel && vCorreo && vPass && vConf;
  }

  async registrar() {
    this.mensajeError = '';
    this.mensajeExito = '';

    if (!this.validarTodoElFormulario()) {
      this.mensajeError = 'Por favor corrige los campos marcados en rojo antes de continuar.';
      return;
    }

    this.cargando = true;

    try {
      // Limpiar teléfono antes de enviar a BD
      const telLimpio = this.telefono.replace(/[\s\-\+]/g, '');

      await this.registroService.registrarUsuario({
        nombreCompleto: this.nombreCompleto.trim(),
        telefono: telLimpio,
        correo: this.correo.trim().toLowerCase(),
        contrasena: this.contrasena,
        tipoCuenta: this.tipoCuenta
      });

      // Si Supabase exige confirmar el correo, el signUp NO crea sesión.
      // Ir a /elegir-tipo (que exige sesión) haría que esa pantalla nos
      // devuelva al login y se percibe como "la app me saca sola".
      const { data: { session } } = await this.supabaseService.getClient().auth.getSession();

      if (session?.user) {
        // Redirigir a la pantalla de elección de rol (el tipo se elige ahí)
        await this.navCtrl.navigateRoot('/elegir-tipo', { replaceUrl: true });
      } else {
        this.mensajeExito =
          'Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.';
      }

    } catch (error: any) {
      if (error?.message?.includes('User already registered') || error?.message?.includes('already exists')) {
        this.mensajeError = 'Este correo electrónico ya está registrado. Intenta iniciar sesión.';
      } else if (error?.message?.includes('Password should be')) {
        this.mensajeError = 'La contraseña debe tener al menos 8 caracteres, una mayúscula, un número y un carácter especial.';
      } else {
        this.mensajeError = error?.message || 'No se pudo registrar el usuario. Revisa tu conexión.';
      }
    } finally {
      this.cargando = false;
    }
  }

  async registrarConGoogle() {
    this.mensajeError = '';
    try {
      await this.registroService.registrarConGoogle();
    } catch (error: any) {
      this.mensajeError = error?.message || 'No se pudo conectar con Google.';
    }
  }
}

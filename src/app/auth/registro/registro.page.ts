import { Component, OnInit } from '@angular/core';
import { IonButton, IonContent, IonIcon, IonInput, NavController } from '@ionic/angular';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  personOutline,
  callOutline,
  mailOutline,
  lockClosedOutline,
  logoGoogle,
  alertCircleOutline
} from 'ionicons/icons';
import { registro } from '../../services/guards/registro/registro';
import { SupabaseService } from '../../services/supabase/supabase';
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
    CommonModule,
    FormsModule,
    RouterLink
  ]
})
export class RegistroPage implements OnInit {
  nombreCompleto: string = '';
  telefono: string = '';
  correo: string = '';
  contrasena: string = '';
  confirmarContrasena: string = '';

  tipoCuenta: 'Usuario' | 'Familiar' = 'Usuario';

  mensajeError: string = '';
  cargando: boolean = false;

  // Errores específicos por campo
  errores: {
    nombreCompleto?: string;
    telefono?: string;
    correo?: string;
    contrasena?: string;
    confirmarContrasena?: string;
  } = {};

  formularioIntentado: boolean = false;

  constructor(
    private registroService: registro,
    private supabaseService: SupabaseService,
    private router: Router,
    private navCtrl: NavController
  ) {
    addIcons({
      arrowBackOutline,
      personOutline,
      callOutline,
      mailOutline,
      lockClosedOutline,
      logoGoogle,
      alertCircleOutline
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
          if (rol === 'Familiar') {
            await this.navCtrl.navigateRoot('/cuidador', { replaceUrl: true });
          } else {
            await this.navCtrl.navigateRoot('/adulto-mayor', { replaceUrl: true });
          }
        } else {
          await this.navCtrl.navigateRoot('/siguiente-paso', { replaceUrl: true });
        }
      }
    } catch {
      // Continuar en registro
    }
  }

  seleccionarTipo(tipo: 'Usuario' | 'Familiar') {
    this.tipoCuenta = tipo;
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

      // Redirigir al siguiente paso impidiendo el retroceso al paso de registro
      await this.navCtrl.navigateRoot('/siguiente-paso', { replaceUrl: true });

    } catch (error: any) {
      if (error?.message?.includes('User already registered') || error?.message?.includes('already exists')) {
        this.mensajeError = 'Este correo electrónico ya está registrado. Intenta iniciar sesión.';
      } else if (error?.message?.includes('Password should be')) {
        this.mensajeError = 'La contraseña debe tener al menos 6 caracteres y números.';
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
      await this.registroService.registrarConGoogle(this.tipoCuenta);
    } catch (error: any) {
      this.mensajeError = error?.message || 'No se pudo conectar con Google.';
    }
  }
}

import { Component, OnInit } from '@angular/core';
import {
  IonContent,
  IonButton,
  IonIcon,
  IonInput,
  IonModal,
  IonDatetime,
  NavController
} from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  cardOutline,
  calendarOutline,
  personOutline,
  callOutline,
  locationOutline,
  homeOutline,
  mapOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  closeOutline
} from 'ionicons/icons';
import { registro } from '../../services/guards/registro/registro';
import { SupabaseService } from '../../services/supabase/supabase';
import {
  validarNombreOApellido,
  validarRutChileno,
  formatearRut,
  validarTelefonoChileno,
  formatearTelefonoChileno,
  validarFechaNacimiento,
  validarTextoBasico
} from '../../services/utils/validators';

@Component({
  selector: 'app-siguiente-paso',
  templateUrl: './siguiente-paso.page.html',
  styleUrls: ['./siguiente-paso.page.scss'],
  imports: [
    IonContent,
    IonButton,
    IonIcon,
    IonInput,
    IonModal,
    IonDatetime,
    CommonModule,
    FormsModule
  ]
})
export class SiguientePasoPage implements OnInit {

  // Datos personales
  nombre: string = '';
  apellidopa: string = '';
  apellidoma: string = '';
  rut: string = '';
  fechaNacimiento: string = '';
  telefono: string = '';

  // Datos de dirección
  region: string = '';
  comuna: string = '';
  calle: string = '';
  numero: string = '';

  tipoCuenta: 'Usuario' | 'Familiar' = 'Usuario';
  mensajeError: string = '';
  cargando: boolean = false;

  // Control modal de fecha para móvil
  mostrarModalFecha: boolean = false;
  fechaMaxima: string = new Date().toISOString();

  // Errores por campo
  errores: {
    rut?: string;
    fechaNacimiento?: string;
    nombre?: string;
    apellidopa?: string;
    apellidoma?: string;
    telefono?: string;
    region?: string;
    comuna?: string;
    calle?: string;
    numero?: string;
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
      cardOutline,
      calendarOutline,
      personOutline,
      callOutline,
      locationOutline,
      homeOutline,
      mapOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      closeOutline
    });
  }

  async ngOnInit() {
    // 1. Verificar sesión activa
    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        // No hay sesión -> no puede estar en siguiente-paso
        await this.navCtrl.navigateRoot('/login', { replaceUrl: true });
        return;
      }

      const user = session.user;

      // 2. Verificar si el usuario ya tiene su perfil completo en la BD
      const { data: usuario } = await supabase
        .from('usuario')
        .select(`
          id,
          nombre,
          apellidopa,
          apellidoma,
          telefono,
          rut,
          fecha_nacimiento,
          id_direccion,
          id_rol,
          rol (
            id,
            nombre
          )
        `)
        .eq('id', user.id)
        .maybeSingle();

      if (usuario && usuario.rut && usuario.id_direccion) {
        // Si el perfil ya está completo, redirigir a su pantalla principal sin dejarlo en siguiente-paso
        const rolData = usuario.rol as any;
        const rolNombre = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;
        if (rolNombre === 'Familiar') {
          await this.navCtrl.navigateRoot('/cuidador', { replaceUrl: true });
        } else {
          await this.navCtrl.navigateRoot('/adulto-mayor', { replaceUrl: true });
        }
        return;
      }

      // 3. Precargar datos temporales o de la sesión existente si el perfil aún está incompleto
      const datosTemp = this.registroService.obtenerDatosRegistroTemporal();
      if (datosTemp) {
        if (datosTemp.nombreCompleto) {
          this.desglosarNombre(datosTemp.nombreCompleto);
        }
        if (datosTemp.telefono) {
          this.telefono = datosTemp.telefono;
        }
        if (datosTemp.tipoCuenta) {
          this.tipoCuenta = datosTemp.tipoCuenta;
        }
      }

      if (!this.nombre) {
        const fullName =
          user.user_metadata?.['full_name'] ||
          user.user_metadata?.['name'] ||
          '';
        if (fullName) {
          this.desglosarNombre(fullName);
        }
      }

      if (usuario) {
        if (usuario.nombre && !this.nombre) this.nombre = usuario.nombre;
        if (usuario.apellidopa && !this.apellidopa) this.apellidopa = usuario.apellidopa;
        if (usuario.apellidoma && !this.apellidoma) this.apellidoma = usuario.apellidoma;
        if (usuario.telefono && !this.telefono) this.telefono = usuario.telefono;
        if (usuario.rut && !this.rut) this.rut = usuario.rut;
        if (usuario.fecha_nacimiento && !this.fechaNacimiento) this.fechaNacimiento = usuario.fecha_nacimiento;

        const rolData = usuario.rol as any;
        const rolNombre = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;
        if (rolNombre === 'Usuario' || rolNombre === 'Familiar') {
          this.tipoCuenta = rolNombre;
        }
      }

    } catch {
      // Permanecer en la vista para completar datos
    }
  }

  private desglosarNombre(nombreCompleto: string) {
    const partes = nombreCompleto.trim().split(/\s+/).filter(p => p.length > 0);
    if (partes.length === 1) {
      this.nombre = partes[0];
    } else if (partes.length === 2) {
      this.nombre = partes[0];
      this.apellidopa = partes[1];
    } else if (partes.length >= 3) {
      this.nombre = partes[0];
      this.apellidopa = partes[1];
      this.apellidoma = partes.slice(2).join(' ');
    }
  }

  // Validaciones de Datos Personales
  validarCampoRut() {
    if (!this.rut || this.rut.trim().length === 0) {
      this.errores.rut = 'El RUT es obligatorio.';
      return false;
    }
    if (!validarRutChileno(this.rut)) {
      this.errores.rut = 'RUT inválido. Verifica número y dígito verificador.';
      return false;
    }
    delete this.errores.rut;
    return true;
  }

  formatearRutEnBlur() {
    if (this.rut) {
      this.rut = formatearRut(this.rut);
    }
    this.validarCampoRut();
  }

  validarCampoFecha() {
    if (!this.fechaNacimiento) {
      this.errores.fechaNacimiento = 'La fecha de nacimiento es obligatoria.';
      return false;
    }
    if (!validarFechaNacimiento(this.fechaNacimiento)) {
      this.errores.fechaNacimiento = 'Ingresa una fecha válida en el pasado.';
      return false;
    }
    delete this.errores.fechaNacimiento;
    return true;
  }

  abrirSelectorFecha() {
    this.mostrarModalFecha = true;
  }

  cerrarSelectorFecha() {
    this.mostrarModalFecha = false;
    this.validarCampoFecha();
  }

  onFechaSeleccionada(event: any) {
    const valor = event.detail.value;
    if (valor) {
      // Formato YYYY-MM-DD
      this.fechaNacimiento = valor.split('T')[0];
      this.validarCampoFecha();
    }
  }

  get fechaFormateada(): string {
    if (!this.fechaNacimiento) return '';
    try {
      const partes = this.fechaNacimiento.split('-');
      if (partes.length === 3) {
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
      }
      return this.fechaNacimiento;
    } catch {
      return this.fechaNacimiento;
    }
  }

  validarCampoNombre() {
    if (!this.nombre || this.nombre.trim().length === 0) {
      this.errores.nombre = 'El nombre es obligatorio.';
      return false;
    }
    if (!validarNombreOApellido(this.nombre)) {
      this.errores.nombre = 'Solo se permiten letras y tildes (sin números ni símbolos).';
      return false;
    }
    delete this.errores.nombre;
    return true;
  }

  validarCampoApellidoPaterno() {
    if (!this.apellidopa || this.apellidopa.trim().length === 0) {
      this.errores.apellidopa = 'El apellido paterno es obligatorio.';
      return false;
    }
    if (!validarNombreOApellido(this.apellidopa)) {
      this.errores.apellidopa = 'Solo se permiten letras y tildes.';
      return false;
    }
    delete this.errores.apellidopa;
    return true;
  }

  validarCampoApellidoMaterno() {
    if (this.apellidoma && this.apellidoma.trim().length > 0) {
      if (!validarNombreOApellido(this.apellidoma)) {
        this.errores.apellidoma = 'Solo se permiten letras y tildes.';
        return false;
      }
    }
    delete this.errores.apellidoma;
    return true;
  }

  validarCampoTelefono() {
    if (!this.telefono || this.telefono.trim().length === 0) {
      this.errores.telefono = 'El teléfono es obligatorio.';
      return false;
    }
    if (!validarTelefonoChileno(this.telefono)) {
      this.errores.telefono = 'Ingresa un número chileno de 9 dígitos (ej: 912345678).';
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

  // Validaciones de Dirección
  validarCampoRegion() {
    if (!validarTextoBasico(this.region, 2)) {
      this.errores.region = 'Ingresa una región válida.';
      return false;
    }
    delete this.errores.region;
    return true;
  }

  validarCampoComuna() {
    if (!validarTextoBasico(this.comuna, 2)) {
      this.errores.comuna = 'Ingresa una comuna válida.';
      return false;
    }
    delete this.errores.comuna;
    return true;
  }

  validarCampoCalle() {
    if (!validarTextoBasico(this.calle, 3)) {
      this.errores.calle = 'Ingresa el nombre de la calle / pasaje (mínimo 3 letras).';
      return false;
    }
    delete this.errores.calle;
    return true;
  }

  validarCampoNumero() {
    if (!validarTextoBasico(this.numero, 1)) {
      this.errores.numero = 'Ingresa el número o depto.';
      return false;
    }
    delete this.errores.numero;
    return true;
  }

  validarFormularioCompleto(): boolean {
    this.formularioIntentado = true;
    const vRut = this.validarCampoRut();
    const vFecha = this.validarCampoFecha();
    const vNom = this.validarCampoNombre();
    const vApeP = this.validarCampoApellidoPaterno();
    const vApeM = this.validarCampoApellidoMaterno();
    const vTel = this.validarCampoTelefono();
    const vReg = this.validarCampoRegion();
    const vCom = this.validarCampoComuna();
    const vCal = this.validarCampoCalle();
    const vNum = this.validarCampoNumero();

    return vRut && vFecha && vNom && vApeP && vApeM && vTel && vReg && vCom && vCal && vNum;
  }

  async guardarYContinuar() {
    this.mensajeError = '';

    if (!this.validarFormularioCompleto()) {
      this.mensajeError = 'Por favor completa y corrige los campos señalados en rojo.';
      return;
    }

    this.cargando = true;

    try {
      const telLimpio = this.telefono.replace(/[\s\-\+]/g, '');

      const resultado = await this.registroService.completarPerfilUsuario({
        nombre: this.nombre.trim(),
        apellidopa: this.apellidopa.trim(),
        apellidoma: this.apellidoma.trim(),
        rut: this.rut.trim(),
        fechaNacimiento: this.fechaNacimiento,
        telefono: telLimpio,
        region: this.region.trim(),
        comuna: this.comuna.trim(),
        calle: this.calle.trim(),
        numero: this.numero.trim(),
        tipoCuenta: this.tipoCuenta
      });

      // Redirección segura según rol impidiendo volver atrás al formulario
      if (resultado.tipoCuenta === 'Usuario') {
        await this.navCtrl.navigateRoot('/adulto-mayor', { replaceUrl: true });
      } else if (resultado.tipoCuenta === 'Familiar') {
        await this.navCtrl.navigateRoot('/cuidador', { replaceUrl: true });
      } else {
        await this.navCtrl.navigateRoot('/adulto-mayor', { replaceUrl: true });
      }

    } catch (error: any) {
      this.mensajeError = error?.message || 'No se pudieron guardar los datos. Inténtalo de nuevo.';
    } finally {
      this.cargando = false;
    }
  }

}

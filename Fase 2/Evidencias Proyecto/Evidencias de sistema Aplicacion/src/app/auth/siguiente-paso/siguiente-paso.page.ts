import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import {
  IonContent,
  IonButton,
  IonIcon,
  IonInput,
  IonModal,
  IonDatetime,
  IonSelect,
  IonSelectOption,
  NavController,
  AlertController
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
  closeOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline
} from 'ionicons/icons';
import { registro } from '../../services/guards/registro/registro';
import { SupabaseService } from '../../services/supabase/supabase';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';
import { PerfilCacheService } from '../../services/perfil-cache/perfil-cache.service';
import {
  validarNombreOApellido,
  validarRutChileno,
  formatearRut,
  validarTelefonoChileno,
  formatearTelefonoChileno,
  validarFechaNacimiento,
  esMayorDeEdad,
  validarTextoBasico,
  validarPassword
} from '../../services/utils/validators';
import { mensajeErrorApp } from '../../services/utils/mensaje-error';
import { RegionesComunasService, RegionChile } from '../../services/utils/regiones-comunas.service';

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
    IonSelect,
    IonSelectOption,
    CommonModule,
    FormsModule
  ]
})
export class SiguientePasoPage implements OnInit {

  nombre: string = '';
  apellidopa: string = '';
  apellidoma: string = '';
  rut: string = '';
  fechaNacimiento: string = '';
  telefono: string = '';

  region: string = '';
  comuna: string = '';
  calle: string = '';
  numero: string = '';

  /** Las 16 regiones con sus comunas (API de CNT.cl con respaldo oficial). */
  listaRegiones: RegionChile[] = [];
  /** Comunas de la región elegida; vacías hasta que se elija región. */
  comunasDisponibles: string[] = [];
  /** Mensaje de la lista de regiones si falla la descarga. */
  errorRegiones: string = '';

  tipoCuenta: 'Usuario' | 'Familiar' = 'Usuario';
  mensajeError: string = '';
  cargando: boolean = false;

  esUsuarioGoogle: boolean = false;
  contrasena: string = '';
  contrasenaConfirmacion: string = '';
  mostrarContrasena: boolean = false;
  mostrarContrasenaConfirmacion: boolean = false;

  mostrarModalFecha: boolean = false;
  /** El selector no ofrece fechas que dejen a la persona con menos de 18 años. */
  fechaMaxima: string = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString();
  })();

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
    contrasena?: string;
    contrasenaConfirmacion?: string;
  } = {};

  formularioIntentado: boolean = false;

  constructor(
    private registroService: registro,
    private supabaseService: SupabaseService,
    private router: Router,
    private navCtrl: NavController,
    private changeDetectorRef: ChangeDetectorRef,
    private navRol: NavegacionRolService,
    private alertController: AlertController,
    private perfilCache: PerfilCacheService,
    private regionesService: RegionesComunasService
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
      closeOutline,
      lockClosedOutline,
      eyeOutline,
      eyeOffOutline
    });
  }

  async ngOnInit() {
    // No bloquea la pantalla: la lista llega en segundo plano y se pinta
    // con detectChanges cuando está lista.
    void this.cargarRegionesComunas();

    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        await this.navCtrl.navigateRoot('/login', { replaceUrl: true });
        return;
      }

      const user = session.user;

      const providers = user.app_metadata?.['providers'] || [];
      this.esUsuarioGoogle = providers.includes('google') && !providers.includes('email');

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
        const rolData = usuario.rol as any;
        const rolNombre = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;
        this.navRol.limpiarCache();
        await this.navCtrl.navigateRoot(this.navRol.rutaPrincipal(rolNombre), { replaceUrl: true });
        return;
      }

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
    } finally {
      this.changeDetectorRef.detectChanges();
    }
  }

  volverElegirTipo() {
    this.navCtrl.navigateRoot('/elegir-tipo', { replaceUrl: true });
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

  /** Carga las regiones y comunas desde el JSON embebido en assets. */
  private async cargarRegionesComunas() {
    try {
      this.listaRegiones = await this.regionesService.regiones();
      // Si la región ya estaba elegida (al reintentar el formulario), las
      // comunas se repueblan sin borrar la comuna elegida.
      if (this.region) {
        this.comunasDisponibles = this.listaRegiones
          .find((r) => r.nombre === this.region)?.comunas ?? [];
      }
    } catch {
      this.errorRegiones = 'No se pudieron cargar las regiones y comunas.';
    } finally {
      this.changeDetectorRef.detectChanges();
    }
  }

  /** Al elegir región: se repueblan las comunas y se limpia la comuna. */
  alCambiarRegion(ev: any) {
    this.region = String(ev?.detail?.value ?? this.region);
    const region = this.listaRegiones.find((r) => r.nombre === this.region);
    this.comunasDisponibles = region ? region.comunas : [];
    this.comuna = '';
    delete this.errores.comuna;
    this.validarCampoRegion();
    this.changeDetectorRef.detectChanges();
  }

  alCambiarComuna(ev: any) {
    this.comuna = String(ev?.detail?.value ?? this.comuna);
    this.validarCampoComuna();
    this.changeDetectorRef.detectChanges();
  }

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
    // El selector ya limita a 18+, pero el dato puede venir pegado o manipulado.
    if (!esMayorDeEdad(this.fechaNacimiento)) {
      this.errores.fechaNacimiento = 'Debes tener al menos 18 años para usar la app.';
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

  validarCampoContrasena() {
    if (!this.esUsuarioGoogle) return true;
    const resultado = validarPassword(this.contrasena);
    if (!resultado.valida) {
      this.errores.contrasena = resultado.mensaje;
      return false;
    }
    delete this.errores.contrasena;
    return true;
  }

  validarCampoContrasenaConfirmacion() {
    if (!this.esUsuarioGoogle) return true;
    if (!this.contrasenaConfirmacion || this.contrasenaConfirmacion.trim().length === 0) {
      this.errores.contrasenaConfirmacion = 'Confirma tu contraseña.';
      return false;
    }
    if (this.contrasena !== this.contrasenaConfirmacion) {
      this.errores.contrasenaConfirmacion = 'Las contraseñas no coinciden.';
      return false;
    }
    delete this.errores.contrasenaConfirmacion;
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
    const vCon = this.validarCampoContrasena();
    const vConConf = this.validarCampoContrasenaConfirmacion();

    return vRut && vFecha && vNom && vApeP && vApeM && vTel && vReg && vCom && vCal && vNum && vCon && vConConf;
  }

  async guardarYContinuar() {
    this.mensajeError = '';

    if (!this.validarFormularioCompleto()) {
      this.mensajeError = 'Por favor completa y corrige los campos señalados en rojo.';
      this.changeDetectorRef.detectChanges();
      return;
    }

    this.cargando = true;
    this.changeDetectorRef.detectChanges();

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

      if (this.esUsuarioGoogle && this.contrasena) {
        const supabase = this.supabaseService.getClient();
        const { error: passError } = await supabase.auth.updateUser({
          password: this.contrasena
        });
        if (passError) {
          console.error('Error al guardar contraseña:', passError);
          await this.alertaError(
            'Contraseña no guardada',
            'El perfil se guardó, pero no se pudo establecer la contraseña. Puedes intentarlo más tarde desde ajustes.'
          );
        }
      }

      // La caché del perfil se llenó al iniciar sesión, con la fila todavía
      // incompleta (sin RUT, fecha ni dirección). Si no se limpia acá, el
      // panel y la pantalla de Perfil sirven esos datos viejos durante
      // 5 minutos aunque la base ya tenga lo recién guardado.
      this.perfilCache.limpiar();
      this.navRol.limpiarCache();

      if (resultado.tipoCuenta === 'Usuario') {
        await this.navCtrl.navigateRoot('/adulto-mayor', { replaceUrl: true });
      } else if (resultado.tipoCuenta === 'Familiar') {
        await this.navCtrl.navigateRoot('/cuidador', { replaceUrl: true });
      } else {
        await this.navCtrl.navigateRoot('/adulto-mayor', { replaceUrl: true });
      }

    } catch (error) {
      // El error llega traducido (p. ej. RUT repetido → "Este RUT ya está en
      // uso.") y se muestra como alerta; un toast o texto pequeño se pierde.
      console.error('Error guardando el perfil del paso 2:', error);
      await this.alertaError(
        'No se pudo guardar tu perfil',
        mensajeErrorApp(error, 'No se pudieron guardar los datos. Inténtalo de nuevo.')
      );
    } finally {
      // Sin detectChanges el spinner quedaba girando para siempre: el cambio
      // de `cargando` ocurría después del último repintado (app zoneless).
      this.cargando = false;
      this.changeDetectorRef.detectChanges();
    }
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

}

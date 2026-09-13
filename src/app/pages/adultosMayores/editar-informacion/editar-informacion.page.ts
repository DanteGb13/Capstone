import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, IonButton, IonButtons, IonInput, IonSpinner, AlertController, IonModal } from '@ionic/angular';
import { CuidadoresService } from '../../../services/Backend/cuidadores/cuidadores';
import { Router } from '@angular/router';
import { ChangeDetectorRef } from '@angular/core';

import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  person,
  personOutline,
  cardOutline,
  mailOutline,
  createOutline,
  saveOutline,
  callOutline,
  calendarOutline,
  mapOutline,
  businessOutline,
  locationOutline,
  shieldCheckmarkOutline,
  closeOutline,
  logOutOutline,
  timeOutline,
  sendOutline,
  keypadOutline,
  checkmarkCircleOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline
} from 'ionicons/icons';
import { SupabaseService } from '../../../services/supabase/supabase';
import { environment } from '../../../../environments/environment';
import {
  validarNombreOApellido,
  validarTelefonoChileno,
  validarFechaNacimiento,
  validarTextoBasico,
  validarEmail,
  validarPassword
} from '../../../services/utils/validators';

@Component({
  selector: 'app-editar-informacion',
  templateUrl: './editar-informacion.page.html',
  styleUrls: ['./editar-informacion.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonIcon,
    IonButton,
    CommonModule,
    FormsModule,
    IonButtons,
    IonInput,
    IonSpinner,
    IonModal
  ]
})
export class EditarInformacionPage implements OnInit {

  constructor(
    private cuidadoresService: CuidadoresService,
    private router: Router,
    private changeDetectorRef: ChangeDetectorRef, 
    private supabaseService: SupabaseService,
    private alertController: AlertController
  ) {
    addIcons({
      arrowBackOutline, person, personOutline, cardOutline, mailOutline,
      createOutline, saveOutline, callOutline, calendarOutline, mapOutline,
      businessOutline, locationOutline, shieldCheckmarkOutline,
      closeOutline, logOutOutline, timeOutline, sendOutline,
      keypadOutline, checkmarkCircleOutline,
      lockClosedOutline, eyeOutline, eyeOffOutline
    });
  }

  nombreUsuario: string = '';
  usuario: any = {};
  usuarioOriginal: any = {};
  modoEditar = false;
  cargandoPerfil: boolean = true;

  // Cambio de correo
  mostrarModalCorreo: boolean = false;
  nuevoCorreo: string = '';
  codigoVerificacion: string = '';
  pasoCambioCorreo: 'formulario' | 'verificar' = 'formulario';
  cargandoCorreo: boolean = false;
  errorCorreo: string = '';
  exitoCorreo: string = '';
  bloqueadoCorreo: boolean = false;
  mensajeBloqueoCorreo: string = '';

  // Cambio de contraseña
  mostrarModalContrasena: boolean = false;
  contrasenaActual: string = '';
  nuevaContrasena: string = '';
  confirmarContrasena: string = '';
  cargandoContrasena: boolean = false;
  errorContrasena: string = '';
  exitoContrasena: string = '';
  mostrarContrasenaActual: boolean = false;
  mostrarNuevaContrasena: boolean = false;
  mostrarConfirmarContrasena: boolean = false;

  // Errores de validación por campo
  errores: {
    nombre?: string;
    apellidopa?: string;
    apellidoma?: string;
    telefono?: string;
    fecha_nacimiento?: string;
    region?: string;
    comuna?: string;
    calle?: string;
    numero?: string;
  } = {};

  mensajeError: string = '';

  async ngOnInit() {
    try {
      // Una sola consulta trae nombre + dirección (cargarUsuario ya incluye el nombre)
      const datosUsuario = await this.cuidadoresService.cargarUsuario();

      if (datosUsuario) {
        this.usuario = datosUsuario;
        this.nombreUsuario = datosUsuario.nombre || '';
        // Creamos una copia de respaldo profunda de los datos cargados (incluyendo la dirección)
        this.usuarioOriginal = JSON.parse(JSON.stringify(datosUsuario));
      }

    } catch (error) {
      console.error("Error al cargar los datos del usuario:", error);
    } finally {
      this.cargandoPerfil = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async editarPerfil() {
    if (this.modoEditar) {
      const guardado = await this.guardarCambios();
      if (!guardado) {
        return;
      }
    }
    this.modoEditar = !this.modoEditar;
  }

  // Función para cancelar la edición y restaurar los datos anteriores
  cancelarEdicion() {
    // Limpiamos errores de validación
    this.errores = {};
    this.mensajeError = '';
    // Restauramos los datos desde la copia de respaldo
    this.usuario = JSON.parse(JSON.stringify(this.usuarioOriginal));
    // Salimos del modo edición
    this.modoEditar = false;
  }

  /**
   * Valida todos los campos editables usando los validadores compartidos.
   * Retorna true si todo es válido, false en caso contrario (poblando `errores`).
   */
  validarCampos(): boolean {
    this.errores = {};
    this.mensajeError = '';

    const u = this.usuario || {};
    const dir = u.direccion || {};

    if (!validarNombreOApellido(u.nombre ?? '')) {
      this.errores.nombre = 'El nombre solo debe contener letras y al menos 2 caracteres.';
    }

    if (!validarNombreOApellido(u.apellidopa ?? '')) {
      this.errores.apellidopa = 'El apellido paterno solo debe contener letras y al menos 2 caracteres.';
    }

    // El apellido materno es opcional: solo se valida si se ingresó algo
    if ((u.apellidoma ?? '').trim().length > 0 && !validarNombreOApellido(u.apellidoma)) {
      this.errores.apellidoma = 'El apellido materno solo debe contener letras.';
    }

    if (!validarTelefonoChileno(u.telefono ?? '')) {
      this.errores.telefono = 'Ingresa un teléfono chileno válido (9 dígitos, ej: 912345678).';
    }

    if (!validarFechaNacimiento(u.fecha_nacimiento ?? '')) {
      this.errores.fecha_nacimiento = 'Ingresa una fecha de nacimiento válida (no futura).';
    }

    if (!validarTextoBasico(dir.region ?? '', 2)) {
      this.errores.region = 'La región es requerida.';
    }
    if (!validarTextoBasico(dir.comuna ?? '', 2)) {
      this.errores.comuna = 'La comuna es requerida.';
    }
    if (!validarTextoBasico(dir.calle ?? '', 2)) {
      this.errores.calle = 'La calle es requerida.';
    }
    if (!validarTextoBasico((dir.numero ?? '').toString(), 1)) {
      this.errores.numero = 'El número es requerido.';
    }

    const hayErrores = Object.keys(this.errores).length > 0;
    if (hayErrores) {
      this.mensajeError = 'Revisa los campos marcados en rojo.';
    }

    return !hayErrores;
  }

  async guardarCambios(): Promise<boolean> {
    try {
      // 0. Validar campos antes de guardar
      if (!this.validarCampos()) {
        this.changeDetectorRef.detectChanges();
        return false;
      }

      console.log("Datos a actualizar:", this.usuario);

      // 1. Si el usuario tiene una dirección asociada, actualizamos la tabla 'direccion'
      if (this.usuario.id_direccion && this.usuario.direccion) {
        const { error: errorDireccion } = await this.supabaseService.getClient()
          .from('direccion')
          .update({
            region: this.usuario.direccion.region,
            comuna: this.usuario.direccion.comuna,
            calle: this.usuario.direccion.calle,
            numero: this.usuario.direccion.numero
          })
          .eq('id', this.usuario.id_direccion);

        if (errorDireccion) {
          console.error("Error al actualizar la dirección:", errorDireccion.message);
          return false;
        }
      }

      // 2. Actualizamos los datos personales en la tabla 'usuario'
      const { data, error } = await this.supabaseService.getClient()
        .from('usuario')
        .update({
          nombre: this.usuario.nombre,
          apellidopa: this.usuario.apellidopa,
          apellidoma: this.usuario.apellidoma,
          telefono: this.usuario.telefono,
          fecha_nacimiento: this.usuario.fecha_nacimiento
        })
        .eq('id', this.usuario.id);

      if (error) {
        console.error("Error al actualizar el usuario en Supabase:", error.message);
        return false;
      }

      // Actualizamos también la copia original con los nuevos datos guardados con éxito
      this.usuarioOriginal = JSON.parse(JSON.stringify(this.usuario));

      console.log("¡Perfil y dirección actualizados con éxito!");
      return true;

    } catch (err) {
      console.error("Error inesperado al guardar los cambios:", err);
      return false;
    }
  }

  // ==========================================
  // CAMBIO DE CORREO
  // ==========================================

  async abrirModalCorreo() {
    this.errorCorreo = '';
    this.exitoCorreo = '';
    this.bloqueadoCorreo = false;
    this.mensajeBloqueoCorreo = '';

    try {
      const supabase = this.supabaseService.getClient();
      const { data: perfil } = await supabase
        .from('usuario')
        .select('ultimo_cambio_correo')
        .eq('id', this.usuario.id)
        .single();

      if (perfil?.ultimo_cambio_correo) {
        const ultimoCambio = new Date(perfil.ultimo_cambio_correo);
        const cuatroMesesDespues = new Date(ultimoCambio);
        cuatroMesesDespues.setMonth(cuatroMesesDespues.getMonth() + 4);
        const ahora = new Date();

        if (ahora < cuatroMesesDespues) {
          const opciones: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
          const fechaDisponible = cuatroMesesDespues.toLocaleDateString('es-CL', opciones);
          this.bloqueadoCorreo = true;
          this.mensajeBloqueoCorreo = `Solo puedes cambiar tu correo una vez cada 4 meses. Podrás cambiarlo nuevamente el ${fechaDisponible}.`;
          this.mostrarModalCorreo = true;
          this.changeDetectorRef.detectChanges();
          return;
        }
      }
    } catch (error) {
      console.error('Error verificando cooldown de correo:', error);
    }

    this.nuevoCorreo = '';
    this.codigoVerificacion = '';
    this.pasoCambioCorreo = 'formulario';
    this.mostrarModalCorreo = true;
  }

  cerrarModalCorreo() {
    this.mostrarModalCorreo = false;
    this.nuevoCorreo = '';
    this.codigoVerificacion = '';
    this.pasoCambioCorreo = 'formulario';
    this.errorCorreo = '';
    this.exitoCorreo = '';
  }

  async enviarCodigoCorreo() {
    this.errorCorreo = '';
    this.exitoCorreo = '';

    if (!this.nuevoCorreo || this.nuevoCorreo.trim().length === 0) {
      this.errorCorreo = 'Ingresa el nuevo correo electrónico.';
      return;
    }

    if (!validarEmail(this.nuevoCorreo)) {
      this.errorCorreo = 'Formato de correo no válido.';
      return;
    }

    if (this.nuevoCorreo === this.usuario.correo) {
      this.errorCorreo = 'El nuevo correo es igual al actual.';
      return;
    }

    this.cargandoCorreo = true;

    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/enviar-codigo-correo`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': environment.supabaseKey,
          },
          body: JSON.stringify({ correo_nuevo: this.nuevoCorreo.trim() }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        this.errorCorreo = result.error || 'No se pudo enviar el código.';
        this.changeDetectorRef.detectChanges();
        return;
      }

      this.pasoCambioCorreo = 'verificar';
      this.exitoCorreo = `Código enviado a ${this.nuevoCorreo}`;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      this.errorCorreo = 'Error de conexión. Intenta nuevamente.';
    } finally {
      this.cargandoCorreo = false;
    }
  }

  async verificarCodigoCorreo() {
    this.errorCorreo = '';
    this.exitoCorreo = '';

    if (!this.codigoVerificacion || this.codigoVerificacion.trim().length === 0) {
      this.errorCorreo = 'Ingresa el código de verificación.';
      return;
    }

    if (this.codigoVerificacion.trim().length !== 6) {
      this.errorCorreo = 'El código debe tener 6 dígitos.';
      return;
    }

    this.cargandoCorreo = true;

    try {
      const supabase = this.supabaseService.getClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/verificar-codigo-correo`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': environment.supabaseKey,
          },
          body: JSON.stringify({
            codigo: this.codigoVerificacion.trim(),
            correo_nuevo: this.nuevoCorreo.trim(),
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        this.errorCorreo = result.error || 'Código incorrecto.';
        return;
      }

      this.usuario.correo = this.nuevoCorreo.trim();
      this.usuarioOriginal.correo = this.nuevoCorreo.trim();
      this.cargandoCorreo = false;
      this.changeDetectorRef.detectChanges();

      setTimeout(() => {
        this.cerrarModalCorreo();
        this.changeDetectorRef.detectChanges();
      }, 1500);

    } catch (error) {
      this.errorCorreo = 'Error de conexión. Intenta nuevamente.';
    } finally {
      this.cargandoCorreo = false;
    }
  }

  // ==========================================
  // CAMBIO DE CONTRASEÑA
  // ==========================================

  abrirModalContrasena() {
    this.contrasenaActual = '';
    this.nuevaContrasena = '';
    this.confirmarContrasena = '';
    this.errorContrasena = '';
    this.exitoContrasena = '';
    this.mostrarContrasenaActual = false;
    this.mostrarNuevaContrasena = false;
    this.mostrarConfirmarContrasena = false;
    this.mostrarModalContrasena = true;
  }

  cerrarModalContrasena() {
    this.mostrarModalContrasena = false;
    this.contrasenaActual = '';
    this.nuevaContrasena = '';
    this.confirmarContrasena = '';
    this.errorContrasena = '';
    this.exitoContrasena = '';
  }

  async cambiarContrasena() {
    this.errorContrasena = '';
    this.exitoContrasena = '';

    if (!this.contrasenaActual || this.contrasenaActual.trim().length === 0) {
      this.errorContrasena = 'Ingresa tu contraseña actual.';
      return;
    }

    if (!this.nuevaContrasena || this.nuevaContrasena.trim().length === 0) {
      this.errorContrasena = 'Ingresa la nueva contraseña.';
      return;
    }

    const resultado = validarPassword(this.nuevaContrasena);
    if (!resultado.valida) {
      this.errorContrasena = resultado.mensaje || 'Contraseña no válida.';
      return;
    }

    if (this.nuevaContrasena === this.contrasenaActual) {
      this.errorContrasena = 'La nueva contraseña debe ser diferente a la actual.';
      return;
    }

    if (this.nuevaContrasena !== this.confirmarContrasena) {
      this.errorContrasena = 'Las contraseñas no coinciden.';
      return;
    }

    this.cargandoContrasena = true;

    try {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.auth.updateUser({
        password: this.nuevaContrasena,
      });

      if (error) {
        this.errorContrasena = error.message || 'No se pudo actualizar la contraseña.';
        return;
      }

      this.exitoContrasena = 'Contraseña actualizada correctamente.';
      this.changeDetectorRef.detectChanges();

      setTimeout(() => {
        this.cerrarModalContrasena();
        this.changeDetectorRef.detectChanges();
      }, 2000);

    } catch (error) {
      this.errorContrasena = 'Error de conexión. Intenta nuevamente.';
    } finally {
      this.cargandoContrasena = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  volver() {
    window.history.back();
  }

  /**
   * Devuelve el nombre real del tipo de cuenta desde la relación 'rol'
   * (maneja que Supabase a veces retorna la relación 1-1 como arreglo).
   */
  get tipoCuentaTexto(): string {
    const rol = this.usuario?.rol;
    let nombre: string | undefined;
    if (Array.isArray(rol)) {
      nombre = rol[0]?.nombre;
    } else if (rol) {
      nombre = rol.nombre;
    }
    if (nombre) {
      return nombre;
    }
    return this.usuario?.id_rol === 1 ? 'Adulto Mayor' : 'Cuidador';
  }

  async cerrarSesion() {
    const alert = await this.alertController.create({
      cssClass: 'alerta-cerrar-sesion',
      header: 'Cerrar sesión',
      message: '¿Estás seguro de que deseas cerrar sesión?',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel'
        },
        {
          text: 'Cerrar sesión',
          role: 'destructive',
          handler: async () => {
            try {
              await this.supabaseService.getClient().auth.signOut();
            } catch (err) {
              console.error('Error al cerrar sesión:', err);
            } finally {
              this.router.navigate(['/login'], { replaceUrl: true });
            }
          }
        }
      ]
    });

    await alert.present();
  }
}
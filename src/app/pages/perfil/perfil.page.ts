import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, IonButton, IonButtons, IonInput, IonSpinner, AlertController, ToastController, IonModal, IonActionSheet, ActionSheetController } from '@ionic/angular';
import { CuidadoresService } from '../../services/Backend/cuidadores/cuidadores';
import { AlarmasService } from '../../services/alarmas/alarmas';
import { Router } from '@angular/router';
import { ChangeDetectorRef } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

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
  eyeOffOutline,
  cameraOutline,
  imageOutline,
  trashOutline
} from 'ionicons/icons';
import { SupabaseService } from '../../services/supabase/supabase';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';
import { environment } from '../../../environments/environment';
import {
  validarNombreOApellido,
  validarTelefonoChileno,
  validarFechaNacimiento,
  validarTextoBasico,
  validarEmail,
  validarPassword
} from '../../services/utils/validators';

@Component({
  selector: 'app-perfil',
  templateUrl: './perfil.page.html',
  styleUrls: ['./perfil.page.scss'],
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
export class PerfilPage implements OnInit {

  constructor(
    private cuidadoresService: CuidadoresService,
    private alarmasService: AlarmasService,
    private router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private supabaseService: SupabaseService,
    private alertController: AlertController,
    private toastController: ToastController,
    private actionSheetController: ActionSheetController,
    private navRol: NavegacionRolService
  ) {
    addIcons({
      arrowBackOutline, person, personOutline, cardOutline, mailOutline,
      createOutline, saveOutline, callOutline, calendarOutline, mapOutline,
      businessOutline, locationOutline, shieldCheckmarkOutline,
      closeOutline, logOutOutline, timeOutline, sendOutline,
      keypadOutline, checkmarkCircleOutline,
      lockClosedOutline, eyeOutline, eyeOffOutline,
      cameraOutline, imageOutline, trashOutline
    });
  }

  nombreUsuario: string = '';
  usuario: any = {};
  usuarioOriginal: any = {};
  modoEditar = false;
  cargandoPerfil: boolean = true;
  fotoUrl: string | null = null;
  cargandoFoto: boolean = false;

  mostrarModalCorreo: boolean = false;
  nuevoCorreo: string = '';
  codigoVerificacion: string = '';
  pasoCambioCorreo: 'formulario' | 'verificar' = 'formulario';
  cargandoCorreo: boolean = false;
  errorCorreo: string = '';
  exitoCorreo: string = '';
  bloqueadoCorreo: boolean = false;
  mensajeBloqueoCorreo: string = '';

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
      const datosUsuario = await this.cuidadoresService.cargarUsuario();

      if (datosUsuario) {
        this.usuario = datosUsuario;
        this.nombreUsuario = datosUsuario.nombre || '';
        this.usuarioOriginal = JSON.parse(JSON.stringify(datosUsuario));
        await this.cargarFotoPerfil();
      }

    } catch (error) {
      console.error("Error al cargar los datos del usuario:", error);
    } finally {
      this.cargandoPerfil = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async cargarFotoPerfil() {
    try {
      const supabase = this.supabaseService.getClient();
      const userId = this.usuario.id;

      const { data, error } = await supabase
        .storage
        .from('fotos-perfil')
        .list(`${userId}/`, { limit: 1 });

      if (error || !data || data.length === 0) {
        this.fotoUrl = null;
        return;
      }

      const fileName = data[0].name;
      const { data: signedUrlData, error: signedUrlError } = await supabase
        .storage
        .from('fotos-perfil')
        .createSignedUrl(`${userId}/${fileName}`, 3600);

      if (signedUrlError || !signedUrlData) {
        this.fotoUrl = null;
        return;
      }

      this.fotoUrl = signedUrlData.signedUrl;

    } catch (error) {
      console.error('Error cargando foto de perfil:', error);
      this.fotoUrl = null;
    }
  }

  async abrirSelectorFoto() {
    const actionSheet = await this.actionSheetController.create({
      header: 'Cambiar foto de perfil',
      buttons: [
        {
          text: 'Tomar foto',
          icon: 'camera-outline',
          handler: () => {
            this.seleccionarFoto(CameraSource.Camera);
          }
        },
        {
          text: 'Elegir de galería',
          icon: 'image-outline',
          handler: () => {
            this.seleccionarFoto(CameraSource.Photos);
          }
        },
        ...(this.fotoUrl ? [{
          text: 'Eliminar foto actual',
          icon: 'trash-outline',
          role: 'destructive' as const,
          handler: () => {
            this.eliminarFoto();
          }
        }] : []),
        {
          text: 'Cancelar',
          role: 'cancel'
        }
      ]
    });

    await actionSheet.present();
  }

  async seleccionarFoto(source: CameraSource) {
    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source,
        width: 400,
        height: 400,
      });

      if (!image.dataUrl) return;

      this.cargandoFoto = true;
      await this.subirFoto(image.dataUrl);

    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('Error seleccionando foto:', error);
      }
    } finally {
      this.cargandoFoto = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async subirFoto(dataUrl: string) {
    try {
      const supabase = this.supabaseService.getClient();
      const userId = this.usuario.id;

      await this.eliminarFotoExistente();

      const fileName = `perfil_${Date.now()}.jpg`;
      const filePath = `${userId}/${fileName}`;

      const base64Data = dataUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }

      const { error: uploadError } = await supabase
        .storage
        .from('fotos-perfil')
        .upload(filePath, byteArray, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadError) {
        console.error('Error subiendo foto:', uploadError);
        return;
      }

      await this.cargarFotoPerfil();
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('Error en subirFoto:', error);
    }
  }

  async eliminarFotoExistente() {
    try {
      const supabase = this.supabaseService.getClient();
      const userId = this.usuario.id;

      const { data } = await supabase
        .storage
        .from('fotos-perfil')
        .list(`${userId}/`, { limit: 1 });

      if (data && data.length > 0) {
        await supabase
          .storage
          .from('fotos-perfil')
          .remove([`${userId}/${data[0].name}`]);
      }
    } catch (error) {
      console.error('Error eliminando foto existente:', error);
    }
  }

  async eliminarFoto() {
    try {
      this.cargandoFoto = true;
      await this.eliminarFotoExistente();
      this.fotoUrl = null;
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('Error eliminando foto:', error);
    } finally {
      this.cargandoFoto = false;
    }
  }

  async editarPerfil() {
    if (this.modoEditar) {
      const guardado = await this.guardarCambios();
      if (!guardado) {
        return;
      }

      this.modoEditar = false;
      this.changeDetectorRef.detectChanges();

      const toast = await this.toastController.create({
        message: 'Perfil editado correctamente',
        duration: 2500,
        position: 'bottom',
        icon: 'checkmark-circle-outline',
        cssClass: 'toast-exito-perfil'
      });
      await toast.present();
      return;
    }
    this.modoEditar = !this.modoEditar;
  }

  cancelarEdicion() {
    this.errores = {};
    this.mensajeError = '';
    this.usuario = JSON.parse(JSON.stringify(this.usuarioOriginal));
    this.modoEditar = false;
  }

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
      if (!this.validarCampos()) {
        this.changeDetectorRef.detectChanges();
        return false;
      }

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

      this.usuarioOriginal = JSON.parse(JSON.stringify(this.usuario));
      return true;

    } catch (err) {
      console.error("Error inesperado al guardar los cambios:", err);
      return false;
    }
  }

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

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }

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
              this.navRol.limpiarCache();
              this.alarmasService.limpiarDatosLocal();
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

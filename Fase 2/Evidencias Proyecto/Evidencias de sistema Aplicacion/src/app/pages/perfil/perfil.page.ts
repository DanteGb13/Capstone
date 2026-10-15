import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, IonButton, IonButtons, IonInput, IonSpinner, AlertController, ToastController, IonModal, IonActionSheet, ActionSheetController } from '@ionic/angular';
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
import { PushNotificationService } from '../../services/Backend/push-notification/push-notification';
import { PerfilCacheService } from '../../services/perfil-cache/perfil-cache.service';
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
    private alarmasService: AlarmasService,
    private router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private supabaseService: SupabaseService,
    private alertController: AlertController,
    private toastController: ToastController,
    private actionSheetController: ActionSheetController,
    private navRol: NavegacionRolService,
    private pushService: PushNotificationService,
    private perfilCache: PerfilCacheService
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

  /**
   * Marca que hay una carga de perfil en curso. `ngOnInit` e
   * `ionViewWillEnter` corren casi al mismo tiempo la primera vez que se entra,
   * y sin esto la pantalla pintaba dos veces y pedía la foto dos veces.
   */
  private cargaEnCurso = false;

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
    await this.cargarPerfil();
  }

  /**
   * Revisa el perfil en cada entrada, no sólo en `ngOnInit`.
   *
   * Ionic deja la página viva en el router outlet, así que `ngOnInit` corre una
   * sola vez en toda la sesión: sin esto, corregir el nombre en otro lado y
   * volver acá mostraba el dato viejo.
   *
   * Por qué NO fuerza caché acá: al entrar por primera vez, Ionic dispara
   * `ngOnInit` y `ionViewWillEnter` casi pegados, y con `forzar` eran DOS viajes
   * de red para lo mismo. Peor: `forzar` en cada entrada convertía la caché en
   * un no-op, que es justo lo que se vino a arreglar. La ventana de 5 minutos
   * cubre el caso "lo corregí en otro lado", y `guardarCambios()` ya refresca la
   * caché cuando el dato cambia desde esta misma pantalla.
   */
  ionViewWillEnter() {
    void this.cargarPerfil();
  }

  /**
   * Carga el perfil desde la caché compartida.
   *
   * Antes iba directo a `cargarUsuario()`, que son DOS viajes a la red
   * (`auth.getUser()` —que revalida contra el servidor aunque la sesión esté en
   * el teléfono— más un select con tres relaciones), y después awaited otra vez
   * por la foto (listar + firmar). Cuatro viajes encadenados, y el
   * `*ngIf="cargandoPerfil"` de la plantilla no dejaba ver nada hasta que
   * terminaban los cuatro.
   *
   * Ahora:
   *  - el perfil sale de `PerfilCacheService`, que ya está en los dos paneles y
   *    cachea 5 minutos. La primera visita cuesta 1 viaje y las siguientes 0.
   *  - la foto NO bloquea la pantalla: se pide después y se pinta el avatar
   *    cuando llega.
   *
   * `forzar` ignora la caché del perfil (no la foto, que tiene su propio TTL).
   */
  private async cargarPerfil(forzar = false): Promise<void> {
    // Al entrar por primera vez Ionic dispara `ngOnInit` y `ionViewWillEnter`
    // casi pegados. Sin este guardia la pantalla se pintaba dos veces con el
    // mismo dato y pedía dos veces la foto.
    if (this.cargaEnCurso) {
      return;
    }

    this.cargaEnCurso = true;
    this.cargandoPerfil = true;
    this.changeDetectorRef.detectChanges();

    try {
      const perfil = await this.perfilCache.perfil(forzar);

      if (!perfil) {
        console.warn('No se pudo obtener el perfil del usuario');
        return;
      }

      // Se reconstruye con la misma forma que tenía antes, porque el formulario,
      // las validaciones y `guardarCambios()` leen estos campos por nombre. La
      // caché guarda un resumen; esta función lo devuelve con la forma que la
      // pantalla ya esperaba, sin tocar una línea de esas tres cosas.
      //
      // `rol` e `id_rol` también van: los usa el getter `tipoCuentaTexto` para
      // el rótulo de la tarjeta. Sin ellos caía siempre en "Cuidador" y un
      // adulto mayor se veía con el tipo de cuenta equivocado.
      this.usuario = {
        id: perfil.id,
        nombre: perfil.nombre,
        apellidopa: perfil.apellidopa ?? '',
        apellidoma: perfil.apellidoma ?? '',
        telefono: perfil.telefono ?? '',
        correo: perfil.correo ?? '',
        rut: perfil.rut ?? '',
        fecha_nacimiento: perfil.fechaNacimiento ?? '',
        id_direccion: perfil.idDireccion ?? null,
        id_rol: perfil.idRol ?? null,
        // `rol` vuelve como texto ('Usuario' / 'Familiar'); se devuelve con la
        // forma de relación (arreglo de un objeto) que es la que espera el
        // getter. `tipoCuentaTexto` además tolera el texto plano.
        rol: perfil.rol ? [{ nombre: perfil.rol }] : undefined,
        direccion: {
          region: perfil.direccion?.region ?? '',
          comuna: perfil.direccion?.comuna ?? '',
          calle: perfil.direccion?.calle ?? '',
          numero: perfil.direccion?.numero ?? ''
        }
      };

      this.nombreUsuario = perfil.nombre || '';
      this.usuarioOriginal = JSON.parse(JSON.stringify(this.usuario));

      // Lo que había en caché si viene, para no dejar el avatar vacío mientras
      // se resuelve.
      this.fotoUrl = perfil.fotoUrl ?? null;

      this.changeDetectorRef.detectChanges();

      // La foto se resuelve después y no bloquea nada. Si falla, el avatar queda
      // con el ícono de persona, igual que antes.
      this.cargarFotoPerfil();
    } catch (error) {
      console.error("Error al cargar los datos del usuario:", error);
    } finally {
      this.cargaEnCurso = false;
      this.cargandoPerfil = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Resuelve la foto de perfil.
   *
   * Va por `PerfilCacheService.cargarFoto()` y no por las dos llamadas
   * directas que hacía antes, porque ese método ya existe, ya cachea el resultado
   * por una hora y tiene el mismo comportamiento (null si no hay foto). El
   * `list()` + `createSignedUrl()` se sigue haciendo igual, pero una vez por
   * hora en vez de en cada entrada al perfil.
   *
   * Además ya no se espera: el avatar aparece aunque la foto tarde, o nunca
   * llegue.
   */
  private async cargarFotoPerfil(): Promise<void> {
    const userId = this.usuario?.id;
    if (!userId) {
      this.fotoUrl = null;
      return;
    }

    this.cargandoFoto = true;
    this.changeDetectorRef.detectChanges();

    try {
      this.fotoUrl = await this.perfilCache.cargarFoto(userId);
    } catch (error) {
      console.error('Error cargando foto de perfil:', error);
      this.fotoUrl = null;
    } finally {
      this.cargandoFoto = false;
      this.changeDetectorRef.detectChanges();
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

      // La foto que acaba de subirse tiene que verse YA. La caché dura una hora,
      // así que sin esto el avatar seguiría mostrando la anterior (o el ícono
      // de persona) hasta que venciera el TTL.
      this.perfilCache.limpiarFoto();

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

      // Por lo mismo que al subir: hay que olvidar la foto cacheada o el avatar
      // seguiría mostrándola aunque ya no exista.
      this.perfilCache.limpiarFoto();

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

      // El panel pinta el nombre desde el caché de perfil, que dura 5 minutos.
      // Sin invalidarlo acá, la persona cambiaría su nombre, volvería al
      // panel y seguiría viendo el anterior.
      this.perfilCache.limpiar();

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

    if (typeof rol === 'string') {
      // La caché entrega el rol como texto plano ('Usuario' / 'Familiar').
      nombre = rol;
    } else if (Array.isArray(rol)) {
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
              // Antes de cerrar sesión: este celular deja de estar atado a esta
              // cuenta, para que la siguiente no siga recibiendo sus alertas
              await this.pushService.eliminarToken();
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

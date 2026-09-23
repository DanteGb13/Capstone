import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';

import {
  CuidadoresService
} from '../../../services/Backend/cuidadores/cuidadores';


import {
  Router
} from '@angular/router';

import {
  CommonModule
} from '@angular/common';

import {
  FormsModule
} from '@angular/forms';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonIcon,
  IonButton,
  IonModal,
  IonButtons,
  IonSpinner
} from '@ionic/angular';

import {
  addIcons
} from 'ionicons';

import * as icons from 'ionicons/icons';

import * as QRCode from 'qrcode';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { Gps } from '../../../services/Backend/gps/gps';
import { AlarmasService, AlarmaRecordatorio } from '../../../services/alarmas/alarmas';
import { SOSService, ResultadoSOS } from '../../../services/Backend/sos/sos';
import { SiempreCerca } from '../../../services/alarmas/siempre-cerca';
import { Capacitor } from '@capacitor/core';
import { FooterComponent } from '../../../components/footer/footer.component';
import { SupabaseService } from '../../../services/supabase/supabase';
import { PushNotificationService } from '../../../services/Backend/push-notification/push-notification';
import { AlertController } from '@ionic/angular';


@Component({

  selector: 'app-adulto-mayor',

  templateUrl: './adulto-mayor.page.html',

  styleUrls: ['./adulto-mayor.page.scss'],

  imports: [

    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonIcon,

    IonButton,
    IonModal,
    IonButtons,
    IonSpinner,

    CommonModule,
    FormsModule,
    FooterComponent

  ]

})


export class AdultoMayorPage implements OnInit, OnDestroy {


  // =====================================================
  // POLLING SOLICITUDES
  // =====================================================

  private solicitudesInterval: any = null;


  // =====================================================
  // USUARIO
  // =====================================================

  nombreUsuario: string = '';

  idUsuarioActual: string = '';

  fotoUrl: string | null = null;


  // =====================================================
  // VINCULACIÓN
  // =====================================================

  mostrarModal: boolean = false;

  codigo: string = '';

  qrCodeUrl: string = '';

  fechaExpiracion: Date | null = null;

  generando: boolean = false;


  // =====================================================
  // SOLICITUDES
  // =====================================================

  solicitudes: any[] = [];

  cargandoSolicitudes: boolean = false;


  // =====================================================
  // CUIDADORES VINCULADOS (PROTECCIÓN ACTIVA)
  // =====================================================

  cuidadoresVinculados: any[] = [];

  nombreCuidadorActivo: string = '';

  cargandoCuidadores: boolean = false;


  // =====================================================
  // ALARMAS DE RECORDATORIOS
  // =====================================================

  alarmasSonando: AlarmaRecordatorio[] = [];


  // =====================================================
  // MENSAJES
  // =====================================================

  mensaje: string = '';

  mensajeError: string = '';


  // =====================================================
  // CONSTRUCTOR
  // =====================================================

  constructor(

    private cuidadoresService: CuidadoresService,

    private vinculacionService: Vinculacion,

    private gpsService: Gps,

    private alarmasService: AlarmasService,

    private changeDetectorRef: ChangeDetectorRef,

    private router: Router,

    private sosService: SOSService,

    private supabaseService: SupabaseService,

    private pushService: PushNotificationService,

    private alertCtrl: AlertController

  ) {

    // Carga todos los iconos Ionic

    addIcons(icons);

  }



  // =====================================================
  // INICIO
  // =====================================================

  async ngOnInit() {

    // 1. Cargar datos del usuario UNA sola vez (nombre + id + dirección)
    const usuario = await this.cuidadoresService.cargarUsuario();
    if (usuario) {
      this.nombreUsuario = usuario.nombre || '';
      this.idUsuarioActual = usuario.id || '';
      await this.cargarFotoPerfil();
    } else {
      this.nombreUsuario = await this.cuidadoresService.cargarUsuarioNombre();
    }

    // 2. Refrescar la vista YA con el nombre para que no se vea vacía
    this.changeDetectorRef.detectChanges();


    // 3. Cargar en paralelo sólo lo esencial del panel (solicitudes + cuidadores)
    await Promise.all([
      this.cargarSolicitudes(),
      this.cargarCuidadoresVinculados()
    ]);

    this.changeDetectorRef.detectChanges();


    // 4. Reportar ubicación en SEGUNDO PLANO (geolocalización + geocoding externo),
    //    sin bloquear la visualización del panel.
    this.reportarUbicacion();


    // 5. Recordatorios: repone las alarmas programadas y escucha el toque
    //    en las notificaciones para abrir el panel de consolar con "Apagar".
    this.actualizarSonando();

    this.alarmasService.escucharTap(() => {
      this.actualizarSonando();
      this.router.navigate(['/recordatorios']);
    });

    // Crear canal SOS + registrar push después de cargar la página (no bloquear)
    setTimeout(() => {
      if (Capacitor.isNativePlatform()) {
        SiempreCerca.crearCanalSOS().catch(() => {});
        this.pushService.inicializar().catch(() => {});
      }
    }, 2000);


    // Refrescar solicitudes y cuidadores vinculados cada 30 segundos
    // para que aparezcan sin recargar la página

    this.solicitudesInterval = setInterval(async () => {

      await Promise.all([
        this.cargarSolicitudes(),
        this.cargarCuidadoresVinculados()
      ]);

      this.actualizarSonando();

      this.changeDetectorRef.detectChanges();

    }, 30000);

  }

  async ionViewWillEnter() {
    await this.cargarFotoPerfil();
    this.changeDetectorRef.detectChanges();
  }

  async reportarUbicacion() {
    if (!this.idUsuarioActual) {
      try {
        const user = await this.cuidadoresService.cargarUsuario();
        this.idUsuarioActual = user?.id || '';
      } catch (e) {
        return;
      }
    }
    if (this.idUsuarioActual) {
      try {
        await this.gpsService.reportarUbicacionAdulto(this.idUsuarioActual);
      } catch (e) {
        // ignore
      }
    }
  }


  // =====================================================
  // DESTRUCCIÓN
  // =====================================================

  ngOnDestroy() {

    if (this.solicitudesInterval) {

      clearInterval(this.solicitudesInterval);

    }

  }


  // =====================================================
  // PERFIL
  // =====================================================

  async cargarFotoPerfil() {
    try {
      const supabase = this.supabaseService.getClient();
      const userId = this.idUsuarioActual;

      const { data } = await supabase.storage
        .from('fotos-perfil')
        .list(`${userId}/`, { limit: 1 });

      if (data && data.length > 0) {
        const { data: signedUrlData } = await supabase.storage
          .from('fotos-perfil')
          .createSignedUrl(`${userId}/${data[0].name}`, 3600);
        this.fotoUrl = signedUrlData?.signedUrl || null;
      } else {
        this.fotoUrl = null;
      }
    } catch (error) {
      this.fotoUrl = null;
    }
  }

  abrirPerfil() {

    (document.activeElement as HTMLElement)?.blur();

    this.router.navigate([
      '/perfil'
    ]);

  }



  // =====================================================
  // INICIO
  // =====================================================

  irInicio() {

    console.log('Inicio');

  }

  irAjustes() {
    this.router.navigate(['/ajustes']);
  }



  // =====================================================
  // FAMILIA
  // =====================================================

  abrirFamilia() {

    console.log('Familia');

  }



  // =====================================================
  // SOS
  // =====================================================

  mostrarModalSOS: boolean = false;

  ejecutandoSOS: boolean = false;

  abrirSOS() {
    this.mostrarModalSOS = true;
  }

  cerrarModalSOS() {
    this.mostrarModalSOS = false;
  }

  async confirmarSOS() {
    this.mostrarModalSOS = false;
    this.ejecutandoSOS = true;
    this.changeDetectorRef.detectChanges();

    try {
      const resultado = await this.sosService.ejecutarSOS();
      console.log('SOS resultado:', JSON.stringify(resultado));
    } catch (e: any) {
      console.error('SOS error:', e);
    }

    this.ejecutandoSOS = false;
    this.changeDetectorRef.detectChanges();
  }



  // =====================================================
  // ESTOY AQUÍ
  // =====================================================

  mostrarModalEstoyAqui: boolean = false;

  estadoEstoyAqui: string = 'Estoy aquí';

  abrirEstoyAqui() {
    (document.activeElement as HTMLElement)?.blur();
    this.mostrarModalEstoyAqui = true;
  }

  cerrarModalEstoyAqui() {
    this.mostrarModalEstoyAqui = false;
  }

  async marcarEnCasa() {
    this.mostrarModalEstoyAqui = false;
    this.estadoEstoyAqui = 'Estoy en casa';
    console.log('Estado: Estoy en casa');
    await this.notificarEstadoCasa('Estoy en casa');
  }

  async marcarSaliDeCasa() {
    this.mostrarModalEstoyAqui = false;
    this.estadoEstoyAqui = 'Salí de casa';
    console.log('Estado: Salí de casa');
    await this.notificarEstadoCasa('Salí de casa');
  }

  private async notificarEstadoCasa(estado: 'Estoy en casa' | 'Salí de casa') {
    let cuidadores: any[] = [];

    try {
      cuidadores = await this.sosService.obtenerCuidadores();
    } catch (e) {
      console.error('Error obteniendo cuidadores vinculados:', e);
    }

    // Sin cuidador vinculado → avisar que debe vincularse primero
    if (!cuidadores || cuidadores.length === 0) {
      const alert = await this.alertCtrl.create({
        header: 'Sin cuidador vinculado',
        message: 'Debes vincular a un cuidador primero antes de realizar esta acción.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const nombreAdulto = this.nombreUsuario?.trim()
      ? this.nombreUsuario.trim()
      : 'Tu adulto mayor';

    const cuerpo =
      estado === 'Estoy en casa'
        ? `${nombreAdulto} dice: Estoy en casa`
        : `${nombreAdulto} dice: Salí de casa`;

    let enviados = 0;

    for (const cuidador of cuidadores) {
      try {
        const ok = await this.pushService.enviarPushAUsuario(
          cuidador.id,
          estado,
          cuerpo,
          { tipo: 'estado_casa', estado }
        );
        if (ok) {
          enviados++;
          console.log('Push de estado enviado al cuidador:', cuidador.id);
        }
      } catch (e) {
        console.error('Error enviando push de estado al cuidador:', e);
      }
    }

    if (enviados === 0) {
      const motivo = this.pushService.ultimoError;
      const alert = await this.alertCtrl.create({
        header: 'No se pudo enviar el estado',
        message:
          `No se envió al cuidador.\n\n` +
          `Motivo: ${motivo || 'desconocido'}\n\n` +
          `Verifica que el cuidador tenga la app abierta con el permiso de notificaciones activado y que el canal de notificaciones de SiempreCerca no esté bloqueado en su celular.`,
        buttons: ['OK']
      });
      await alert.present();
    }
  }



  // =====================================================
  // RECORDATORIOS
  // =====================================================

  abrirRecordatorios() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/recordatorios']);
  }

  abrirMiUbicacion() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/mi-ubicacion']);
  }

  async actualizarSonando() {
    this.alarmasSonando = await this.alarmasService.estanSonando();
  }

  async apagarAlarma(alarma: AlarmaRecordatorio) {
    await this.alarmasService.apagarAlarma(alarma);
    await this.actualizarSonando();
  }



  // =====================================================
  // ALERTAS
  // =====================================================

  abrirAlertas() {

    console.log('Alertas');

  }



  // =====================================================
  // AJUSTES
  // =====================================================

  abrirAjustes() {

    console.log('Ajustes');

  }



  // =====================================================
  // ABRIR MODAL DE VINCULACIÓN
  // =====================================================

  async abrirVinculacion() {

    this.mensaje = '';

    this.mensajeError = '';

    this.codigo = '';

    this.qrCodeUrl = '';

    // Abrir el modal primero para que el ng-template se renderice
    this.mostrarModal = true;

    this.changeDetectorRef.detectChanges();


    // Esperar a que el modal esté listo antes de generar el QR

    setTimeout(() => {

      this.generarCodigo();

    }, 200);

  }



  // =====================================================
  // GENERAR CÓDIGO
  // =====================================================

  async generarCodigo() {

    this.generando = true;

    this.mensaje = '';

    this.mensajeError = '';

    this.codigo = '';

    this.qrCodeUrl = '';


    try {


      const data =
        await this.vinculacionService.generarCodigo();


      // ---------------------------------------------
      // Guardar código
      // ---------------------------------------------

      this.codigo =
        data.codigo;


      // ---------------------------------------------
      // Guardar expiración
      // ---------------------------------------------

      if (data.fecha_expiracion) {

        this.fechaExpiracion =
          new Date(
            data.fecha_expiracion
          );

      }


      // ---------------------------------------------
      // Generar QR
      // ---------------------------------------------

      this.qrCodeUrl =
        await QRCode.toDataURL(
          this.codigo,
          {
            width: 250,
            margin: 2
          }
        );


    } catch (error: any) {

      this.mensajeError =
        error?.message ??
        'No se pudo generar el código.';


    } finally {

      this.generando = false;

      this.changeDetectorRef.detectChanges();

    }

  }



  // =====================================================
  // CERRAR MODAL
  // =====================================================

  cerrarModal() {

    this.mostrarModal = false;

  }



  // =====================================================
  // CARGAR SOLICITUDES
  // =====================================================

  async cargarSolicitudes() {

    this.cargandoSolicitudes = true;


    try {

      this.solicitudes =
        await this.vinculacionService
          .obtenerSolicitudes();

    } catch (error: any) {

      this.mensajeError =
        error?.message ??
        'No se pudieron cargar las solicitudes.';


    } finally {

      this.cargandoSolicitudes = false;

    }

  }



  // =====================================================
  // CARGAR CUIDADORES VINCULADOS
  // =====================================================

  async cargarCuidadoresVinculados() {

    this.cargandoCuidadores = true;

    try {

      const data =
        await this.vinculacionService
          .obtenerCuidadoresVinculados();

      this.cuidadoresVinculados = data;

      if (data && data.length > 0) {

        const nombres = data
          .map((item: any) => {

            const usuario =
              item.cuidador?.usuario;

            if (!usuario) {
              return '';
            }

            const nombreCompleto =
              `${usuario.nombre || ''} ${usuario.apellidopa || ''}`.trim();

            return nombreCompleto;

          })
          .filter((nom: string) => nom.length > 0);


        this.nombreCuidadorActivo =
          nombres.join(', ');

      } else {

        this.nombreCuidadorActivo = '';

      }

    } catch (error: any) {

      console.error(
        'Error cargando cuidadores vinculados:',
        error
      );

    } finally {

      this.cargandoCuidadores = false;

    }

  }



  // =====================================================
  // ACEPTAR SOLICITUD
  // =====================================================

  async aceptarSolicitud(
    idSolicitud: string
  ) {

    this.mensaje = '';

    this.mensajeError = '';


    try {

      await this.vinculacionService
        .aceptarSolicitud(
          idSolicitud
        );


      this.mensaje =
        'Cuidador vinculado correctamente.';


      // Actualizar listas

      await Promise.all([
        this.cargarSolicitudes(),
        this.cargarCuidadoresVinculados()
      ]);


      this.changeDetectorRef.detectChanges();


    } catch (error: any) {

      console.error(
        'Error aceptando solicitud:',
        error
      );


      this.mensajeError =
        error?.message ??
        'No se pudo aceptar la solicitud.';

    }

  }



  // =====================================================
  // RECHAZAR SOLICITUD
  // =====================================================

  async rechazarSolicitud(
    idSolicitud: string
  ) {

    this.mensaje = '';

    this.mensajeError = '';


    try {

      await this.vinculacionService
        .rechazarSolicitud(
          idSolicitud
        );


      this.mensaje =
        'Solicitud rechazada.';


      // Actualizar lista

      await this.cargarSolicitudes();


      this.changeDetectorRef.detectChanges();


    } catch (error: any) {

      console.error(
        'Error rechazando solicitud:',
        error
      );


      this.mensajeError =
        error?.message ??
        'No se pudo rechazar la solicitud.';

    }

  }

}
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
  IonButtons
} from '@ionic/angular';

import {
  addIcons
} from 'ionicons';

import * as icons from 'ionicons/icons';

import * as QRCode from 'qrcode';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { Gps } from '../../../services/Backend/gps/gps';
import { AlarmasService, AlarmaRecordatorio } from '../../../services/alarmas/alarmas';


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

    CommonModule,
    FormsModule

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

    private router: Router

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

  abrirPerfil() {

    (document.activeElement as HTMLElement)?.blur();

    this.router.navigate([
      '/editar-informacion'
    ]);

  }



  // =====================================================
  // INICIO
  // =====================================================

  irInicio() {

    console.log('Inicio');

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

  abrirSOS() {
    this.mostrarModalSOS = true;
  }

  cerrarModalSOS() {
    this.mostrarModalSOS = false;
  }

  confirmarSOS() {
    this.mostrarModalSOS = false;
    // TODO: implementar lógica de emergencia (avisar al cuidador)
    console.log('SOS confirmado: avisar al cuidador');
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

  marcarEnCasa() {
    this.mostrarModalEstoyAqui = false;
    this.estadoEstoyAqui = 'Estoy en casa';
    console.log('Estado: Estoy en casa');
  }

  marcarSaliDeCasa() {
    this.mostrarModalEstoyAqui = false;
    this.estadoEstoyAqui = 'Salí de casa';
    console.log('Estado: Salí de casa');
  }



  // =====================================================
  // RECORDATORIOS
  // =====================================================

  abrirRecordatorios() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/recordatorios']);
  }

  actualizarSonando() {
    this.alarmasSonando = this.alarmasService.estanSonando();
  }

  apagarAlarma(alarma: AlarmaRecordatorio) {
    this.alarmasService.apagarAlarma(alarma);
    this.actualizarSonando();
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
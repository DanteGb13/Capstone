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

    this.nombreUsuario =
      await this.cuidadoresService.cargarUsuarioNombre();


    // Cargar solicitudes pendientes

    await this.cargarSolicitudes();


    this.changeDetectorRef.detectChanges();


    // Refrescar solicitudes cada 30 segundos
    // para que aparezcan sin recargar la página

    this.solicitudesInterval = setInterval(async () => {

      await this.cargarSolicitudes();

      this.changeDetectorRef.detectChanges();

    }, 30000);

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

  abrirSOS() {

    console.log('SOS');

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


      // Actualizar lista

      await this.cargarSolicitudes();


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
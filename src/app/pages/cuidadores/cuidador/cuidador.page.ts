import { Component, OnInit } from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButton,
  IonModal,
  IonButtons,
  IonInput
} from '@ionic/angular';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';



@Component({

  selector: 'app-cuidador',

  templateUrl: './cuidador.page.html',

  styleUrls: ['./cuidador.page.scss'],

  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonModal,
    IonButtons,
    IonInput,
    CommonModule,
    FormsModule
  ]

})

export class CuidadorPage implements OnInit {


  // =====================================================
  // MODAL DE VINCULACIÓN
  // =====================================================

  mostrarModal = false;


  // =====================================================
  // CÓDIGO DEL ADULTO MAYOR
  // =====================================================

  codigo = '';


  // =====================================================
  // ESTADOS
  // =====================================================

  vinculando = false;

  mensaje = '';

  mensajeError = '';


  // =====================================================
  // CONSTRUCTOR
  // =====================================================

  constructor(
    private vinculacionService: Vinculacion
  ) { }


  // =====================================================
  // INICIO
  // =====================================================

  ngOnInit() {

    console.log(
      'Página cuidador iniciada'
    );

  }


  // =====================================================
  // ABRIR MODAL
  // =====================================================

  abrirVinculacion() {

    this.codigo = '';

    this.mensaje = '';

    this.mensajeError = '';

    this.mostrarModal = true;

  }


  // =====================================================
  // CERRAR MODAL
  // =====================================================

  cerrarModal() {

    this.mostrarModal = false;

  }


  // =====================================================
  // VINCULAR POR CÓDIGO
  // =====================================================

  async vincularPorCodigo() {

    this.mensaje = '';

    this.mensajeError = '';


    // Eliminar espacios y mayúsculas

    this.codigo = this.codigo.trim().toUpperCase();


    // Validar código

    if (!this.codigo) {

      this.mensajeError =
        'Ingresa el código de vinculación.';

      return;

    }


    this.vinculando = true;


    try {

      // 1. Buscar el código para obtener el UUID del adulto mayor
      const codigoData =
        await this.vinculacionService.buscarCodigo(this.codigo);


      // 2. Enviar solicitud usando el id_usuario (UUID real)
      await this.vinculacionService
        .solicitarVinculacion(
          codigoData.id_usuario
        );


      this.mensaje =
        '✅ Solicitud enviada correctamente. El adulto mayor debe aceptar la vinculación.';


      this.codigo = '';


    } catch (error: any) {

      this.mensajeError =
        error?.message ??
        'No se pudo realizar la vinculación.';


    } finally {

      this.vinculando = false;

    }

  }


}
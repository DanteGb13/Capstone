import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CuidadoresService } from '../../../services/Backend/cuidadores/cuidadores';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonIcon
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';


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
    CommonModule,
    FormsModule
  ]

})


export class AdultoMayorPage implements OnInit {


  nombreUsuario: string = '';


  constructor(
    private cuidadoresService: CuidadoresService, private changeDetectorRef: ChangeDetectorRef, private router: Router    
  ) {

    // Carga todos los iconos Ionic
    addIcons(icons);

  }



  async ngOnInit() {

    this.nombreUsuario =
      await this.cuidadoresService.cargarUsuarioNombre();
    console.log("Nombre:", this.nombreUsuario);
    this.changeDetectorRef.detectChanges();
  }



  abrirPerfil() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/editar-informacion']);


  }



  irInicio() {

    console.log('Inicio');

  }


  abrirFamilia() {

    console.log('Familia');

  }


  abrirSOS() {

    console.log('SOS');

  }


  abrirAlertas() {

    console.log('Alertas');

  }


  abrirAjustes() {

    console.log('Ajustes');

  }


}
import { Component, OnInit } from '@angular/core';

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


  constructor() {

    // Carga todos los iconos de Ionic
    addIcons(icons);

  }


  ngOnInit() {

  }

  abrirPerfil(){

  console.log('Abrir perfil');

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
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';
import { FontSizeService } from '../../services/font-size/font-size';
import { ColorblindService } from '../../services/colorblind/colorblind.service';
import { VozService } from '../../services/voz/voz.service';

@Component({
  selector: 'app-ajustes',
  templateUrl: './ajustes.page.html',
  styleUrls: ['./ajustes.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    CommonModule
  ]
})
export class AjustesPage implements OnInit {

  constructor(
    private router: Router,
    private navRol: NavegacionRolService,
    public fontService: FontSizeService,
    public colorService: ColorblindService,
    public voz: VozService
  ) {
    addIcons(icons);
  }

  ngOnInit() {}

  irAPermisos() {
    this.router.navigate(['/permisos']);
  }

  irATamanoLetra() {
    this.router.navigate(['/tamano-letra']);
  }

  irAFiltroColor() {
    this.router.navigate(['/filtro-color']);
  }

  irAVoz() {
    this.router.navigate(['/voz']);
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }
}

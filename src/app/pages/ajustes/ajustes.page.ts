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
    private navRol: NavegacionRolService
  ) {
    addIcons(icons);
  }

  ngOnInit() {}

  irAPermisos() {
    this.router.navigate(['/permisos']);
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }
}

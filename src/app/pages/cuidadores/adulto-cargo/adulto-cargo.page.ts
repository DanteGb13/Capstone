import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonIcon
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';

@Component({
  selector: 'app-adulto-cargo',
  templateUrl: './adulto-cargo.page.html',
  styleUrls: ['./adulto-cargo.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonIcon,
    CommonModule,
    FormsModule
  ]
})
export class AdultoCargoPage implements OnInit {

  adultosACargo: any[] = [];
  cargando: boolean = false;

  constructor(
    private vinculacionService: Vinculacion,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    await this.cargarAdultos();
  }

  async cargarAdultos() {
    this.cargando = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();
    } catch (error: any) {
      console.error('Error al obtener adultos a cargo:', error);
    } finally {
      this.cargando = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  verUbicacion(adulto: any) {
    const id = adulto?.adulto_mayor?.id || adulto?.id_usuario || adulto?.id;
    if (id) {
      this.router.navigate(['/ubicacion'], { queryParams: { id } });
    } else {
      this.router.navigate(['/ubicacion']);
    }
  }

  verHistorial(adulto: any) {
    this.router.navigate(['/historial']);
  }

  llamarAdulto(telefono?: string) {
    if (telefono) {
      window.open(`tel:${telefono}`, '_system');
    }
  }

}

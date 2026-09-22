import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonBackButton
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { NavegacionRolService } from '../../../services/navegacion-rol/navegacion-rol';

@Component({
  selector: 'app-cuidado',
  templateUrl: './cuidado.page.html',
  styleUrls: ['./cuidado.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonBackButton,
    CommonModule
  ]
})
export class CuidadoPage implements OnInit {

  adultosACargo: any[] = [];
  cargandoAdultos = false;

  constructor(
    private vinculacionService: Vinculacion,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private navRol: NavegacionRolService
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    await this.cargarAdultos();
  }

  async ionViewWillEnter() {
    await this.cargarAdultos();
  }

  async cargarAdultos() {
    this.cargandoAdultos = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();
    } catch (e) {
      console.error('Error:', e);
    } finally {
      this.cargandoAdultos = false;
      this.cdr.detectChanges();
    }
  }

  verUbicacion(item: any) {
    const id = item?.adulto_mayor?.id || item?.id_usuario || item?.id;
    if (id) {
      this.router.navigate(['/ubicacion'], { queryParams: { id } });
    } else {
      this.router.navigate(['/ubicacion']);
    }
  }

  llamarAdulto(telefono: string) {
    if (telefono) {
      window.open(`tel:${telefono}`, '_system');
    }
  }

  verHistorial() {
    this.router.navigate(['/historial']);
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }
}

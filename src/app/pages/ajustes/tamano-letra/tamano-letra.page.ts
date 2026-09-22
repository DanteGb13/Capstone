import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonIcon, IonRadio, IonRadioGroup, IonLabel, IonList, IonItem } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, checkmarkOutline } from 'ionicons/icons';
import { FontSizeService, TamanoLetra } from '../../../services/font-size/font-size';

@Component({
  selector: 'app-tamano-letra',
  templateUrl: './tamano-letra.page.html',
  styleUrls: ['./tamano-letra.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonRadioGroup,
    IonItem,
    IonLabel,
    CommonModule
  ]
})
export class TamanoLetraPage {

  seleccionActual: TamanoLetra;

  constructor(
    private router: Router,
    public fontService: FontSizeService
  ) {
    addIcons({ chevronBackOutline, checkmarkOutline });
    this.seleccionActual = this.fontService.obtener();
  }

  seleccionar(tamano: TamanoLetra) {
    this.seleccionActual = tamano;
    this.fontService.guardar(tamano);
  }

  volver() {
    this.router.navigate(['/ajustes']);
  }

  getScalePreview(opcion: { scale: number }): string {
    return `font-size: ${16 * opcion.scale}px`;
  }
}

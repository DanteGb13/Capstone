import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-editar-informacion',
  templateUrl: './editar-informacion.page.html',
  styleUrls: ['./editar-informacion.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule]
})
export class EditarInformacionPage implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}

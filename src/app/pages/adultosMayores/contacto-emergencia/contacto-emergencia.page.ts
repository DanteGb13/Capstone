import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-contacto-emergencia',
  templateUrl: './contacto-emergencia.page.html',
  styleUrls: ['./contacto-emergencia.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule]
})
export class ContactoEmergenciaPage implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}

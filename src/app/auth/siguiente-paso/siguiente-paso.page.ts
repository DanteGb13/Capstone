import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-siguiente-paso',
  templateUrl: './siguiente-paso.page.html',
  styleUrls: ['./siguiente-paso.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule]
})
export class SiguientePasoPage implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}

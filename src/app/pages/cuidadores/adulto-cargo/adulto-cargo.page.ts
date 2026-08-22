import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-adulto-cargo',
  templateUrl: './adulto-cargo.page.html',
  styleUrls: ['./adulto-cargo.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule]
})
export class AdultoCargoPage implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}

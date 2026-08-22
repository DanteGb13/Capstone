import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-adulto-mayor',
  templateUrl: './adulto-mayor.page.html',
  styleUrls: ['./adulto-mayor.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule]
})
export class AdultoMayorPage implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}

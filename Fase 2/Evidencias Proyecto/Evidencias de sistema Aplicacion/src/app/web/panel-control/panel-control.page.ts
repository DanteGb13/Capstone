import { Component } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { WebNav } from '../web-nav/web-nav';

/**
 * Accesos directos del panel. Se guardan como constante porque el orden es
 * el de importancia: lo que más se usa va arriba.
 */
const SECCIONES = [
  {
    ruta: '/analitica',
    titulo: 'Analítica',
    detalle: 'Qué pantallas se usan más y desde dónde.'
  },
  {
    ruta: '/usuarios',
    titulo: 'Usuarios',
    detalle: 'Quién tiene cuenta y cuándo fue la última vez que entró.'
  },
  {
    ruta: '/reportes',
    titulo: 'Reportes',
    detalle: 'Exporta los datos de uso a un archivo CSV.'
  },
  {
    ruta: '/configuracion',
    titulo: 'Configuración',
    detalle: 'Cuenta de administración y qué datos se registran.'
  }
];

@Component({
  selector: 'app-panel-control',
  templateUrl: 'panel-control.page.html',
  styleUrls: ['panel-control.page.scss'],
  imports: [WebNav, RouterLink, IonContent],
})
export class PanelControlPage {
  readonly secciones = SECCIONES;
}

import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'cuidador',
    loadComponent: () => import('./pages/cuidadores/cuidador/cuidador.page').then( m => m.CuidadorPage)
  },
  {
    path: 'ubicacion',
    loadComponent: () => import('./pages/cuidadores/ubicacion/ubicacion.page').then( m => m.UbicacionPage)
  },
  {
    path: 'historial',
    loadComponent: () => import('./pages/cuidadores/historial/historial.page').then( m => m.HistorialPage)
  },
  {
    path: 'adulto-cargo',
    loadComponent: () => import('./pages/cuidadores/adulto-cargo/adulto-cargo.page').then( m => m.AdultoCargoPage)
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.page').then( m => m.LoginPage)
  },
  {
    path: 'registro',
    loadComponent: () => import('./auth/registro/registro.page').then( m => m.RegistroPage)
  },

  {
    path: 'adulto-mayor',
    loadComponent: () => import('./pages/adultosMayores/adulto-mayor/adulto-mayor.page').then( m => m.AdultoMayorPage)
  },
  {
    path: 'contacto-emergencia',
    loadComponent: () => import('./pages/adultosMayores/contacto-emergencia/contacto-emergencia.page').then( m => m.ContactoEmergenciaPage)
  },
  {
    path: 'informacion',
    loadComponent: () => import('./pages/adultosMayores/informacion/informacion.page').then( m => m.InformacionPage)
  },
  {
    path: 'editar-informacion',
    loadComponent: () => import('./pages/adultosMayores/editar-informacion/editar-informacion.page').then( m => m.EditarInformacionPage)
  },
  {
    path: 'estado',
    loadComponent: () => import('./pages/cuidadores/estado/estado.page').then( m => m.EstadoPage)
  },



  //Saltos de paginas no existentes
    {
    path: '**',
    loadComponent: () => import('./error/error/error.page').then( m => m.ErrorPage)
  },

];

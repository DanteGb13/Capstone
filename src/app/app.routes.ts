import { Routes } from '@angular/router';
import { noAuthGuard, siguientePasoGuard, authGuard } from './services/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
    canActivate: [authGuard]
  },
  {
    path: 'cuidador',
    loadComponent: () => import('./pages/cuidadores/cuidador/cuidador.page').then( m => m.CuidadorPage),
    canActivate: [authGuard]
  },
  {
    path: 'ubicacion',
    loadComponent: () => import('./pages/cuidadores/ubicacion/ubicacion.page').then( m => m.UbicacionPage),
    canActivate: [authGuard]
  },
  {
    path: 'historial',
    loadComponent: () => import('./pages/cuidadores/historial/historial.page').then( m => m.HistorialPage),
    canActivate: [authGuard]
  },
  {
    path: 'adulto-cargo',
    loadComponent: () => import('./pages/cuidadores/adulto-cargo/adulto-cargo.page').then( m => m.AdultoCargoPage),
    canActivate: [authGuard]
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.page').then( m => m.LoginPage),
    canActivate: [noAuthGuard]
  },
  {
    path: 'registro',
    loadComponent: () => import('./auth/registro/registro.page').then( m => m.RegistroPage),
    canActivate: [noAuthGuard]
  },
  {
    path: 'siguiente-paso',
    loadComponent: () => import('./auth/siguiente-paso/siguiente-paso.page').then( m => m.SiguientePasoPage),
    canActivate: [siguientePasoGuard]
  },
  {
    path: 'elegir-tipo',
    loadComponent: () => import('./auth/elegir-tipo/elegir-tipo.page').then( m => m.ElegirTipoPage)
  },
  {
    path: 'adulto-mayor',
    loadComponent: () => import('./pages/adultosMayores/adulto-mayor/adulto-mayor.page').then( m => m.AdultoMayorPage),
    canActivate: [authGuard]
  },
  {
    path: 'contacto-emergencia',
    loadComponent: () => import('./pages/adultosMayores/contacto-emergencia/contacto-emergencia.page').then( m => m.ContactoEmergenciaPage),
    canActivate: [authGuard]
  },
  {
    path: 'informacion',
    loadComponent: () => import('./pages/adultosMayores/informacion/informacion.page').then( m => m.InformacionPage),
    canActivate: [authGuard]
  },
  {
    path: 'editar-informacion',
    loadComponent: () => import('./pages/adultosMayores/editar-informacion/editar-informacion.page').then( m => m.EditarInformacionPage),
    canActivate: [authGuard]
  },
  {
    path: 'estado',
    loadComponent: () => import('./pages/cuidadores/estado/estado.page').then( m => m.EstadoPage),
    canActivate: [authGuard]
  },
  
  
  
  
  
  
  
  
  // Saltos de paginas no existentes
  {
    path: '**',
    loadComponent: () => import('./error/error/error.page').then( m => m.ErrorPage)
  },  {
    path: 'ajustes',
    loadComponent: () => import('./pages/ajustes/ajustes.page').then( m => m.AjustesPage)
  }

];

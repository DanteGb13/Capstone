import { Routes } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  noAuthGuard,
  siguientePasoGuard,
  authGuard,
  onboardingPermisosGuard,
  soloAppGuard
} from './services/guards/auth.guard';
import { rolGuard } from './services/guards/rol.guard';
import { soloWebGuard, noAccesoGuard } from './web/acceso/acceso.guard';

// La app abre en el login; la web (celular o PC) abre en la página de inicio
// pública. `home` sigue reservada para la pantalla principal ya autenticada.
const rutaInicial = Capacitor.isNativePlatform() ? 'login' : 'inicio';

export const routes: Routes = [
  {
    path: '',
    redirectTo: rutaInicial,
    pathMatch: 'full',
  },
  {
    path: 'inicio',
    loadComponent: () => import('./web/inicio/inicio.page').then((m) => m.InicioPage)
  },
  {
    path: 'planes',
    loadComponent: () => import('./web/planes/planes.page').then((m) => m.PlanesPage)
  },
  {
    path: 'descarga',
    loadComponent: () => import('./web/descarga/descarga.page').then((m) => m.DescargaPage)
  },
  {
    path: 'contactanos',
    loadComponent: () => import('./web/contactanos/contactanos.page').then((m) => m.ContactanosPage)
  },
  {
    // Acceso de la web: pantalla, servicio y guards propios, todos dentro de
    // `web/acceso/`. No reutiliza nada del acceso de la app (`/login`).
    path: 'acceso',
    loadComponent: () => import('./web/acceso/acceso.page').then((m) => m.AccesoPage),
    canActivate: [soloWebGuard, noAccesoGuard]
  },
  {
    path: 'panel-control',
    loadComponent: () => import('./web/panel-control/panel-control.page').then((m) => m.PanelControlPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    path: 'analitica',
    loadComponent: () => import('./web/analitica/analitica.page').then((m) => m.AnaliticaPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    path: 'usuarios',
    loadComponent: () => import('./web/usuarios/usuarios.page').then((m) => m.UsuariosPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    // Sección propia para cambiar rol y estado de una cuenta. Va aparte de
    // /usuarios a propósito: la lista es de sólo lectura, y las acciones que
    // tocan la tabla `usuario` se separan para que nadie las ejecute sin
    // darse cuenta desde una tabla.
    path: 'gestion-usuarios',
    loadComponent: () => import('./web/gestion-usuarios/gestion-usuarios.page').then((m) => m.GestionUsuariosPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    path: 'reportes',
    loadComponent: () => import('./web/reportes/reportes.page').then((m) => m.ReportesPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    path: 'configuracion',
    loadComponent: () => import('./web/configuracion/configuracion.page').then((m) => m.ConfiguracionPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    path: 'mi-perfil',
    loadComponent: () => import('./web/mi-perfil/mi-perfil.page').then((m) => m.MiPerfilPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    path: 'cambiar-contrasena',
    loadComponent: () => import('./web/cambiar-contrasena/cambiar-contrasena.page').then((m) => m.CambiarContrasenaPage),
    canActivate: [rolGuard(['Administrador'])]
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
    canActivate: [authGuard]
  },
  {
    path: 'cuidador',
    loadComponent: () => import('./pages/cuidadores/cuidador/cuidador.page').then( m => m.CuidadorPage),
    canActivate: [authGuard, onboardingPermisosGuard]
  },
  {
    path: 'cuidado',
    loadComponent: () => import('./pages/cuidadores/cuidado/cuidado.page').then( m => m.CuidadoPage),
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
    path: 'contactos-cuidador',
    loadComponent: () => import('./pages/cuidadores/contactos-cuidador/contactos-cuidador.page').then( m => m.ContactosCuidadorPage),
    canActivate: [authGuard]
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.page').then( m => m.LoginPage),
    canActivate: [soloAppGuard, noAuthGuard]
  },
  {
    path: 'registro',
    loadComponent: () => import('./auth/registro/registro.page').then( m => m.RegistroPage),
    canActivate: [soloAppGuard, noAuthGuard]
  },
  {
    path: 'siguiente-paso',
    loadComponent: () => import('./auth/siguiente-paso/siguiente-paso.page').then( m => m.SiguientePasoPage),
    canActivate: [soloAppGuard, siguientePasoGuard]
  },
  {
    path: 'elegir-tipo',
    loadComponent: () => import('./auth/elegir-tipo/elegir-tipo.page').then( m => m.ElegirTipoPage),
    canActivate: [soloAppGuard, siguientePasoGuard]
  },
  {
    path: 'adulto-mayor',
    loadComponent: () => import('./pages/adultosMayores/adulto-mayor/adulto-mayor.page').then( m => m.AdultoMayorPage),
    canActivate: [authGuard, onboardingPermisosGuard]
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
    path: 'perfil',
    loadComponent: () => import('./pages/perfil/perfil.page').then( m => m.PerfilPage),
    canActivate: [authGuard]
  },
  {
    path: 'recordatorios',
    loadComponent: () => import('./pages/adultosMayores/recordatorios/recordatorios.page').then( m => m.RecordatoriosPage),
    canActivate: [authGuard]
  },
  {
    path: 'mi-ubicacion',
    loadComponent: () => import('./pages/adultosMayores/mi-ubicacion/mi-ubicacion.page').then( m => m.MiUbicacionPage),
    canActivate: [authGuard]
  },
  {
    path: 'zona-segura',
    loadComponent: () => import('./pages/zona-segura/zona-segura.page').then( m => m.ZonaSeguraPage),
    canActivate: [authGuard]
  },
  {
    path: 'juegos',
    loadComponent: () => import('./pages/juegos/juegos.page').then( m => m.JuegosPage),
    canActivate: [authGuard]
  },
  {
    path: 'juegos/memoria',
    loadComponent: () => import('./pages/memoria/memoria.page').then( m => m.MemoriaPage),
    canActivate: [authGuard]
  },
  {
    path: 'juegos/sopa-letras',
    loadComponent: () => import('./pages/sopa-letras/sopa-letras.page').then( m => m.SopaLetrasPage),
    canActivate: [authGuard]
  },
  {
    path: 'juegos/rompecabezas',
    loadComponent: () => import('./pages/rompecabezas/rompecabezas.page').then( m => m.RompecabezasPage),
    canActivate: [authGuard]
  },
  {
    path: 'juegos/tic-tac-toe',
    loadComponent: () => import('./pages/tic-tac-toe/tic-tac-toe.page').then( m => m.TicTacToePage),
    canActivate: [authGuard]
  },
  {
    path: 'juegos/memoria-secuencias',
    loadComponent: () => import('./pages/memoria-secuencias/memoria-secuencias.page').then( m => m.MemoriaSecuenciasPage),
    canActivate: [authGuard]
  },
  {
    path: 'estado',
    loadComponent: () => import('./pages/cuidadores/estado/estado.page').then( m => m.EstadoPage),
    canActivate: [authGuard]
  },
  {
    path: 'panel-actividad',
    loadComponent: () => import('./pages/cuidadores/panel-actividad/panel-actividad.page').then( m => m.PanelActividadPage),
    canActivate: [authGuard]
  },
  {
    path: 'ajustes',
    loadComponent: () => import('./pages/ajustes/ajustes.page').then( m => m.AjustesPage),
    canActivate: [authGuard]
  },
  {
    path: 'permisos',
    loadComponent: () => import('./pages/ajustes/permisos/permisos.page').then( m => m.PermisosPage),
    canActivate: [authGuard]
  },
  {
    path: 'permisos-inicial',
    loadComponent: () => import('./pages/ajustes/permisos-inicial/permisos-inicial.page').then( m => m.PermisosInicialPage),
    canActivate: [authGuard]
  },
  {
    path: 'tamano-letra',
    loadComponent: () => import('./pages/ajustes/tamano-letra/tamano-letra.page').then( m => m.TamanoLetraPage),
    canActivate: [authGuard]
  },
  {
    path: 'filtro-color',
    loadComponent: () => import('./pages/ajustes/filtro-color/filtro-color.page').then( m => m.FiltroColorPage),
    canActivate: [authGuard]
  },
  {
    path: 'voz',
    loadComponent: () => import('./pages/ajustes/voz/voz.page').then( m => m.VozPage),
    canActivate: [authGuard]
  },
  {
    // Índice de la sección de privacidad. Los seis documentos van en páginas
    // aparte: `privacidad.page` sólo lista y abre, no repite el texto.
    path: 'privacidad',
    loadComponent: () => import('./pages/ajustes/privacidad/privacidad.page').then( m => m.PrivacidadPage),
    canActivate: [authGuard]
  },
  {
    path: 'privacidad-datos',
    loadComponent: () => import('./pages/ajustes/privacidad/privacidad-datos.page').then( m => m.PrivacidadDatosPage),
    canActivate: [authGuard]
  },
  {
    path: 'privacidad-terminos',
    loadComponent: () => import('./pages/ajustes/privacidad/privacidad-terminos.page').then( m => m.PrivacidadTerminosPage),
    canActivate: [authGuard]
  },
  {
    path: 'privacidad-seguridad',
    loadComponent: () => import('./pages/ajustes/privacidad/privacidad-seguridad.page').then( m => m.PrivacidadSeguridadPage),
    canActivate: [authGuard]
  },
  {
    path: 'privacidad-estandares',
    loadComponent: () => import('./pages/ajustes/privacidad/privacidad-estandares.page').then( m => m.PrivacidadEstandaresPage),
    canActivate: [authGuard]
  },
  {
    path: 'privacidad-derechos',
    loadComponent: () => import('./pages/ajustes/privacidad/privacidad-derechos.page').then( m => m.PrivacidadDerechosPage),
    canActivate: [authGuard]
  },
  {
    path: 'privacidad-contacto',
    loadComponent: () => import('./pages/ajustes/privacidad/privacidad-contacto.page').then( m => m.PrivacidadContactoPage),
    canActivate: [authGuard]
  },
  {
    path: 'recuperar-contrasena',
    loadComponent: () => import('./auth/recuperar-contrasena/recuperar-contrasena.page').then( m => m.RecuperarContrasenaPage),
    canActivate: [soloAppGuard]
  },
  {
    path: 'correo-contrasena',
    loadComponent: () => import('./auth/correo-contrasena/correo-contrasena.page').then( m => m.CorreoContrasenaPage),
    canActivate: [soloAppGuard]
  },
 
 
 
 
 
 
 
  // Saltos de paginas no existentes
  {
    path: '**',
    loadComponent: () => import('./error/error/error.page').then( m => m.ErrorPage)
  }

];
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  NavegacionRolService,
  RUTAS_CUIDADOR,
  RUTAS_ADULTO_MAYOR,
  RUTAS_ADMIN,
  RUTAS_PANEL_ADMIN
} from './navegacion-rol';

describe('NavegacionRolService', () => {
  let service: NavegacionRolService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])]
    });
    service = TestBed.inject(NavegacionRolService);
  });

  it('debe crear el servicio', () => {
    expect(service).toBeTruthy();
  });

  it('rutaPrincipal devuelve el panel segun el rol', () => {
    expect(service.rutaPrincipal('Familiar')).toBe('/cuidador');
    expect(service.rutaPrincipal('Usuario')).toBe('/adulto-mayor');
    expect(service.rutaPrincipal('Administrador')).toBe('/panel-control');
    expect(service.rutaPrincipal(null)).toBe('/adulto-mayor');
  });

  it('las rutas compartidas por ambos roles no pueden estar en las dos listas', () => {
    // authGuard evalua la URL actual (no el destino). Si una ruta de ambos
    // roles esta en ambas listas, el guard entra en bucle al salir de ella y
    // el boton de regresar deja de navegar.
    const compartidas = RUTAS_CUIDADOR.filter((ruta) => RUTAS_ADULTO_MAYOR.includes(ruta));
    expect(compartidas).toEqual([]);
    expect(RUTAS_CUIDADOR).not.toContain('/zona-segura');
    expect(RUTAS_ADULTO_MAYOR).not.toContain('/zona-segura');
  });

  it('las listas mantienen las rutas propias de cada rol', () => {
    expect(RUTAS_CUIDADOR).toContain('/cuidador');
    expect(RUTAS_CUIDADOR).toContain('/contactos-cuidador');
    expect(RUTAS_ADULTO_MAYOR).toContain('/adulto-mayor');
  });

  it('verificarAccesoConRol deja pasar al rol correcto y redirige al otro', () => {
    // authGuard usa esta versión con el rol que ya pidió: no consulta la base,
    // así que cada navegación se ahorra un viaje a la red.
    expect(service.verificarAccesoConRol('Usuario', '/contacto-emergencia')).toBeNull();
    expect(service.verificarAccesoConRol('Familiar', '/cuidador')).toBeNull();

    expect(service.verificarAccesoConRol('Familiar', '/contacto-emergencia')).toBe('/cuidador');
    expect(service.verificarAccesoConRol('Usuario', '/contactos-cuidador')).toBe('/adulto-mayor');
    expect(service.verificarAccesoConRol('Usuario', '/cuidador')).toBe('/adulto-mayor');
    expect(service.verificarAccesoConRol(null, '/cuidador')).toBeNull();
  });

  it('el administrador solo ve la web publica y su panel', () => {
    // Lista blanca: cualquier ruta que no esté en RUTAS_ADMIN lo devuelve a
    // /panel-control, así que no llega a ninguna pantalla de la app.
    for (const ruta of RUTAS_ADMIN) {
      expect(service.verificarAccesoConRol('Administrador', ruta)).toBeNull();
    }

    const rutasDeApp = [
      '/adulto-mayor',
      '/cuidador',
      '/home',
      '/ajustes',
      '/perfil',
      '/zona-segura',
      '/juegos',
      '/permisos',
      '/privacidad'
    ];
    for (const ruta of rutasDeApp) {
      expect(service.verificarAccesoConRol('Administrador', ruta)).toBe('/panel-control');
    }
  });

  it('la lista blanca del administrador siempre contiene su propio panel', () => {
    // Si /panel-control no estuviera en la lista, redirigirse a sí mismo
    // generaría un bucle infinito en el guard.
    expect(RUTAS_ADMIN).toContain('/panel-control');
  });

  it('la lista blanca del administrador no incluye rutas de la app', () => {
    const rutasDeApp = [...RUTAS_CUIDADOR, ...RUTAS_ADULTO_MAYOR, '/home', '/ajustes', '/perfil'];
    const invasoras = RUTAS_ADMIN.filter((ruta) => rutasDeApp.includes(ruta));
    expect(invasoras).toEqual([]);
  });

  it('las rutas del panel del administrador no se analizan ni son de la app', () => {
    // Las páginas del panel están dentro de la lista blanca (el administrador
    // sí puede abrirlas), pero se guardan aparte porque el servicio de
    // analítica las ignora: mirar el propio panel no es dato de uso.
    expect(RUTAS_ADMIN).toEqual(expect.arrayContaining(RUTAS_PANEL_ADMIN));

    const rutasDeApp = [...RUTAS_CUIDADOR, ...RUTAS_ADULTO_MAYOR, '/home', '/ajustes', '/perfil'];
    const invasoras = RUTAS_PANEL_ADMIN.filter((ruta) => rutasDeApp.includes(ruta));
    expect(invasoras).toEqual([]);
  });

  // -------------------------------------------------------------------
  // El Administrador es de la web: en la app móvil no tiene pantallas.
  // -------------------------------------------------------------------

  describe('el administrador en la app móvil', () => {

    beforeEach(() => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('no tiene panel propio: va a la landing pública', () => {
      // /inicio no tiene guard, así que es un callejón sin salida: no hay
      // riesgo de bucle de redirecciones.
      expect(service.rutaPrincipal('Administrador')).toBe('/inicio');
    });

    it('ninguna pantalla de la app lo deja entrar', () => {
      const rutas = [
        ...RUTAS_CUIDADOR,
        ...RUTAS_ADULTO_MAYOR,
        '/home',
        '/ajustes',
        '/perfil',
        '/zona-segura',
        '/juegos'
      ];

      for (const ruta of rutas) {
        expect(service.verificarAccesoConRol('Administrador', ruta)).toBe('/inicio');
      }
    });

    it('tampoco el panel de la web, escrito a mano', () => {
      for (const ruta of RUTAS_PANEL_ADMIN) {
        expect(service.verificarAccesoConRol('Administrador', ruta)).toBe('/inicio');
      }
    });

    it('los roles de la app no se ven afectados', () => {
      expect(service.rutaPrincipal('Familiar')).toBe('/cuidador');
      expect(service.rutaPrincipal('Usuario')).toBe('/adulto-mayor');
      expect(service.verificarAccesoConRol('Familiar', '/cuidador')).toBeNull();
      expect(service.verificarAccesoConRol('Usuario', '/mi-ubicacion')).toBeNull();
    });
  });
});

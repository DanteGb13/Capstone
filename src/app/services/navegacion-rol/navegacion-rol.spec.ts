import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  NavegacionRolService,
  RUTAS_CUIDADOR,
  RUTAS_ADULTO_MAYOR
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
    expect(RUTAS_ADULTO_MAYOR).toContain('/adulto-mayor');
  });

  it('verificarAccesoConRol deja pasar al rol correcto y redirige al otro', () => {
    // authGuard usa esta versión con el rol que ya pidió: no consulta la base,
    // así que cada navegación se ahorra un viaje a la red.
    expect(service.verificarAccesoConRol('Usuario', '/contacto-emergencia')).toBeNull();
    expect(service.verificarAccesoConRol('Familiar', '/cuidador')).toBeNull();

    expect(service.verificarAccesoConRol('Familiar', '/contacto-emergencia')).toBe('/cuidador');
    expect(service.verificarAccesoConRol('Usuario', '/cuidador')).toBe('/adulto-mayor');
    expect(service.verificarAccesoConRol(null, '/cuidador')).toBeNull();
  });
});

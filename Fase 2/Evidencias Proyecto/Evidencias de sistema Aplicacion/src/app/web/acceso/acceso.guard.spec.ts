import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import type { CanActivateFn } from '@angular/router';

import { soloWebGuard, noAccesoGuard } from './acceso.guard';
import { AccesoService, EstadoAcceso } from './acceso.service';

describe('guards del acceso de la web', () => {
  let navigate: ReturnType<typeof vi.fn>;

  /** Último estado devuelto por el servicio simulado. */
  let estado: EstadoAcceso;

  /** El reparto real, escrito en el test para no depender de la implementación. */
  const destinoPara = (rol: string): string | null => {
    if (estado.motivo !== 'ok') return null;
    if (rol === 'Administrador') return '/panel-control';
    if (rol === 'Familiar') return '/cuidador';
    if (rol === 'Usuario') return '/adulto-mayor';
    return null;
  };

  async function preparar() {
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AccesoService,
          useValue: { leerEstado: async () => estado, destinoPara },
        },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
  }

  const correr = (guard: CanActivateFn) =>
    TestBed.runInInjectionContext(() => guard({} as never, {} as never));

  beforeEach(() => {
    estado = { motivo: 'sin-sesion' };
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  // ---------------------------------------------------------------
  // soloWebGuard
  // ---------------------------------------------------------------

  describe('soloWebGuard', () => {
    it('deja /acceso en el navegador', async () => {
      await preparar();

      expect(await correr(soloWebGuard)).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('en el celular no existe: va al login de la app', async () => {
      // Cada plataforma tiene su pantalla de entrada y no se cruzan. Sin
      // esto, abriendo la URL a mano se vería el formulario de la web
      // adentro de la app.
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      await preparar();

      expect(await correr(soloWebGuard)).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    });
  });

  // ---------------------------------------------------------------
  // noAccesoGuard
  // ---------------------------------------------------------------

  describe('noAccesoGuard', () => {
    it('con sesión ya abierta manda a su panel y no pide credenciales', async () => {
      estado = { motivo: 'ok', rol: 'Administrador' };
      await preparar();

      expect(await correr(noAccesoGuard)).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/panel-control'], { replaceUrl: true });
    });

    it('sin sesión deja pasar: la pantalla es la que pide los datos', async () => {
      await preparar();

      expect(await correr(noAccesoGuard)).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('con perfil incompleto deja pasar en vez de expulsarlo', async () => {
      // No hay adónde mandar (en la app eso es /elegir-tipo, que aquí no
      // existe). Sacarlo a la landing sólo borraría el aviso que explica
      // dónde se termina el registro.
      estado = { motivo: 'perfil-incompleto' };
      await preparar();

      expect(await correr(noAccesoGuard)).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('si la lectura falló no expulsa: la pantalla puede seguir probando', async () => {
      // Sacarlo por un corte de red sería cerrarle la puerta en la cara por
      // algo que no es su culpa, y el mensaje de error se perdería igual.
      estado = { motivo: 'error' };
      await preparar();

      expect(await correr(noAccesoGuard)).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';

import {
  noAuthGuard,
  siguientePasoGuard,
  authGuard,
  onboardingPermisosGuard,
  soloAppGuard
} from './auth.guard';
import { SupabaseService } from '../supabase/supabase';
import { NavegacionRolService } from '../navegacion-rol/navegacion-rol';
import { PermisosService } from '../permisos/permisos.service';

/** Usuario completo: tiene sesión, rut y dirección. */
const PERFIL_COMPLETO = {
  id: 'usuario-1',
  rut: '123456785',
  id_direccion: 'dir-1',
  id_rol: 1,
  rol: { id: 1, nombre: 'Usuario' }
};

/**
 * Cliente de Supabase simulado.
 *
 * Solo se implementa la parte del constructor de consultas que usan los guards:
 * from().select().eq().maybeSingle() y auth.getSession().
 */
function crearSupabaseMock(opciones: {
  sesion?: any;
  errorSesion?: any;
  perfil?: any;
  errorPerfil?: any;
}) {
  const desde = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: opciones.perfil ?? null,
          error: opciones.errorPerfil ?? null
        })
      })
    })
  });

  return {
    getClient: () => ({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: opciones.sesion ?? null },
          error: opciones.errorSesion ?? null
        })
      },
      from: desde
    })
  };
}

const SESION_VALIDA = { user: { id: 'usuario-1' } };

describe('guards de autenticacion', () => {
  let router: { navigate: ReturnType<typeof vi.fn>; url: string };

  /** Corre un guard dentro de un contexto de inyeccion, como haria Angular. */
  function correr(guard: any): Promise<boolean> {
    return TestBed.runInInjectionContext(() => guard());
  }

  function configurar(
    supabase: any,
    extras: { url?: string; onboardingHecho?: boolean } = {}
  ) {
    router = { navigate: vi.fn(), url: extras.url ?? '/adulto-mayor' };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouterStub(router),
        { provide: SupabaseService, useValue: supabase },
        {
          provide: PermisosService,
          useValue: { onboardingCompletado: () => extras.onboardingHecho ?? true }
        }
      ]
    });
  }

  function provideRouterStub(fake: any) {
    return [
      {
        provide: Router,
        useValue: {
          navigate: fake.navigate,
          get url() {
            return fake.url;
          }
        }
      }
    ];
  }

  beforeEach(() => {
    TestBed.resetTestingModule();

    // Por defecto se prueba como si corriera en el celular: es el flujo de la
    // app, y los guards que se bifurcan por plataforma dependen de eso. Las
    // pruebas de la web lo invierten con `vi.mocked` en el caso puntual.
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===================================================================
  // noAuthGuard: protege Login y Registro
  // ===================================================================

  describe('noAuthGuard', () => {
    it('deja pasar a quien no tiene sesion', async () => {
      configurar(crearSupabaseMock({}));

      expect(await correr(noAuthGuard)).toBe(true);
    });

    it('manda a su panel a quien ya entro con el perfil completo', async () => {
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: PERFIL_COMPLETO }));

      expect(await correr(noAuthGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/adulto-mayor'], { replaceUrl: true });
    });

    it('manda al panel del cuidador si ese es su rol', async () => {
      configurar(
        crearSupabaseMock({
          sesion: SESION_VALIDA,
          perfil: { ...PERFIL_COMPLETO, rol: { id: 2, nombre: 'Familiar' } }
        })
      );

      await correr(noAuthGuard);
      expect(router.navigate).toHaveBeenCalledWith(['/cuidador'], { replaceUrl: true });
    });

    it('manda a elegir-tipo si le falta completar el perfil', async () => {
      // Esta existe justo para que alguien a medio registrar no se quede
      // dando vueltas entre Login y Registro.
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: { id: 'usuario-1' } }));

      expect(await correr(noAuthGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/elegir-tipo'], { replaceUrl: true });
    });

    it('trata como incompleto un perfil sin direccion', async () => {
      configurar(
        crearSupabaseMock({
          sesion: SESION_VALIDA,
          perfil: { id: 'usuario-1', rut: '123456785', id_direccion: null }
        })
      );

      await correr(noAuthGuard);
      expect(router.navigate).toHaveBeenCalledWith(['/elegir-tipo'], { replaceUrl: true });
    });
  });

  // ===================================================================
  // soloAppGuard: Login, Registro, Elegir tipo y Siguiente paso
  // ===================================================================

  describe('soloAppGuard', () => {
    it('deja las pantallas de acceso en el celular', async () => {
      configurar(crearSupabaseMock({}));

      expect(await correr(soloAppGuard)).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('en la web no existen: van a la landing publica', async () => {
      // La web tendra su propio acceso aparte. Mientras tanto, entrar a
      // /login desde el navegador no debe dejar a nadie en una pantalla de
      // la app movil.
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      configurar(crearSupabaseMock({}));

      expect(await correr(soloAppGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/inicio'], { replaceUrl: true });
    });
  });

  // ===================================================================
  // siguientePasoGuard
  // ===================================================================

  describe('siguientePasoGuard', () => {
    it('manda a login a quien no tiene sesion', async () => {
      configurar(crearSupabaseMock({}));

      expect(await correr(siguientePasoGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    });

    it('deja pasar a quien esta autenticado pero incompleto', async () => {
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: { id: 'usuario-1' } }));

      expect(await correr(siguientePasoGuard)).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('saca a quien ya termino de registrarse', async () => {
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: PERFIL_COMPLETO }));

      expect(await correr(siguientePasoGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/adulto-mayor'], { replaceUrl: true });
    });
  });

  // ===================================================================
  // authGuard: pantallas protegidas
  // ===================================================================

  describe('authGuard', () => {
    it('manda a login a quien no tiene sesion', async () => {
      configurar(crearSupabaseMock({}), { url: '/mi-ubicacion' });

      expect(await correr(authGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    });

    it('manda a elegir-tipo a quien esta autenticado pero incompleto', async () => {
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: { id: 'usuario-1' } }));

      expect(await correr(authGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/elegir-tipo'], { replaceUrl: true });
    });

    it('deja pasar al adulto mayor en una pantalla suya', async () => {
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: PERFIL_COMPLETO }), {
        url: '/mi-ubicacion'
      });

      expect(await correr(authGuard)).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('saca al adulto mayor de una pantalla del cuidador', async () => {
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: PERFIL_COMPLETO }), {
        url: '/cuidador'
      });

      expect(await correr(authGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/adulto-mayor'], { replaceUrl: true });
    });

    it('deja pasar por una pantalla compartida sin mandarlo a otro panel', async () => {
      // /perfil y /ajustes son de los dos: si el guard los confundiera con una
      // ruta de un rol solo, expulsaria al usuario de su propia pantalla.
      configurar(crearSupabaseMock({ sesion: SESION_VALIDA, perfil: PERFIL_COMPLETO }), {
        url: '/perfil'
      });

      expect(await correr(authGuard)).toBe(true);
    });
  });

  // ===================================================================
  // Fallos de red: no deben cerrar la sesion
  // ===================================================================

  describe('cuando falla la red', () => {
    it('no expulsa al usuario de las pantallas protegidas', async () => {
      // Es el peor falla posible si no: perder la sesion por un hueco de señal.
      configurar(crearSupabaseMock({ errorSesion: new Error('sin red') }), {
        url: '/mi-ubicacion'
      });

      expect(await correr(authGuard)).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('tampoco lo manda a completar el perfil', async () => {
      // La sesion esta bien y lo que falla es la consulta del perfil: si eso se
      // tomara como "perfil incompleto", cada corte de red botaria a la persona
      // a /elegir-tipo y le haria elegir su tipo de cuenta otra vez.
      configurar(
        crearSupabaseMock({ sesion: SESION_VALIDA, errorPerfil: new Error('sin red') }),
        { url: '/mi-ubicacion' }
      );

      expect(await correr(authGuard)).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // onboardingPermisosGuard
  // ===================================================================

  describe('onboardingPermisosGuard', () => {
    it('pide los permisos la primera vez', async () => {
      configurar(crearSupabaseMock({}), { url: '/adulto-mayor', onboardingHecho: false });

      expect(await correr(onboardingPermisosGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/permisos-inicial'], { replaceUrl: true });
    });

    it('no vuelve a pedir los permisos si ya se hicieron', async () => {
      configurar(crearSupabaseMock({}), { url: '/adulto-mayor', onboardingHecho: true });

      expect(await correr(onboardingPermisosGuard)).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('no se manda a si mismo cuando ya esta en esa pantalla', async () => {
      // Sin esta excepcion se redirigiria a /permisos-inicial estando ahi y el
      // boton de regresar no saldria nunca.
      configurar(crearSupabaseMock({}), {
        url: '/permisos-inicial',
        onboardingHecho: false
      });

      expect(await correr(onboardingPermisosGuard)).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });
});
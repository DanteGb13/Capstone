import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AccesoPage } from './acceso.page';
import { AccesoService, EstadoAcceso } from './acceso.service';

describe('AccesoPage', () => {
  let component: AccesoPage;
  let fixture: ComponentFixture<AccesoPage>;
  let iniciarSesion: ReturnType<typeof vi.fn>;
  let leerEstado: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  /** `destinoPara` es el reparto real, escrito a mano: no se mockea. */
  const destinoPara = (rol: string) =>
    rol === 'Administrador' ? '/panel-control'
    : rol === 'Familiar' ? '/cuidador'
    : rol === 'Usuario' ? '/adulto-mayor'
    : null;

  async function preparar(estado: EstadoAcceso) {
    iniciarSesion = vi.fn().mockResolvedValue(undefined);
    leerEstado = vi.fn().mockResolvedValue(estado);

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AccesoService,
          useValue: { iniciarSesion, leerEstado, destinoPara, mensajeDeError: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccesoPage);
    component = fixture.componentInstance;
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('se crea', async () => {
    await preparar({ motivo: 'sin-sesion' });
    expect(component).toBeTruthy();
  });

  it('manda a cada rol a su panel', async () => {
    const destinos: Array<[string, string]> = [
      ['Administrador', '/panel-control'],
      ['Familiar', '/cuidador'],
      ['Usuario', '/adulto-mayor'],
    ];

    for (const [rol, destino] of destinos) {
      TestBed.resetTestingModule();
      await preparar({ motivo: 'ok', rol });
      component.correo = 'alguien@correo.cl';
      component.contrasena = 'secreta';

      await component.entrar();

      expect(navigate).toHaveBeenCalledWith([destino], { replaceUrl: true });
    }
  });

  it('pide los dos campos antes de llamar al servidor', async () => {
    await preparar({ motivo: 'ok', rol: 'Usuario' });
    component.correo = '   ';
    component.contrasena = '';

    await component.entrar();

    expect(iniciarSesion).not.toHaveBeenCalled();
    expect(component.mensajeError).toBe('Escribe tu correo y tu contraseña.');
  });

  it('explica el registro incompleto en vez de mandarlo a una pantalla vacía', async () => {
    await preparar({ motivo: 'perfil-incompleto' });
    component.correo = 'alguien@correo.cl';
    component.contrasena = 'secreta';

    await component.entrar();

    expect(navigate).not.toHaveBeenCalled();
    expect(component.mensajeError).toContain('incompleto');
    expect(component.mensajeError).toContain('app móvil');
  });

  it('avisa cuando el rol no se pudo leer, sin mandarlo a ningún lado', async () => {
    await preparar({ motivo: 'sin-rol' });
    component.correo = 'alguien@correo.cl';
    component.contrasena = 'secreta';

    await component.entrar();

    expect(navigate).not.toHaveBeenCalled();
    expect(component.mensajeError).toContain('Contáctanos');
  });

  it('distingue un fallo de lectura de un rol desconocido', async () => {
    // El mensaje viejo cubría los dos casos, y por eso un error de RLS
    // aparecía como "no sabemos tu rol", que no lleva a ninguna parte.
    await preparar({ motivo: 'error' });
    component.correo = 'alguien@correo.cl';
    component.contrasena = 'secreta';

    await component.entrar();

    expect(navigate).not.toHaveBeenCalled();
    expect(component.mensajeError).toContain('No pudimos leer tu cuenta');
    expect(component.mensajeError).not.toContain('Contáctanos');
  });

  it('traduce el error de credenciales cuando el servicio lo lanza', async () => {
    await preparar({ motivo: 'sin-sesion' });
    iniciarSesion.mockRejectedValue(new Error('Invalid login credentials'));
    const mensaje = vi.fn().mockReturnValue('El correo o la contraseña no coinciden.');
    TestBed.inject(AccesoService).mensajeDeError = mensaje;

    component.correo = 'alguien@correo.cl';
    component.contrasena = 'equivocada';

    await component.entrar();

    expect(navigate).not.toHaveBeenCalled();
    expect(mensaje).toHaveBeenCalled();
    expect(component.mensajeError).toBe('El correo o la contraseña no coinciden.');
  });

  it('apaga el spinner aunque la lectura falle', async () => {
    await preparar({ motivo: 'error' });
    component.correo = 'alguien@correo.cl';
    component.contrasena = 'secreta';

    await component.entrar();

    expect(component.cargando).toBe(false);
  });
});

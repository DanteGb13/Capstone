import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subject } from 'rxjs';

import { WebNav } from './web-nav';
import { AccesoService } from '../acceso/acceso.service';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';

type OpcionesAlerta = {
  header?: string;
  message?: string;
  buttons?: Array<{ text?: string; role?: string; handler?: () => void }>;
};

/** Perfil mínimo del Administrador, para probar el avatar de la barra. */
function perfilAdmin(extra: Partial<PerfilResumen> = {}): PerfilResumen {
  return {
    id: 'u-1',
    nombre: 'Ana',
    apellidopa: 'Pérez',
    apellidoma: 'Soto',
    apellidos: 'Pérez Soto',
    nombreCompleto: 'Ana Pérez Soto',
    telefono: '912345678',
    correo: 'ana@x.cl',
    fotoUrl: null,
    rol: 'Administrador',
    ...extra
  };
}

describe('WebNav', () => {
  let component: WebNav;
  let fixture: ComponentFixture<WebNav>;
  let navigate: ReturnType<typeof vi.fn>;
  let salirSesion: ReturnType<typeof vi.fn>;
  let crearAlerta: ReturnType<typeof vi.fn>;
  /** Emisor de cambios de perfil, para simular un guardado desde Mi Perfil. */
  let cambios: Subject<void>;
  let perfilMock: ReturnType<typeof vi.fn>;

  async function preparar(perfil: PerfilResumen | null = null) {
    salirSesion = vi.fn().mockResolvedValue(undefined);
    crearAlerta = vi.fn().mockResolvedValue({ present: vi.fn() });
    cambios = new Subject<void>();
    perfilMock = vi.fn().mockResolvedValue(perfil);

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AccesoService, useValue: { salir: salirSesion } },
        {
          provide: PerfilCacheService,
          useValue: { perfil: perfilMock, cambios$: cambios.asObservable() },
        },
        { provide: AlertController, useValue: { create: crearAlerta } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WebNav);
    component = fixture.componentInstance;
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('se crea', async () => {
    await preparar();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // ---------------------------------------------------------------
  // Cierre de sesión
  // ---------------------------------------------------------------

  it('vuelve al inicio y limpia la barra cuando el cierre funciona', async () => {
    // Regresión: la salida llamaba al Login de la app, que libera el token de
    // push con una consulta de red sin timeout. Si esa consulta se colgaba,
    // la navegación nunca se disparaba y la pantalla quedaba "muda".
    await preparar();
    component.logueado = true;
    component.esAdmin = true;
    component.perfilAbierto = true;

    await component['salir']();

    expect(salirSesion).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/inicio'], { replaceUrl: true });
    expect(component.logueado).toBe(false);
    expect(component.esAdmin).toBe(false);
    expect(component.perfilAbierto).toBe(false);
  });

  it('si el cierre falla no navega y avisa en pantalla', async () => {
    await preparar();
    component.logueado = true;
    component.esAdmin = true;
    salirSesion.mockRejectedValue(new Error('sin red'));

    await component['salir']();

    // Sin este aviso el fallo se iba al console.warn y por fuera se veía
    // exactamente igual que un cierre que no hace nada.
    expect(crearAlerta).toHaveBeenCalledTimes(1);
    expect(crearAlerta.mock.calls[0][0].header).toBe('No se pudo cerrar sesión');
    expect(navigate).not.toHaveBeenCalled();
    expect(component.logueado).toBe(true);
    expect(component.esAdmin).toBe(true);
  });

  it('si Supabase nunca responde no se queda esperando para siempre', async () => {
    await preparar();
    vi.useFakeTimers();
    salirSesion.mockReturnValue(new Promise(() => { /* sin respuesta */ }));

    const promesa = component['salir']();
    await vi.advanceTimersByTimeAsync(6000);
    await promesa;

    expect(crearAlerta).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('la confirmación pregunta si de verdad quiere salir', async () => {
    await preparar();

    component.cerrarSesion();
    await new Promise((resolver) => setTimeout(resolver, 0));

    expect(crearAlerta).toHaveBeenCalledTimes(1);
    expect(crearAlerta.mock.calls[0][0].message).toBe('¿Seguro que quieres cerrar sesión?');
  });

  it('el botón de confirmación de la alerta dispara la salida', async () => {
    await preparar();
    component.logueado = true;
    component.esAdmin = true;
    crearAlerta.mockImplementation(async (opciones: OpcionesAlerta) => {
      const confirmar = opciones.buttons?.find((b) => b.role === 'destructive');
      confirmar?.handler?.();
      return { present: vi.fn() };
    });

    component.cerrarSesion();
    await new Promise((resolver) => setTimeout(resolver, 0));

    expect(salirSesion).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/inicio'], { replaceUrl: true });
    expect(component.esAdmin).toBe(false);
  });

  // ---------------------------------------------------------------
  // Avatar de la barra
  // ---------------------------------------------------------------

  it('muestra las iniciales cuando la cuenta no tiene foto', async () => {
    await preparar(perfilAdmin());
    fixture.detectChanges();
    await new Promise((resolver) => setTimeout(resolver, 0));
    fixture.detectChanges();

    const avatar = fixture.nativeElement.querySelector('span.web-nav__avatar');
    expect(avatar?.tagName).toBe('SPAN');
    expect(avatar?.textContent?.trim()).toBe('AP');
    expect(fixture.nativeElement.querySelector('img.web-nav__avatar-foto')).toBeNull();
  });

  it('muestra la foto subida desde Mi Perfil cuando existe', async () => {
    await preparar(perfilAdmin({ fotoUrl: 'https://x/foto.jpg' }));
    fixture.detectChanges();
    await new Promise((resolver) => setTimeout(resolver, 0));
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img.web-nav__avatar-foto');
    expect(img?.getAttribute('src')).toBe('https://x/foto.jpg');
    // No se pintan las dos cosas a la vez: si hay foto no quedan iniciales.
    expect(fixture.nativeElement.querySelector('span.web-nav__avatar')).toBeNull();
  });

  it('repinta la barra al instante cuando cambia el perfil, sin navegar', async () => {
    // Regresión: cambiar la foto desde Mi Perfil no se veía hasta salir a
    // otra página, porque cada página monta su propio app-web-nav y éste
    // seguía con el perfil viejo en la mano.
    await preparar(perfilAdmin());
    fixture.detectChanges();
    await new Promise((resolver) => setTimeout(resolver, 0));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img.web-nav__avatar-foto')).toBeNull();

    perfilMock.mockResolvedValue(perfilAdmin({ fotoUrl: 'https://x/nueva.jpg' }));
    cambios.next();
    await new Promise((resolver) => setTimeout(resolver, 0));
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img.web-nav__avatar-foto');
    expect(img?.getAttribute('src')).toBe('https://x/nueva.jpg');
  });
});

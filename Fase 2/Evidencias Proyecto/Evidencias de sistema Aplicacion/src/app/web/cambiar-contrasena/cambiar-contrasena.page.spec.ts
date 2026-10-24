import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CambiarContrasenaPage } from './cambiar-contrasena.page';
import { PerfilCacheService } from '../../services/perfil-cache/perfil-cache.service';
import { SupabaseService } from '../../services/supabase/supabase';

function clienteFalso(opciones: { errorUpdate?: string | null } = {}) {
  const actualizaciones: any[] = [];
  const bitacora: Array<{ accion: string; detalle: any }> = [];

  const cliente = {
    auth: {
      updateUser: async (valores: any) => {
        actualizaciones.push(valores);
        return { error: opciones.errorUpdate ? { message: opciones.errorUpdate } : null };
      },
    },
    rpc: async (nombre: string, detalle: any) => {
      bitacora.push({ accion: nombre, detalle });
      return { data: null, error: null };
    },
  };

  return { cliente, actualizaciones, bitacora };
}

describe('CambiarContrasenaPage', () => {
  let component: CambiarContrasenaPage;
  let fixture: ComponentFixture<CambiarContrasenaPage>;
  let limpiar: ReturnType<typeof vi.fn>;
  let falso: ReturnType<typeof clienteFalso>;

  async function preparar(opciones: { errorUpdate?: string | null } = {}) {
    limpiar = vi.fn();
    falso = clienteFalso(opciones);

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: PerfilCacheService,
          useValue: { perfil: vi.fn(), limpiar, cargarFoto: vi.fn(), cambios$: of() },
        },
        { provide: SupabaseService, useValue: { getClient: () => falso.cliente } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CambiarContrasenaPage);
    component = fixture.componentInstance;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  // ---------------------------------------------------------------
  // Validaciones (los mismos mensajes que la app)
  // ---------------------------------------------------------------

  it('pide la contraseña actual antes que nada', async () => {
    await preparar();

    await component.cambiar();

    expect(component.error).toBe('Ingresa tu contraseña actual.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('pide la nueva contraseña', async () => {
    await preparar();

    component.contrasenaActual = 'Vieja123!';
    await component.cambiar();

    expect(component.error).toBe('Ingresa la nueva contraseña.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('usa las mismas reglas de la app para medir la contraseña nueva', async () => {
    await preparar();

    component.contrasenaActual = 'Vieja123!';
    component.nuevaContrasena = 'Ab1!';
    await component.cambiar();

    expect(component.error).toBe('La contraseña debe tener al menos 8 caracteres.');

    component.nuevaContrasena = 'abcdefgh1';
    await component.cambiar();

    expect(component.error).toContain('mayúscula');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('no deja repetir la misma contraseña', async () => {
    await preparar();

    component.contrasenaActual = 'Clave123!';
    component.nuevaContrasena = 'Clave123!';
    component.confirmarContrasena = 'Clave123!';
    await component.cambiar();

    expect(component.error).toBe('La nueva contraseña debe ser diferente a la actual.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('rechaza la repetición si no coincide con la nueva', async () => {
    await preparar();

    component.contrasenaActual = 'Vieja123!';
    component.nuevaContrasena = 'Nueva123!';
    component.confirmarContrasena = 'Nueva124!';
    await component.cambiar();

    expect(component.error).toBe('Las contraseñas no coinciden.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Guardado
  // ---------------------------------------------------------------

  it('cambia la contraseña, limpia el caché y deja el cambio en la bitácora', async () => {
    await preparar();

    component.contrasenaActual = 'Vieja123!';
    component.nuevaContrasena = 'Nueva123!';
    component.confirmarContrasena = 'Nueva123!';
    await component.cambiar();

    expect(component.error).toBe('');
    expect(component.exito).toContain('actualizada');
    expect(falso.actualizaciones).toEqual([{ password: 'Nueva123!' }]);
    expect(limpiar).toHaveBeenCalled();

    const auditoria = falso.bitacora.find((b) => b.accion === 'registrar_evento_seguridad');
    expect(auditoria).toBeTruthy();
    expect(auditoria!.detalle.p_accion).toBe('cambio_contrasena');

    // Nada de la contraseña anterior queda escrita en la pantalla.
    expect(component.contrasenaActual).toBe('');
    expect(component.nuevaContrasena).toBe('');
  });

  it('muestra el error que devuelve Supabase', async () => {
    await preparar({ errorUpdate: 'New password should be different from the old password.' });

    component.contrasenaActual = 'Vieja123!';
    component.nuevaContrasena = 'Nueva123!';
    component.confirmarContrasena = 'Nueva123!';
    await component.cambiar();

    expect(component.error).toContain('different from the old password');
    expect(component.exito).toBe('');
    expect(limpiar).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // Pintado (la app corre sin zone.js)
  // ---------------------------------------------------------------

  it('muestra el resultado al instante, sin esperar a otro click', async () => {
    await preparar();
    fixture.detectChanges();

    component.contrasenaActual = 'Vieja123!';
    component.nuevaContrasena = 'Nueva123!';
    component.confirmarContrasena = 'Nueva123!';
    await component.cambiar();

    // Sin detectChanges manual después del await.
    expect(fixture.nativeElement.textContent).toContain('Contraseña actualizada');
  });
});

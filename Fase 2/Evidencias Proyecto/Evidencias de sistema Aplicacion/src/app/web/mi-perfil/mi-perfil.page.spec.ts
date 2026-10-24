import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { MiPerfilPage } from './mi-perfil.page';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';
import { SupabaseService } from '../../services/supabase/supabase';

function perfilFalso(extra: Partial<PerfilResumen> = {}): PerfilResumen {
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
    rut: '12.345.678-5',
    fechaNacimiento: '1980-05-01',
    idDireccion: 'd-1',
    direccion: {
      region: 'Metropolitana',
      comuna: 'Santiago',
      calle: 'Ahumada',
      numero: '123'
    },
    idRol: null,
    ...extra
  };
}

/**
 * Cliente Supabase falso: sólo lo que usa esta página (update + storage).
 * Las llamadas quedan registradas en `actualizaciones` para poder assertear
 * qué se mandó a guardar.
 */
function clienteFalso(opciones: {
  errorUpdate?: string | null;
  errorUpload?: string | null;
  archivos?: string[];
} = {}) {
  const actualizaciones: Array<{ tabla: string; valores: any }> = [];
  const subidas: Array<{ ruta: string; contentType?: string }> = [];
  const borrados: string[][] = [];

  const cliente = {
    from: (tabla: string) => ({
      update: (valores: any) => ({
        eq: async () => {
          actualizaciones.push({ tabla, valores });
          return { error: opciones.errorUpdate ? { message: opciones.errorUpdate } : null };
        }
      })
    }),
    storage: {
      from: () => ({
        list: async () => ({ data: (opciones.archivos ?? []).map((name) => ({ name })), error: null }),
        upload: async (ruta: string, _bytes: unknown, opcionesUpload?: any) => {
          subidas.push({ ruta, contentType: opcionesUpload?.contentType });
          return { error: opciones.errorUpload ? { message: opciones.errorUpload } : null };
        },
        remove: async (rutas: string[]) => {
          borrados.push(rutas);
          return { data: null, error: null };
        }
      })
    }
  };

  return { cliente, actualizaciones, subidas, borrados };
}

function archivoFalso(tipo = 'image/jpeg', bytes = 200): File {
  return new File([new Uint8Array(bytes)], 'foto.jpg', { type: tipo });
}

describe('MiPerfilPage', () => {
  let component: MiPerfilPage;
  let fixture: ComponentFixture<MiPerfilPage>;
  let limpiar: ReturnType<typeof vi.fn>;
  let perfil: ReturnType<typeof vi.fn>;
  let cargarFoto: ReturnType<typeof vi.fn>;
  let falso: ReturnType<typeof clienteFalso>;
  let perfilEnCache: PerfilResumen;

  async function preparar(
    opciones: {
      perfil?: PerfilResumen;
      archivos?: string[];
      errorUpdate?: string | null;
      errorUpload?: string | null;
    } = {}
  ) {
    perfilEnCache = opciones.perfil ?? perfilFalso();
    limpiar = vi.fn();
    perfil = vi.fn().mockResolvedValue(perfilEnCache);
    cargarFoto = vi.fn().mockResolvedValue('https://x/nueva.jpg');

    falso = clienteFalso({
      archivos: opciones.archivos,
      errorUpdate: opciones.errorUpdate,
      errorUpload: opciones.errorUpload
    });

    await TestBed.configureTestingModule({
      providers: [
        // El router lo necesita `app-web-nav`, que se monta adentro del template.
        provideRouter([]),
        {
          provide: PerfilCacheService,
          // `cambios$` lo consume el `app-web-nav` que se monta adentro del
          // template. Sin él, ngOnInit de la barra revienta.
          useValue: { perfil, limpiar, cargarFoto, cambios$: of() }
        },
        { provide: SupabaseService, useValue: { getClient: () => falso.cliente } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MiPerfilPage);
    component = fixture.componentInstance;
    await component.ngOnInit();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  // ---------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------

  it('llena el formulario y no toca el objeto que viene del caché', async () => {
    await preparar();

    expect(component.borrador).toEqual({
      nombre: 'Ana',
      apellidopa: 'Pérez',
      apellidoma: 'Soto',
      telefono: '912345678',
      fecha_nacimiento: '1980-05-01',
      region: 'Metropolitana',
      comuna: 'Santiago',
      calle: 'Ahumada',
      numero: '123'
    });
    expect(component.correo).toBe('ana@x.cl');
    expect(component.hayDireccion).toBe(true);

    // Editar el borrador no debe contaminar la caché del navbar.
    component.borrador!.nombre = 'Otro';
    expect(perfilEnCache.nombre).toBe('Ana');
  });

  it('desactiva la dirección cuando no hay fila registrada', async () => {
    await preparar({
      perfil: perfilFalso({ idDireccion: null, direccion: null }),
    });

    expect(component.hayDireccion).toBe(false);
    expect(component.borrador!.region).toBe('');
    expect(component.direccionLegible).toBe('Sin dirección registrada');
  });

  // ---------------------------------------------------------------
  // Validaciones
  // ---------------------------------------------------------------

  it('rechaza un teléfono que no sea chileno y no manda nada', async () => {
    await preparar();
    component.editar();
    component.borrador!.telefono = '12345';

    await component.guardar();

    expect(component.errores['telefono']).toContain('9 dígitos');
    expect(falso.actualizaciones).toHaveLength(0);
    expect(limpiar).not.toHaveBeenCalled();
  });

  it('rechaza nombres y fechas inválidos', async () => {
    await preparar();
    component.borrador!.nombre = 'A';
    component.borrador!.apellidopa = '123';
    component.borrador!.apellidoma = 'Soto4';
    component.borrador!.fecha_nacimiento = '2900-01-01';

    await component.guardar();

    expect(component.errores['nombre']).toBeTruthy();
    expect(component.errores['apellidopa']).toBeTruthy();
    expect(component.errores['apellidoma']).toBeTruthy();
    expect(component.errores['fecha_nacimiento']).toBeTruthy();
    expect(component.mensajeError).toBe('Revisa los campos marcados en rojo.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('dice que el problema del nombre son los números, no el largo', async () => {
    await preparar();
    component.borrador!.nombre = 'Siempre1';

    await component.guardar();

    expect(component.errores['nombre']).toBe('El nombre no debe contener números.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('no admite espacios en los apellidos, pero sí dos nombres en el nombre', async () => {
    await preparar();
    component.borrador!.nombre = 'Ana María';
    component.borrador!.apellidopa = 'Cer ca';

    await component.guardar();

    expect(component.errores['nombre']).toBeUndefined();
    expect(component.errores['apellidopa']).toBe('El apellido paterno no debe contener espacios.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('permite el apellido materno vacío pero no con números', async () => {
    await preparar();
    component.borrador!.apellidoma = '';
    await component.guardar();
    expect(component.errores['apellidoma']).toBeUndefined();

    component.borrador!.apellidoma = 'Soto 2';
    await component.guardar();
    expect(component.errores['apellidoma']).toBeTruthy();
  });

  it('corta los campos que se pasan de largo, que los validadores no miden', async () => {
    await preparar();
    component.borrador!.nombre = 'a'.repeat(51);
    component.borrador!.calle = 'b'.repeat(81);

    await component.guardar();

    // El formato es correcto (sólo letras), pero el tope lo rompe igual.
    expect(component.errores['nombre']).toBe('Máximo 50 caracteres.');
    expect(component.errores['calle']).toBe('Máximo 80 caracteres.');
    expect(falso.actualizaciones).toHaveLength(0);
  });

  it('exige la dirección sólo cuando hay dirección registrada', async () => {
    await preparar({
      perfil: perfilFalso({ idDireccion: null, direccion: null }),
    });
    component.borrador!.region = '';
    component.borrador!.comuna = '';

    await component.guardar();

    // Sin fila que actualizar esos campos no se validan: no se puede quedar
    // la persona sin poder guardar su nombre por una dirección que no existe.
    expect(component.errores['region']).toBeUndefined();
    expect(component.errores['comuna']).toBeUndefined();

    component.borrador!.nombre = 'Ana';
    await component.guardar();
    expect(component.mensaje).toBe('Datos actualizados.');
  });

  // ---------------------------------------------------------------
  // Guardado
  // ---------------------------------------------------------------

  it('guarda la dirección y el usuario y invalida el caché', async () => {
    await preparar();
    component.borrador!.nombre = 'María';
    component.borrador!.comuna = 'Providencia';

    await component.guardar();

    expect(component.mensaje).toBe('Datos actualizados.');
    expect(falso.actualizaciones).toEqual([
      {
        tabla: 'direccion',
        valores: {
          region: 'Metropolitana',
          comuna: 'Providencia',
          calle: 'Ahumada',
          numero: '123'
        }
      },
      {
        tabla: 'usuario',
        valores: {
          nombre: 'María',
          apellidopa: 'Pérez',
          apellidoma: 'Soto',
          telefono: '912345678',
          fecha_nacimiento: '1980-05-01'
        }
      }
    ]);

    // Sin esto el navbar seguiría mostrando el nombre anterior 5 minutos.
    expect(limpiar).toHaveBeenCalledTimes(1);
    expect(component.errores).toEqual({});
    // Guardado, se vuelve a la lectura.
    expect(component.modoEdicion).toBe(false);
  });

  it('no toca la tabla de dirección cuando no hay dirección registrada', async () => {
    await preparar({
      perfil: perfilFalso({ idDireccion: null, direccion: null }),
    });

    await component.guardar();

    expect(falso.actualizaciones.map((a) => a.tabla)).toEqual(['usuario']);
  });

  it('muestra el error de la base y no limpia el caché', async () => {
    await preparar({ errorUpdate: 'permission denied' });

    await component.guardar();

    expect(component.mensajeError).toBe('permission denied');
    expect(component.mensaje).toBe('');
    expect(limpiar).not.toHaveBeenCalled();
  });

  it('arranca en modo lectura, se edita con el botón y vuelve al cerrar', async () => {
    await preparar();

    expect(component.modoEdicion).toBe(false);

    component.editar();
    expect(component.modoEdicion).toBe(true);
    // Editar no cambia nada todavía: sólo habilita los campos.
    expect(falso.actualizaciones).toHaveLength(0);

    component.borrador!.nombre = 'María';
    component.cancelar();

    expect(component.modoEdicion).toBe(false);
    expect(component.borrador!.nombre).toBe('Ana');
    expect(component.errores).toEqual({});
  });

  it('no muestra ningún control editable hasta que se pide editar', async () => {
    await preparar();
    fixture.detectChanges();

    // Al abrir la página no hay input de archivo ni botón de guardar: sólo
    // se mira. Sin esto el card salía ya en modo edición.
    expect(fixture.nativeElement.querySelector('#p-foto')).toBeNull();
    expect(fixture.nativeElement.querySelector('#p-nombre')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Editar datos');
    expect(fixture.nativeElement.textContent).not.toContain('Guardar cambios');

    component.editar();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#p-foto')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#p-nombre')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Guardar cambios');
    expect(fixture.nativeElement.textContent).not.toContain('Editar datos');
  });

  it('pone los subtítulos de foto y de datos sólo en modo lectura', async () => {
    await preparar();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Foto de perfil');
    expect(fixture.nativeElement.textContent).toContain('Datos personales');

    component.editar();
    fixture.detectChanges();

    // Al editar ya están la etiqueta "Cambiar foto" y los nombres de campo:
    // repetir el subtítulo sólo ensuciaba la columna.
    expect(fixture.nativeElement.textContent).not.toContain('Foto de perfil');
    expect(fixture.nativeElement.textContent).not.toContain('Datos personales');
  });

  it('cancelar devuelve los valores de arranque', async () => {
    await preparar();
    component.borrador!.nombre = 'María';
    component.errores = { nombre: 'x' };

    component.cancelar();

    expect(component.borrador!.nombre).toBe('Ana');
    expect(component.errores).toEqual({});
  });

  // ---------------------------------------------------------------
  // Foto
  // ---------------------------------------------------------------

  it('rechaza un archivo que no sea imagen', async () => {
    await preparar();
    const input = { target: { files: [archivoFalso('application/pdf')], value: 'x' } } as any;

    await component.alElegirFoto(input);

    expect(component.errorFoto).toBe('La imagen debe ser JPG o PNG.');
    expect(component.vistaPrevia).toBeNull();
    expect(falso.subidas).toHaveLength(0);
  });

  it('rechaza una imagen de más de 5 MB', async () => {
    await preparar();
    const input = { target: { files: [archivoFalso('image/jpeg', 6 * 1024 * 1024)], value: 'x' } } as any;

    await component.alElegirFoto(input);

    expect(component.errorFoto).toContain('5 MB');
    expect(falso.subidas).toHaveLength(0);
  });

  it('elegir la foto no sube nada: se sube recién con "Guardar cambios"', async () => {
    await preparar({ archivos: ['perfil_vieja.jpg'] });
    component.editar();

    const input = { target: { files: [archivoFalso()], value: 'x' } } as any;
    await component.alElegirFoto(input);

    expect(component.vistaPrevia).toContain('data:image/jpeg');
    expect(falso.subidas).toHaveLength(0);
    expect(falso.borrados).toHaveLength(0);
  });

  it('sube la foto junto con los datos al guardar y actualiza el caché del navbar', async () => {
    await preparar({ archivos: ['perfil_vieja.jpg'] });
    component.editar();

    const input = { target: { files: [archivoFalso()], value: 'x' } } as any;
    await component.alElegirFoto(input);

    await component.guardar();

    // Los datos...
    expect(falso.actualizaciones.map((a) => a.tabla)).toEqual(['direccion', 'usuario']);

    // ...y la foto, en el mismo guardado: quita la anterior y sube la nueva.
    expect(falso.borrados).toEqual([['u-1/perfil_vieja.jpg']]);
    expect(falso.subidas).toHaveLength(1);
    expect(falso.subidas[0].ruta).toMatch(/^u-1\/perfil_\d+\.jpg$/);
    expect(falso.subidas[0].contentType).toBe('image/jpeg');

    // El navbar pinta el perfil desde el caché: sin invalidarlo seguiría
    // con la foto vieja hasta que venciera el TTL.
    expect(limpiar).toHaveBeenCalled();
    expect(cargarFoto).toHaveBeenCalled();
    expect(component.fotoUrl).toBe('https://x/nueva.jpg');

    expect(component.vistaPrevia).toBeNull();
    expect(component.modoEdicion).toBe(false);
    expect(component.mensaje).toBe('Datos y foto actualizados.');
  });

  it('no sube nada si todavía no se eligió imagen', async () => {
    await preparar();

    await component.guardar();

    expect(falso.subidas).toHaveLength(0);
    expect(component.mensaje).toBe('Datos actualizados.');
  });

  it('si la foto no se puede subir, los datos quedan guardados y se avisa', async () => {
    await preparar({ errorUpload: 'bucket not found' });
    component.editar();

    const input = { target: { files: [archivoFalso()], value: 'x' } } as any;
    await component.alElegirFoto(input);

    await component.guardar();

    expect(falso.actualizaciones).toHaveLength(2);
    expect(component.mensajeError).toBe('');
    expect(component.errorFoto).toContain('Los datos se guardaron');
    expect(component.errorFoto).toContain('bucket not found');

    // Se queda en edición para poder reintentar, con la foto todavía elegida.
    expect(component.modoEdicion).toBe(true);
    expect(component.vistaPrevia).toBeTruthy();
  });

  it('muestra la vista previa al instante, sin esperar a otro click', async () => {
    await preparar();
    component.editar();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#p-foto')).toBeTruthy();

    const input = { target: { files: [archivoFalso()], value: 'x' } } as any;
    await component.alElegirFoto(input);

    // Ni detectChanges ni whenStable: el DOM tiene que estar ya repintado.
    const img = fixture.nativeElement.querySelector('.perfil-foto__img');
    expect(img).toBeTruthy();
    expect(img.src).toContain('data:image/jpeg');
    expect(fixture.nativeElement.textContent).toContain('se sube al guardar los cambios');

    // La foto ya no tiene botones propios: se guarda y se descarta con los
    // mismos que el resto del formulario.
    expect(fixture.nativeElement.textContent).not.toContain('Guardar foto');
    expect(fixture.nativeElement.textContent).not.toContain('Eliminar foto');
    expect(fixture.nativeElement.textContent).not.toContain('Descartar');
  });

  it('cancelar descarta la foto elegida sin subirla', async () => {
    await preparar();
    component.editar();

    const input = { target: { files: [archivoFalso()], value: 'x' } } as any;
    await component.alElegirFoto(input);
    expect(component.vistaPrevia).toBeTruthy();

    component.cancelar();

    expect(component.vistaPrevia).toBeNull();
    expect(component.errorFoto).toBe('');
    expect(component.modoEdicion).toBe(false);
    expect(falso.subidas).toHaveLength(0);
  });
});

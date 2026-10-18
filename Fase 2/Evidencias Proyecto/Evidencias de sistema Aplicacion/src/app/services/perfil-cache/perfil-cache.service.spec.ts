import { TestBed } from '@angular/core/testing';
import { PerfilCacheService } from './perfil-cache.service';
import { SupabaseService } from '../supabase/supabase';

const CLAVE_CACHE = 'sc_perfil_cache';
const CLAVE_FOTO = 'sc_foto_cache';

/** Fila de `usuario` tal como la devuelve la consulta con la relacion anidada. */
const FILA_USUARIO = {
  id: 'usuario-1',
  nombre: 'Maria',
  appellidopa: 'Perez',
  appellidoma: 'Soto',
  telefono: '+56912345678',
  correo: 'maria@correo.cl',
  rut: '123456785',
  fecha_nacimiento: '1950-06-15',
  id_direccion: 'dir-1',
  id_rol: 1,
  direccion: {
    region: 'Región Metropolitana',
    comuna: 'Ñuñoa',
    calle: 'Francisco Mattos',
    numero: '651'
  },
  rol: { nombre: 'Usuario' }
};

/**
 * Cliente de Supabase simulado, con contador de viajes para poder comprobar
 * que la cache evita los viajes repetidos.
 */
function crearSupabaseMock(
  opciones: {
    idSesion?: string | null;
    perfil?: any;
    errorPerfil?: any;
    archivos?: any[];
    urlFirmada?: string | null;
  } = {}
) {
  const idSesion = opciones.idSesion === undefined ? 'usuario-1' : opciones.idSesion;

  const estado = { viajesPerfil: 0, viajesFoto: 0 };

  const cliente = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: idSesion ? { user: { id: idSesion } } : null },
        error: null
      })
    },
    from: () => {
      estado.viajesPerfil++;
      const cadena: any = {
        select: () => cadena,
        eq: () => cadena,
        maybeSingle: vi.fn().mockResolvedValue({
          // Se devuelve una copia pasada por JSON, igual que en la vida real:
          // la respuesta de Supabase llega serializada, no es el mismo objeto
          // que se escribio en la prueba.
          data: opciones.perfil ? JSON.parse(JSON.stringify(opciones.perfil)) : null,
          error: opciones.errorPerfil ?? null
        })
      };
      return cadena;
    },
    storage: {
      from: () => {
        estado.viajesFoto++;
        return {
          list: vi.fn().mockResolvedValue({ data: opciones.archivos ?? [], error: null }),
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: opciones.urlFirmada ?? null },
            error: null
          })
        };
      }
    }
  };

  return { useValue: { getClient: () => cliente }, estado };
}

describe('PerfilCacheService', () => {
  function crear(mocksupabase: ReturnType<typeof crearSupabaseMock>): PerfilCacheService {
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: mocksupabase.useValue }]
    });
    return TestBed.inject(PerfilCacheService);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('idUsuario', () => {
    it('devuelve el id de la sesion local', async () => {
      const s = crear(crearSupabaseMock({ idSesion: 'usuario-1' }));
      expect(await s.idUsuario()).toBe('usuario-1');
    });

    it('devuelve null cuando no hay sesion abierta', async () => {
      const s = crear(crearSupabaseMock({ idSesion: null }));
      expect(await s.idUsuario()).toBeNull();
    });
  });

  describe('perfil', () => {
    it('trae el nombre tal como esta guardado, sin espacios sobrantes', async () => {
      const s = crear(crearSupabaseMock({ perfil: FILA_USUARIO }));

      const perfil = await s.perfil();
      expect(perfil!.nombre).toBe('Maria');
    });

    it('trae el telefono y el correo del mismo golpe', async () => {
      // La cabecera los necesita apenas se abre la app: si tardaran un viaje
      // aparte, aparecerian con atraso o vacios.
      const s = crear(crearSupabaseMock({ perfil: FILA_USUARIO }));

      const perfil = await s.perfil();
      expect(perfil!.telefono).toBe('+56912345678');
      expect(perfil!.correo).toBe('maria@correo.cl');
    });

    it('trae la direccion y el id con que actualizarla despues', async () => {
      // El formulario de Perfil necesita el id para guardar, no solo el texto.
      const s = crear(crearSupabaseMock({ perfil: FILA_USUARIO }));

      const perfil = await s.perfil();
      expect(perfil!.direccion?.calle).toBe('Francisco Mattos');
      expect(perfil!.idDireccion).toBe('dir-1');
    });

    it('lee el rol para saber si es adulto mayor o cuidador', async () => {
      const s = crear(crearSupabaseMock({ perfil: FILA_USUARIO }));
      expect((await s.perfil())!.rol).toBe('Usuario');
    });

    it('acepta que la relacion rol venga como arreglo', async () => {
      // Supabase devuelve las relaciones 1 a 1 como arreglo a veces; si solo se
      // leyera el caso de objeto, el rol saldria vacio y el panel equivocado.
      const s = crear(
        crearSupabaseMock({ perfil: { ...FILA_USUARIO, rol: [{ nombre: 'Familiar' }] } })
      );
      expect((await s.perfil())!.rol).toBe('Familiar');
    });

    it('acepta que la relacion direccion venga como arreglo', async () => {
      const s = crear(
        crearSupabaseMock({ perfil: { ...FILA_USUARIO, direccion: [FILA_USUARIO.direccion] } })
      );
      expect((await s.perfil())!.direccion?.comuna).toBe('Ñuñoa');
    });

    it('deja la direccion en null cuando el usuario todavia no tiene', async () => {
      const s = crear(crearSupabaseMock({ perfil: { ...FILA_USUARIO, direccion: null } }));
      expect((await s.perfil())!.direccion).toBeNull();
    });

    it('devuelve null si no hay sesion, sin preguntar a la base', async () => {
      const mock = crearSupabaseMock({ idSesion: null });
      const s = crear(mock);

      expect(await s.perfil()).toBeNull();
      expect(mock.estado.viajesPerfil).toBe(0);
    });

    it('devuelve null si la fila no existe', async () => {
      const s = crear(crearSupabaseMock({ perfil: null }));
      expect(await s.perfil()).toBeNull();
    });
  });

  describe('cache entre pantallas', () => {
    it('no vuelve a consultar en la segunda pantalla', async () => {
      // Los dos paneles piden el perfil al abrir: sin cache serian dos viajes
      // identicos y la segunda apertura esperaria de mas.
      const mock = crearSupabaseMock({ perfil: FILA_USUARIO });
      const s = crear(mock);

      await s.perfil();
      await s.perfil();

      expect(mock.estado.viajesPerfil).toBe(1);
    });

    it('comparte una sola consulta si dos pantallas la piden a la vez', async () => {
      const mock = crearSupabaseMock({ perfil: FILA_USUARIO });
      const s = crear(mock);

      await Promise.all([s.perfil(), s.perfil(), s.perfil()]);

      expect(mock.estado.viajesPerfil).toBe(1);
    });

    it('vuelve a consultar cuando se le pide forzar', async () => {
      // Es lo que hace la app al volver del primer plano, para no mostrar el
      // nombre de la cuenta anterior si se cambio.
      const mock = crearSupabaseMock({ perfil: FILA_USUARIO });
      const s = crear(mock);

      await s.perfil();
      await s.perfil(true);

      expect(mock.estado.viajesPerfil).toBe(2);
    });

    it('vuelve a consultar despues de limpiar la cache', async () => {
      const mock = crearSupabaseMock({ perfil: FILA_USUARIO });
      const s = crear(mock);

      await s.perfil();
      s.limpiar();
      await s.perfil();

      expect(mock.estado.viajesPerfil).toBe(2);
    });

    it('no sirve a una cuenta el perfil cacheado de otra', async () => {
      // El telefono es compartido: sin esta comprobacion, el siguiente usuario
      // veria el nombre y la foto del anterior.
      const mock = crearSupabaseMock({ perfil: FILA_USUARIO });
      const s = crear(mock);
      await s.perfil();

      TestBed.resetTestingModule();
      const otro = crear(crearSupabaseMock({ idSesion: 'usuario-2', perfil: null }));

      expect(await otro.perfil()).toBeNull();
    });
  });

  describe('limpiar', () => {
    it('borra el perfil y la foto del almacenamiento', async () => {
      const s = crear(crearSupabaseMock({ perfil: FILA_USUARIO }));
      await s.perfil();
      s.limpiar();

      expect(localStorage.getItem(CLAVE_CACHE)).toBeNull();
      expect(localStorage.getItem(CLAVE_FOTO)).toBeNull();
    });
  });

  describe('foto', () => {
    it('devuelve la url firmada cuando hay foto', async () => {
      const s = crear(
        crearSupabaseMock({
          perfil: FILA_USUARIO,
          archivos: [{ name: 'perfil.png' }],
          urlFirmada: 'https://fotos.example/perfil.png?firma=1'
        })
      );

      expect(await s.cargarFoto('usuario-1')).toBe('https://fotos.example/perfil.png?firma=1');
    });

    it('devuelve null cuando la persona no tiene foto', async () => {
      // Es lo normal: no es un error y no debe dejarlo como exception.
      const s = crear(crearSupabaseMock({ perfil: FILA_USUARIO, archivos: [] }));
      expect(await s.cargarFoto('usuario-1')).toBeNull();
    });

    it('devuelve null si no se puede firmar la url', async () => {
      const s = crear(
        crearSupabaseMock({
          perfil: FILA_USUARIO,
          archivos: [{ name: 'perfil.png' }],
          urlFirmada: null
        })
      );
      expect(await s.cargarFoto('usuario-1')).toBeNull();
    });

    it('no vuelve a storage en la segunda vez', async () => {
      const mock = crearSupabaseMock({
        perfil: FILA_USUARIO,
        archivos: [{ name: 'perfil.png' }],
        urlFirmada: 'https://fotos.example/perfil.png'
      });
      const s = crear(mock);

      await s.cargarFoto('usuario-1');
      await s.cargarFoto('usuario-1');

      // Un viaje al storage son 2 llamadas a storage.from(): una para listar y
      // otra para firmar. Que se queden en 2 y no en 4 es lo que prueba que la
      // segunda vez se respondio desde la cache.
      expect(mock.estado.viajesFoto).toBe(2);
    });

    it('comparte una sola ida cuando dos pantallas la piden juntas', async () => {
      const mock = crearSupabaseMock({
        perfil: FILA_USUARIO,
        archivos: [{ name: 'perfil.png' }],
        urlFirmada: 'https://fotos.example/perfil.png'
      });
      const s = crear(mock);

      await Promise.all([s.cargarFoto('usuario-1'), s.cargarFoto('usuario-1')]);

      expect(mock.estado.viajesFoto).toBe(2);
    });

    it('no le muestra a una cuenta la foto cacheada de otra', async () => {
      const mock = crearSupabaseMock({
        perfil: FILA_USUARIO,
        archivos: [{ name: 'perfil.png' }],
        urlFirmada: 'https://fotos.example/perfil.png'
      });
      const s = crear(mock);
      await s.cargarFoto('usuario-1');

      TestBed.resetTestingModule();
      const otro = crear(crearSupabaseMock({ archivos: [] }));

      expect(await otro.cargarFoto('usuario-2')).toBeNull();
    });

    it('limpiarFoto borra solo la foto y deja el perfil guardado', async () => {
      // La persona acaba de cambiar su foto: hay que olvidar esa, pero tirar
      // tambien el perfil seria pedirle de nuevo el nombre a la base.
      const s = crear(
        crearSupabaseMock({
          perfil: FILA_USUARIO,
          archivos: [{ name: 'perfil.png' }],
          urlFirmada: 'https://fotos.example/perfil.png'
        })
      );

      await s.perfil();
      await s.cargarFoto('usuario-1');
      s.limpiarFoto();

      expect(localStorage.getItem(CLAVE_FOTO)).toBeNull();
      expect(localStorage.getItem(CLAVE_CACHE)).not.toBeNull();
    });

    it('vuelve a storage despues de limpiarFoto', async () => {
      const mock = crearSupabaseMock({
        perfil: FILA_USUARIO,
        archivos: [{ name: 'perfil.png' }],
        urlFirmada: 'https://fotos.example/nueva.png'
      });
      const s = crear(mock);

      await s.cargarFoto('usuario-1');
      s.limpiarFoto();
      await s.cargarFoto('usuario-1');

      // Dos viajes completos: 2 llamadas a storage.from() cada uno.
      expect(mock.estado.viajesFoto).toBe(4);
    });
  });
});
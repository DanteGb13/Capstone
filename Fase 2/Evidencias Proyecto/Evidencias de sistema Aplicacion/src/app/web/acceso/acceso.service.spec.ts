import { TestBed } from '@angular/core/testing';
import { AccesoService } from './acceso.service';
import { SupabaseClientProvider } from '../../core/supabase-client';

/**
 * Cliente simulado.
 *
 * Se sustituye el provider en `TestBed` y no el módulo: el sistema de pruebas
 * de Angular no permite `vi.mock` con imports relativos.
 *
 * Sólo se implementa la parte que usa el servicio:
 * `auth.getSession()`, `auth.signInWithPassword()`, `auth.signOut()` y
 * `from().select().eq().maybeSingle()`.
 */
function crearClienteMock() {
  const consulta = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  consulta.select.mockReturnValue(consulta);
  consulta.eq.mockReturnValue(consulta);

  return {
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn().mockReturnValue(consulta),
    consulta,
  };
}

/** Usuario con sesión, rut y dirección: perfil completo. */
const USUARIO_COMPLETO = { rut: '123456785', id_direccion: 'dir1' };

describe('AccesoService', () => {
  let cliente: ReturnType<typeof crearClienteMock>;

  /** Pone la sesión y el resultado de la consulta de perfil. */
  function sesionActiva(usuario: unknown, errorPerfil: unknown = null) {
    cliente.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });
    cliente.consulta.maybeSingle.mockResolvedValue({ data: usuario, error: errorPerfil });
  }

  const servicio = () => TestBed.inject(AccesoService);

  beforeEach(() => {
    cliente = crearClienteMock();

    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseClientProvider, useValue: { get: () => cliente } }],
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  // ---------------------------------------------------------------
  // destinoPara
  // ---------------------------------------------------------------

  describe('destinoPara', () => {
    it('reparte cada rol a su panel', () => {
      expect(servicio().destinoPara('Administrador')).toBe('/panel-control');
      expect(servicio().destinoPara('Familiar')).toBe('/cuidador');
      expect(servicio().destinoPara('Usuario')).toBe('/adulto-mayor');
    });

    it('devuelve null para un rol que no se reconoce', () => {
      // null y no un destino por defecto: si se cayera a /adulto-mayor, un
      // rol nuevo mandaría a la gente a la pantalla equivocada sin aviso.
      expect(servicio().destinoPara('RolNuevo')).toBeNull();
      expect(servicio().destinoPara('')).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // leerEstado
  // ---------------------------------------------------------------

  describe('leerEstado', () => {
    it('sin sesión guardada', async () => {
      cliente.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

      expect(await servicio().leerEstado()).toEqual({ motivo: 'sin-sesion' });
    });

    it('con sesión y perfil completo', async () => {
      sesionActiva({ ...USUARIO_COMPLETO, rol: { nombre: 'Administrador' } });

      expect(await servicio().leerEstado()).toEqual({ motivo: 'ok', rol: 'Administrador' });
    });

    it('acepta el rol devuelto como arreglo', async () => {
      // Supabase responde en arreglo en ciertos casos del `select`: manejar
      // sólo el objeto se caería justo para usuarios con datos completos.
      sesionActiva({ ...USUARIO_COMPLETO, rol: [{ nombre: 'Familiar' }] });

      expect(await servicio().leerEstado()).toEqual({ motivo: 'ok', rol: 'Familiar' });
    });

    it('sin rut o sin dirección es perfil incompleto', async () => {
      sesionActiva({ rut: null, id_direccion: 'dir1', rol: { nombre: 'Usuario' } });

      expect(await servicio().leerEstado()).toEqual({ motivo: 'perfil-incompleto' });
    });

    it('rol que no resuelve a nombre', async () => {
      sesionActiva({ ...USUARIO_COMPLETO, rol: null });

      expect(await servicio().leerEstado()).toEqual({ motivo: 'sin-rol' });
      // Se deja traza: sin esto el problema se vería sólo como "no sabemos
      // tu rol" en la pantalla, sin causa posible.
      expect(console.error).toHaveBeenCalled();
    });

    it('un error de consulta vuelve como error, no como perfil incompleto', async () => {
      // El caso que se perdió: una política de RLS mal hecha devuelve un
      // error de consulta, y el código viejo lo traducía a "rol null",
      // mostrando un mensaje que no apuntaba a nada.
      sesionActiva(null, { message: 'infinite recursion detected in policy for relation "usuario"' });

      expect(await servicio().leerEstado()).toEqual({ motivo: 'error' });
      expect(console.error).toHaveBeenCalled();
    });

    it('nunca lanza aunque el cliente reviente', async () => {
      cliente.auth.getSession.mockRejectedValue(new Error('exploto'));

      expect(await servicio().leerEstado()).toEqual({ motivo: 'error' });
    });

    it('una sesión rota no se toma como perfil incompleto', async () => {
      cliente.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'red caida' },
      });

      expect(await servicio().leerEstado()).toEqual({ motivo: 'error' });
    });
  });

  // ---------------------------------------------------------------
  // iniciarSesion / salir
  // ---------------------------------------------------------------

  it('iniciarSesion propaga el error original para poder traducirlo', async () => {
    cliente.auth.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    });

    await expect(servicio().iniciarSesion('a@b.cl', 'x')).rejects.toThrow(
      'Invalid login credentials'
    );
  });

  it('salir cierra sólo en este dispositivo', async () => {
    // scope 'local' y no el 'global' que viene por defecto: el global revoca
    // el refresh token de TODOS los dispositivos, así que salir de la web
    // expulsaría a la misma persona del celular.
    cliente.auth.signOut.mockResolvedValue({ error: null });

    await servicio().salir();

    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  // ---------------------------------------------------------------
  // mensajeDeError
  // ---------------------------------------------------------------

  describe('mensajeDeError', () => {
    it('no filtra el texto crudo del servidor', () => {
      const bruto = servicio().mensajeDeError(
        new Error('User not found: alguien@correo.cl no existe en auth.users')
      );

      expect(bruto).toBe('El correo o la contraseña no coinciden.');
      expect(bruto).not.toContain('alguien@correo.cl');
      expect(bruto).not.toContain('auth.users');
    });

    it('da el mismo texto no importa si falló el correo o la clave', () => {
      // Anunciar que el correo sí está registrado le regala a un desconocido
      // la mitad de las credenciales y convierte el formulario en un
      // probador de correos.
      const porClave = servicio().mensajeDeError(new Error('Invalid login credentials'));
      const porCorreo = servicio().mensajeDeError(new Error('User not found'));

      expect(porClave).toBe(porCorreo);
      expect(porClave).toBe('El correo o la contraseña no coinciden.');
    });

    it('separa el correo sin confirmar de una contraseña mala', () => {
      expect(servicio().mensajeDeError(new Error('Email not confirmed'))).toContain('confirmado');
    });

    it('advierte del límite de intentos', () => {
      expect(servicio().mensajeDeError(new Error('Rate limit exceeded'))).toContain('Demasiados');
    });

    it('cubre la falta de red', () => {
      expect(servicio().mensajeDeError(new TypeError('Failed to fetch'))).toContain('conectar');
    });

    it('para todo lo demás hay un texto genérico y nada que adivinar', () => {
      expect(servicio().mensajeDeError(new Error('algo raro'))).toBe(
        'No se pudo iniciar sesión. Inténtalo de nuevo en unos segundos.'
      );
    });

    it('aguanta un error que no es Error', () => {
      expect(servicio().mensajeDeError('rompió')).toContain('No se pudo iniciar sesión');
    });
  });
});

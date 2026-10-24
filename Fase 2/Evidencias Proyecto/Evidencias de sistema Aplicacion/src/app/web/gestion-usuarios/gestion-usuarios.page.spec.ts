import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertController } from '@ionic/angular';

import {
  EventoAuditoria,
  GestionUsuariosPage,
  RolOpcion,
  UsuarioGestion,
} from './gestion-usuarios.page';
import { SupabaseService } from '../../services/supabase/supabase';

/**
 * Cadena de Supabase falsa.
 *
 * `select/order/or/limit` encadenan sin hacer nada, y el objeto resuelve con
 * lo que se le haya configurado para su clave (`from:usuario`,
 * `rpc:admin_cambiar_rol`, …). Sin esto el componente tendría que conocer el
 * cliente real para poder testearse.
 */
function clienteFalso(respuestas: Record<string, unknown>) {
  // El objeto entero es `any` a propósito: afuera se le llama select/order/or/
  // limit en cadena y cada llamada devuelve el mismo objeto, algo que sólo se
  // puede expresar con un `any` honesto.
  const cadena = (clave: string): any => ({
    select: () => cadena(clave),
    order: () => cadena(clave),
    or: () => cadena(clave),
    limit: () => cadena(clave),
    then: (ok: any, mal: any) =>
      Promise.resolve(respuestas[clave]).then(ok, mal),
  });

  return {
    from: (tabla: string) => cadena(`from:${tabla}`),
    rpc: (nombre: string) => cadena(`rpc:${nombre}`),
  };
}

const ROLES: RolOpcion[] = [
  { id: 'r-admin', nombre: 'Administrador' },
  { id: 'r-user', nombre: 'Usuario' },
];

/**
 * Tres casos a propósito:
 *  - u1: nombre completo de tres partes, rol devuelto como objeto.
 *  - u2: sin apellido materno, sin último visto, DESACTIVADA, y el rol en el
 *        arreglo que Supabase devuelve a veces para relaciones 1 a 1.
 *  - u3: sin nombre, sin rol: tiene que mostrar los textos de reserva.
 */
const USUARIOS = [
  {
    id: 'u1',
    nombre: 'Ana',
    apellidopa: 'Pérez',
    apellidoma: 'Soto',
    correo: 'ana@x.cl',
    estado: true,
    ultimo_visto: '2026-10-01T12:00:00.000Z',
    id_rol: 'r-admin',
    rol: { nombre: 'Administrador' },
  },
  {
    id: 'u2',
    nombre: 'Luis',
    apellidopa: 'García',
    apellidoma: null,
    correo: 'luis@x.cl',
    estado: false,
    ultimo_visto: null,
    id_rol: 'r-user',
    rol: [{ nombre: 'Usuario' }],
  },
  {
    id: 'u3',
    nombre: null,
    apellidopa: null,
    apellidoma: null,
    correo: 'sin@x.cl',
    estado: true,
    ultimo_visto: null,
    id_rol: null,
    rol: null,
  },
];

function respuestasBase(extra: Record<string, unknown> = {}) {
  return {
    'from:usuario': { data: USUARIOS, error: null },
    'rpc:admin_listar_roles': { data: ROLES, error: null },
    'from:seguridad_auditoria': { data: [], error: null },
    // Las dos funciones de cambio. Éxitas por defecto: cada test que quiera
    // un rechazo las sobreescribe.
    'rpc:admin_cambiar_rol': { data: null, error: null },
    'rpc:admin_cambiar_estado': { data: null, error: null },
    ...extra,
  };
}

function idUsuario(page: GestionUsuariosPage, id: string): UsuarioGestion {
  const usuario = page.usuarios.find((u) => u.id === id);
  if (!usuario) throw new Error(`no existe el usuario de prueba ${id}`);
  return usuario;
}

/**
 * Cuántas veces se pidió una función concreta.
 *
 * No sirve `expect(rpc).not.toHaveBeenCalled()` porque `ngOnInit` siempre
 * llama a `admin_listar_roles`: hay que mirar el nombre de la función y no
 * el contador global.
 */
function llamadasA(rpc: ReturnType<typeof vi.fn>, nombre: string) {
  return rpc.mock.calls.filter((llamada: unknown[]) => llamada[0] === nombre);
}

describe('GestionUsuariosPage', () => {
  let component: GestionUsuariosPage;
  let fixture: ComponentFixture<GestionUsuariosPage>;
  let rpc: ReturnType<typeof vi.fn>;
  let crearAlerta: ReturnType<typeof vi.fn>;

  /** Rol que devuelve la alerta al cerrarse. Lo cambia cada test. */
  let rolDeAlerta: string;

  async function preparar(extra: Record<string, unknown> = {}, cerrarCon = 'destructive') {
    rolDeAlerta = cerrarCon;

    const respuestas = respuestasBase(extra);
    const falso = clienteFalso(respuestas);

    // `rpc` se registra para poder assertear la llamada, pero devuelve la
    // misma cadena falsa que `from`: si no, los RPC (traer roles, cambiar
    // rol) resolverían undefined y el componente creería que fallaron.
    rpc = vi.fn((nombre: string) => falso.rpc(nombre));

    crearAlerta = vi.fn().mockImplementation(async () => ({
      present: vi.fn(),
      onDidDismiss: vi.fn().mockResolvedValue({ role: rolDeAlerta }),
    }));

    await TestBed.configureTestingModule({
      providers: [
        // El router no lo necesita esta página: lo necesita `app-web-nav`,
        // que se monta adentro del template y usa RouterLink.
        provideRouter([]),
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => ({ from: falso.from, rpc }),
          },
        },
        { provide: AlertController, useValue: { create: crearAlerta } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GestionUsuariosPage);
    component = fixture.componentInstance;
    // ngOnInit a mano y sin detectChanges: así el test controla cuándo se
    // dispara la carga y no la dispara dos veces el fixture.
    await component.ngOnInit();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  // ---------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------

  it('arma el nombre completo y normaliza el rol que llega como objeto o arreglo', async () => {
    await preparar();

    expect(component.cargando).toBe(false);
    expect(component.error).toBe('');
    expect(component.usuarios).toHaveLength(3);

    expect(idUsuario(component, 'u1').nombre).toBe('Ana Pérez Soto');
    expect(idUsuario(component, 'u1').rol).toBe('Administrador');
    expect(idUsuario(component, 'u1').activo).toBe(true);

    // El rol 1 a 1 llega como objeto o como arreglo según la versión del
    // cliente: si no se normaliza, sale "[object Object]" en la tabla.
    expect(idUsuario(component, 'u2').rol).toBe('Usuario');
    expect(idUsuario(component, 'u2').activo).toBe(false);
    expect(idUsuario(component, 'u2').ultimoVisto).toBeNull();

    expect(idUsuario(component, 'u3').nombre).toBe('Sin nombre');
    expect(idUsuario(component, 'u3').rol).toBe('—');
  });

  it('si los roles no se pueden leer deja la lista vacía y el listado sigue sirviendo', async () => {
    // Es el caso real de una instalación sin la migración aplicada.
    await preparar({
      'rpc:admin_listar_roles': { data: null, error: { message: 'function not found' } },
    });

    expect(component.roles).toEqual([]);
    expect(component.usuarios).toHaveLength(3);
  });

  it('si la lectura de usuarios falla muestra el mensaje en vez de romper la pantalla', async () => {
    await preparar({
      'from:usuario': { data: null, error: { message: 'permission denied' } },
    });

    expect(component.error).toBe('permission denied');
    expect(component.usuarios).toEqual([]);
  });

  // ---------------------------------------------------------------
  // Filtros y paginación
  // ---------------------------------------------------------------

  it('filtra por nombre y por correo', async () => {
    await preparar();

    component.busqueda = 'ana';
    expect(component.filtrados.map((u) => u.id)).toEqual(['u1']);

    component.busqueda = 'luis@';
    expect(component.filtrados.map((u) => u.id)).toEqual(['u2']);

    component.busqueda = '';
    expect(component.filtrados).toHaveLength(3);
  });

  it('filtra por rol y por estado', async () => {
    await preparar();

    // u3 no tiene rol (queda '—'), así que no entra en el filtro.
    component.filtroRol = 'Usuario';
    expect(component.filtrados.map((u) => u.id)).toEqual(['u2']);

    component.filtroRol = '';
    component.filtroEstado = 'inactivo';
    expect(component.filtrados.map((u) => u.id)).toEqual(['u2']);

    component.filtroEstado = 'activo';
    expect(component.filtrados.map((u) => u.id)).toEqual(['u1', 'u3']);
  });

  it('vuelve a la página 1 al filtrar y acota la navegación', async () => {
    await preparar();
    expect(component.paginas).toBe(1);
    expect(component.visibles).toHaveLength(3);

    component.pagina = 1;
    component.irPagina(99);
    expect(component.pagina).toBe(1);

    component.irPagina(0);
    expect(component.pagina).toBe(1);
  });

  it('pagina el listado de 10 en 10', async () => {
    const muchas = Array.from({ length: 23 }, (_, i) => ({
      id: `p${i}`,
      nombre: `Persona ${i}`,
      apellidopa: null,
      apellidoma: null,
      correo: `p${i}@x.cl`,
      estado: true,
      ultimo_visto: null,
      id_rol: 'r-user',
      rol: { nombre: 'Usuario' },
    }));
    await preparar({ 'from:usuario': { data: muchas, error: null } });

    expect(component.paginas).toBe(3);
    expect(component.visibles).toHaveLength(10);

    component.irPagina(3);
    expect(component.visibles).toHaveLength(3);
    expect(component.visibles[0].id).toBe('p20');
  });

  it('vuelve al listado desde los otros slides y limpia el aviso', async () => {
    await preparar();
    component.seleccionar(idUsuario(component, 'u1'), 'acciones');
    component.mensaje = 'Rol actualizado';

    component.irAlListado();

    expect(component.vista).toBe('listado');
    expect(component.mensaje).toBe('');
  });

  // ---------------------------------------------------------------
  // Cambiar rol
  // ---------------------------------------------------------------

  it('no manda el cambio de rol si el rol elegido ya es el que tiene', async () => {
    await preparar();
    component.seleccionar(idUsuario(component, 'u1'), 'acciones');

    await component.cambiarRol('r-admin');

    expect(llamadasA(rpc, 'admin_cambiar_rol')).toHaveLength(0);
    expect(crearAlerta).not.toHaveBeenCalled();
  });

  it('no manda nada si la persona cancela la confirmación', async () => {
    await preparar({}, 'cancel');
    component.seleccionar(idUsuario(component, 'u1'), 'acciones');

    await component.cambiarRol('r-user');

    expect(crearAlerta).toHaveBeenCalledTimes(1);
    expect(llamadasA(rpc, 'admin_cambiar_rol')).toHaveLength(0);
  });

  it('cambia el rol cuando se confirma y actualiza la lista en pantalla', async () => {
    // Regresión: el botón de confirmar lleva role 'destructive' (la
    // convención de toda la app) y `confirmar()` comparaba con 'confirm',
    // así que siempre devolvía false y el RPC jamás se mandaba.
    await preparar();
    component.seleccionar(idUsuario(component, 'u1'), 'acciones');

    await component.cambiarRol('r-user');

    expect(rpc).toHaveBeenCalledWith('admin_cambiar_rol', {
      p_usuario: 'u1',
      p_rol_id: 'r-user',
    });
    expect(idUsuario(component, 'u1').rol).toBe('Usuario');
    expect(component.seleccion?.rol).toBe('Usuario');
    expect(component.mensaje).toContain('Ana Pérez Soto');
    expect(component.mensaje).toContain('Usuario');
  });

  it('muestra el error de la base cuando el cambio de rol se rechaza', async () => {
    await preparar({
      'rpc:admin_cambiar_rol': {
        data: null,
        error: { message: 'no se puede quitar el rol al último administrador activo' },
      },
    });
    component.seleccionar(idUsuario(component, 'u1'), 'acciones');

    await component.cambiarRol('r-user');

    expect(component.mensaje).toBe(
      'no se puede quitar el rol al último administrador activo'
    );
    // La lista no se toca si la base no aplicó el cambio.
    expect(idUsuario(component, 'u1').rol).toBe('Administrador');
  });

  // ---------------------------------------------------------------
  // Cambiar estado
  // ---------------------------------------------------------------

  it('activa y desactiva cuentas por la función validada', async () => {
    await preparar();
    component.seleccionar(idUsuario(component, 'u2'), 'acciones');

    await component.cambiarEstado(true);

    expect(rpc).toHaveBeenCalledWith('admin_cambiar_estado', {
      p_usuario: 'u2',
      p_activo: true,
    });
    expect(idUsuario(component, 'u2').activo).toBe(true);
    expect(component.mensaje).toContain('activada');

    await component.cambiarEstado(false);
    expect(idUsuario(component, 'u2').activo).toBe(false);
  });

  it('no manda el estado si ya está en ese estado', async () => {
    await preparar();
    component.seleccionar(idUsuario(component, 'u2'), 'acciones');

    await component.cambiarEstado(false);

    expect(llamadasA(rpc, 'admin_cambiar_estado')).toHaveLength(0);
    expect(crearAlerta).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // Actividad
  // ---------------------------------------------------------------

  it('pide la actividad por actor o por objetivo y la rotula con el nombre', async () => {
    await preparar({
      'from:seguridad_auditoria': {
        data: [
          {
            id: 1,
            accion: 'cambio_rol',
            detalle: { rol_anterior: 'Usuario', rol_nuevo: 'Administrador' },
            fecha: '2026-10-20T10:00:00.000Z',
            usuario_id: 'u1',
          },
        ],
        error: null,
      },
    });

    component.seleccionar(idUsuario(component, 'u2'), 'actividad');
    await new Promise((resolver) => setTimeout(resolver, 0));

    expect(component.cargandoActividad).toBe(false);
    expect(component.actividad).toHaveLength(1);

    const evento: EventoAuditoria = component.actividad[0];
    expect(evento.accion).toBe('cambio_rol');
    // El actor viene por id y se rotula con el nombre ya cargado.
    expect(evento.actor).toBe('Ana Pérez Soto');
    expect(component.resumenDetalle(evento.detalle)).toContain('rol_nuevo');
  });

  // ---------------------------------------------------------------
  // Textos
  // ---------------------------------------------------------------

  it('traduce las acciones de la bitácora a texto de persona', async () => {
    await preparar();

    expect(component.etiquetaAccion('sesion_iniciada')).toBe('Inició sesión');
    expect(component.etiquetaAccion('cambio_estado')).toBe('Cambio de estado');
    expect(component.etiquetaAccion('exportacion_reporte')).toBe('Exportó un reporte');
    expect(component.etiquetaAccion('accion_rara')).toBe('accion_rara');
  });

  it('describe cuándo se vio por última vez', async () => {
    await preparar();

    expect(component.haceCuanto(null)).toBe('Nunca');
    expect(component.haceCuanto(new Date(Date.now() - 30 * 1000).toISOString()))
      .toBe('Hace un momento');
    expect(component.haceCuanto(new Date(Date.now() - 5 * 60 * 1000).toISOString()))
      .toBe('Hace 5 min');
    expect(component.haceCuanto(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()))
      .toBe('Hace 2 h');
    expect(component.haceCuanto(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()))
      .toBe('Ayer');
    expect(component.haceCuanto(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()))
      .toBe('Hace 3 días');
  });

  it('resumenDetalle devuelve vacío cuando no hay detalle', async () => {
    await preparar();

    expect(component.resumenDetalle(null)).toBe('');
    expect(component.resumenDetalle({ accion: 'alta' })).toBe('accion: alta');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { PermisosPage } from './permisos.page';
import { PermisoInfo, PermisosService } from '../../../services/permisos/permisos.service';
import { PushNotificationService } from '../../../services/Backend/push-notification/push-notification';

/** Permiso completo para las pruebas: sólo se diferencian estado y `puedePedir`. */
function permisoBase(extra: Partial<PermisoInfo> = {}): PermisoInfo {
  return {
    id: 'notificaciones',
    nombre: 'Notificaciones',
    descripcion: 'Avisos y alertas de seguridad',
    paraQue: '',
    detalle: '',
    icono: 'notifications-outline',
    momento: 'inicial',
    critico: true,
    estado: 'denegado',
    puedePedir: false,
    ...extra
  };
}

/**
 * Servicio de permisos simulado.
 *
 * La pantalla sólo usa estos métodos; el estado real no interesa acá, se
 * decide qué devuelve `pedir` en cada prueba.
 */
function crearServicioPermisos() {
  return {
    cambios: new BehaviorSubject<PermisoInfo[]>([]),
    getPermisosPorDefecto: vi.fn().mockReturnValue([]),
    verificarTodos: vi.fn().mockResolvedValue([]),
    pedir: vi.fn().mockResolvedValue(null),
    motivoFallo: vi.fn().mockResolvedValue({ texto: '', ajustes: 'ninguno' }),
    abrirAjustesPara: vi.fn().mockResolvedValue(undefined),
    abrirAjustesParaApagar: vi.fn().mockResolvedValue(true)
  };
}

describe('PermisosPage', () => {
  let component: PermisosPage;
  let fixture: ComponentFixture<PermisosPage>;
  let servicio: ReturnType<typeof crearServicioPermisos>;

  beforeEach(async () => {
    servicio = crearServicioPermisos();

    await TestBed.configureTestingModule({
      imports: [PermisosPage],
      providers: [
        { provide: PermisosService, useValue: servicio },
        { provide: PushNotificationService, useValue: { diagnostico: vi.fn() } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PermisosPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('debe crearse', () => {
    expect(component).toBeTruthy();
  });

  // ===================================================================
  // Reactivar un permiso apagado en los ajustes del sistema (BUG)
  // ===================================================================

  it('vuelve a pedir el permiso aunque el estado diga que no se puede', async () => {
    // BUG: el usuario apaga el permiso en Ajustes del sistema, Android
    // reporta "no se puede pedir" y la pantalla se rendía SIN mostrar el
    // diálogo. El diálogo sí se vuelve a mostrar, así que hay que pedirlo.
    const permiso = permisoBase({ estado: 'denegado', puedePedir: false });
    servicio.pedir.mockResolvedValue(permisoBase({ estado: 'concedido' }));

    await component.activar(permiso);

    expect(servicio.pedir).toHaveBeenCalledWith('notificaciones');
    expect(component.avisoTexto).toBe('Notificaciones activado.');
    expect(servicio.abrirAjustesPara).not.toHaveBeenCalled();
  });

  it('también intenta pedirlo si el estado quedó en "bloqueado"', async () => {
    // El "bloqueado" nativo es una suposición (rationale=false + ya
    // preguntado): después de apagarlo en Ajustes se cumple aunque el
    // sistema muestre el diálogo igual. Hay que intentarlo igual.
    const permiso = permisoBase({ estado: 'bloqueado', puedePedir: false });
    servicio.pedir.mockResolvedValue(permisoBase({ estado: 'concedido' }));

    await component.activar(permiso);

    expect(servicio.pedir).toHaveBeenCalledWith('notificaciones');
    expect(component.avisoTexto).toBe('Notificaciones activado.');
    expect(servicio.abrirAjustesPara).not.toHaveBeenCalled();
  });

  it('si el sistema confirma que no muestra la ventana, avisa y abre los ajustes', async () => {
    const permiso = permisoBase({ estado: 'bloqueado', puedePedir: false });
    servicio.pedir.mockResolvedValue(permisoBase({ estado: 'bloqueado' }));
    servicio.motivoFallo.mockResolvedValue({
      texto: 'Android ya no muestra la ventana de este permiso: hay que activarlo en los ajustes del sistema.',
      ajustes: 'app'
    });

    await component.activar(permiso);

    expect(servicio.pedir).toHaveBeenCalled();
    expect(component.avisoTexto).toContain('Android ya no muestra la ventana');
    expect(servicio.abrirAjustesPara).toHaveBeenCalledWith('notificaciones');
  });

  it('si el usuario niega el diálogo, informa el motivo sin abrir ajustes', async () => {
    const permiso = permisoBase({ estado: 'denegado', puedePedir: true });
    servicio.pedir.mockResolvedValue(permisoBase({ estado: 'denegado' }));
    servicio.motivoFallo.mockResolvedValue({
      texto: 'El permiso de notificaciones está denegado.',
      ajustes: 'notificaciones'
    });

    await component.activar(permiso);

    expect(component.avisoTexto).toBe('El permiso de notificaciones está denegado.');
    expect(servicio.abrirAjustesPara).not.toHaveBeenCalled();
  });

  it('no pide un permiso que no aplica en el dispositivo', async () => {
    const permiso = permisoBase({
      id: 'ubicacion-fondo',
      nombre: 'Ubicación en segundo plano',
      estado: 'no-aplica',
      puedePedir: false
    });

    await component.activar(permiso);

    expect(servicio.pedir).not.toHaveBeenCalled();
    expect(component.avisoTexto).toContain('no aplica');
  });

  it('no abre una segunda pantalla de ajustes si la solicitud ya abrió una', async () => {
    // `solicitar('ubicacion-fondo')` ya lleva al sistema a su pantalla de
    // ubicación en segundo plano; abrir la ficha de la app encima dejaba a la
    // persona en un lugar que no le servía.
    const permiso = permisoBase({
      id: 'ubicacion-fondo',
      nombre: 'Ubicación en segundo plano',
      estado: 'bloqueado',
      puedePedir: false
    });
    servicio.pedir.mockResolvedValue(
      permisoBase({ id: 'ubicacion-fondo', estado: 'bloqueado' })
    );
    servicio.motivoFallo.mockResolvedValue({ texto: '', ajustes: 'ninguno' });

    await component.activar(permiso);

    expect(servicio.pedir).toHaveBeenCalled();
    expect(servicio.abrirAjustesPara).not.toHaveBeenCalled();
    expect(component.avisoTexto).toContain('actívalo en los ajustes');
  });
});

import { TestBed } from '@angular/core/testing';
import { SaludSyncService } from './salud-sync';
import { Salud } from './salud';
import { PerfilCacheService } from '../../perfil-cache/perfil-cache.service';

// No se mockean `App` ni `UbicacionForeground` porque `sincronizar()` no los
// usa: solo los toca `iniciar()`, que queda fuera de estas pruebas.
describe('SaludSyncService', () => {
  let servicio: SaludSyncService;

  let salud: { reportarMiSalud: ReturnType<typeof vi.fn> };
  let perfilCache: { idUsuario: ReturnType<typeof vi.fn>; perfil: ReturnType<typeof vi.fn> };

  function crear(opciones: { rol?: string | null; id?: string | null } = {}) {
    salud = {
      reportarMiSalud: vi.fn().mockResolvedValue({
        subido: true,
        problema: null,
        resumen: { pasos: 3200 }
      })
    };

    perfilCache = {
      idUsuario: vi.fn().mockResolvedValue(
        opciones.id === undefined ? 'usuario-1' : opciones.id
      ),
      perfil: vi.fn().mockResolvedValue(
        opciones.rol === undefined ? { rol: 'Usuario' } : { rol: opciones.rol }
      )
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: Salud, useValue: salud },
        { provide: PerfilCacheService, useValue: perfilCache }
      ]
    });

    servicio = TestBed.inject(SaludSyncService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('subida normal', () => {
    it('publica los datos y marca la hora del envio', async () => {
      crear();

      expect(await servicio.sincronizar()).toBe(true);
      expect(salud.reportarMiSalud).toHaveBeenCalledWith('usuario-1');
      expect(servicio.ultimaSyncMs).not.toBeNull();
    });

    it('guarda lo leido aunque no se haya podido subir', async () => {
      // Sirve para poder distinguir "el reloj no manda nada" de "la app no lo
      // pudo guardar": las dos se ven igual en el panel del cuidador.
      crear();
      salud.reportarMiSalud.mockResolvedValue({
        subido: false,
        problema: 'sin internet',
        resumen: { pasos: 1500 }
      });

      await servicio.sincronizar();
      expect(servicio.ultimoResumen).toEqual({ pasos: 1500 });
    });

    it('deja el problema a la vista cuando la subida falla', async () => {
      crear();
      salud.reportarMiSalud.mockResolvedValue({
        subido: false,
        problema: 'sin internet',
        resumen: null
      });

      expect(await servicio.sincronizar()).toBe(false);
      expect(servicio.ultimoProblema).toBe('sin internet');
    });

    it('limpia el problema anterior cuando una subida si funciona', async () => {
      crear();
      salud.reportarMiSalud.mockResolvedValue({ subido: false, problema: 'sin internet', resumen: null });
      await servicio.sincronizar();
      expect(servicio.ultimoProblema).toBe('sin internet');

      salud.reportarMiSalud.mockResolvedValue({ subido: true, problema: null, resumen: {} });
      await servicio.sincronizar(true);

      expect(servicio.ultimoProblema).toBeNull();
    });
  });

  describe('filtro por rol', () => {
    it('no sube si el rol no es el del adulto mayor', async () => {
      crear({ rol: 'Familiar' });

      expect(await servicio.sincronizar()).toBe(false);
      expect(salud.reportarMiSalud).not.toHaveBeenCalled();
    });

    it('sube igual cuando no se sabe el rol todavia', async () => {
      // El perfil puede no haber cargado en un arranque en frio. Antes eso
      // hacia que la sincronizacion se saliera sin dejar rastro y el cuidador
      // veia "nunca ha enviado datos" sin forma de saber por que.
      crear({ rol: null });

      expect(await servicio.sincronizar()).toBe(true);
      expect(salud.reportarMiSalud).toHaveBeenCalled();
    });
  });

  describe('sin sesion', () => {
    it('no intenta subir y explica cual es el problema', async () => {
      crear({ id: null });

      expect(await servicio.sincronizar()).toBe(false);
      expect(salud.reportarMiSalud).not.toHaveBeenCalled();
      expect(servicio.ultimoProblema).toBe('No se pudo identificar al usuario.');
    });
  });

  describe('no repite el envio cada rato', () => {
    it('no vuelve a subir si la ultima vez fue hace segundos', async () => {
      // Sin esto, cada aviso del servicio native gastaria datos: los signos
      // vitales no cambian de un segundo a otro.
      crear();

      await servicio.sincronizar();
      expect(await servicio.sincronizar()).toBe(false);

      expect(salud.reportarMiSalud).toHaveBeenCalledTimes(1);
    });

    it('si vuelve a subir cuando se le pide a la fuerza', async () => {
      crear();

      await servicio.sincronizar();
      await servicio.sincronizar(true);

      expect(salud.reportarMiSalud).toHaveBeenCalledTimes(2);
    });
  });

  describe('nunca rompe la pantalla que la llamo', () => {
    it('devuelve false si Health Connect falla', async () => {
      crear();
      salud.reportarMiSalud.mockRejectedValue(new Error('Health Connect no responde'));

      expect(await servicio.sincronizar()).toBe(false);
      expect(servicio.ultimoProblema).toBe('No se pudieron enviar los datos de salud.');
    });

    it('vuelve a poder sincronizar despues de un fallo', async () => {
      // Si el candado se quedara levantado, la app se quedaria sin subir
      // datos para siempre despues de un solo error.
      crear();
      salud.reportarMiSalud.mockRejectedValue(new Error('fallo'));

      await servicio.sincronizar();
      salud.reportarMiSalud.mockResolvedValue({ subido: true, problema: null, resumen: {} });

      expect(await servicio.sincronizar(true)).toBe(true);
    });
  });

  describe('detener', () => {
    it('olvida la hora del envio, para que al volver no espere el intervalo', async () => {
      crear();
      await servicio.sincronizar();
      await servicio.detener();

      expect(servicio.ultimaSyncMs).toBeNull();
      expect(servicio.ultimoResumen).toBeNull();
    });
  });
});
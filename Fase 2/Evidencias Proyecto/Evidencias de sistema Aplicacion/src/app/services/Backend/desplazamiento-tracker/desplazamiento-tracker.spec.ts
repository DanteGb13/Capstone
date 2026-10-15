import { TestBed } from '@angular/core/testing';

import { DesplazamientoTracker } from './desplazamiento-tracker';
import { HistorialDesplazamiento } from '../historial-desplazamiento/historial-desplazamiento';


describe('DesplazamientoTracker', () => {

  const T0 = Date.parse('2026-09-28T10:00:00.000Z');

  const LAT = -33.4;

  const LNG = -70.6;

  let tracker: DesplazamientoTracker;

  let historial: {
    iniciarDesplazamiento: ReturnType<typeof vi.fn>;
    agregarPunto: ReturnType<typeof vi.fn>;
    finalizarDesplazamiento: ReturnType<typeof vi.fn>;
    obtenerDesplazamientoActivo: ReturnType<typeof vi.fn>;
  };


  beforeEach(() => {
    historial = {
      iniciarDesplazamiento: vi.fn().mockResolvedValue({
        id: 'd1',
        id_usuario: 'u1',
        fecha_inicio: new Date(T0).toISOString(),
        distancia_metros: 0,
        duracion_segundos: 0,
        activo: true
      }),
      agregarPunto: vi.fn().mockResolvedValue(true),
      finalizarDesplazamiento: vi.fn().mockResolvedValue(null),
      obtenerDesplazamientoActivo: vi.fn().mockResolvedValue(null)
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: HistorialDesplazamiento, useValue: historial }
      ]
    });

    tracker = TestBed.inject(DesplazamientoTracker);
  });


  it('no abre un desplazamiento con un movimiento menor al umbral', async () => {
    await tracker.procesar('u1', LAT, LNG, 10, T0);
    await tracker.procesar('u1', LAT, LNG + 0.0001, 10, T0 + 60000);

    expect(historial.iniciarDesplazamiento).not.toHaveBeenCalled();
  });


  it('abre el desplazamiento al superar 25 m de distancia', async () => {
    await tracker.procesar('u1', LAT, LNG, 10, T0);
    await tracker.procesar('u1', LAT, LNG + 0.001, 10, T0 + 60000);

    expect(historial.iniciarDesplazamiento).toHaveBeenCalledTimes(1);
    expect(historial.iniciarDesplazamiento).toHaveBeenCalledWith(
      'u1',
      { latitud: LAT, longitud: LNG + 0.001 }
    );
  });


  it('agrega un punto cuando avanza más de 10 m y sigue el orden', async () => {
    await tracker.procesar('u1', LAT, LNG, 10, T0);
    await tracker.procesar('u1', LAT, LNG + 0.001, 10, T0 + 60000);
    await tracker.procesar('u1', LAT, LNG + 0.002, 10, T0 + 120000);

    expect(historial.agregarPunto).toHaveBeenCalledTimes(1);
    expect(historial.agregarPunto).toHaveBeenCalledWith(
      'd1',
      { latitud: LAT, longitud: LNG + 0.002 },
      10,
      2
    );
  });


  it('cierra el desplazamiento después de 5 minutos sin moverse', async () => {
    await tracker.procesar('u1', LAT, LNG, 10, T0);
    await tracker.procesar('u1', LAT, LNG + 0.001, 10, T0 + 60000);

    for (let i = 2; i <= 5; i++) {
      await tracker.procesar('u1', LAT, LNG + 0.001, 10, T0 + 60000 * i);
    }

    expect(historial.finalizarDesplazamiento).not.toHaveBeenCalled();

    await tracker.procesar('u1', LAT, LNG + 0.001, 10, T0 + 360000);

    expect(historial.finalizarDesplazamiento).toHaveBeenCalledWith('d1');
  });


  it('cierra el desplazamiento activo si la sesión anterior hace más de 6 horas', async () => {
    historial.obtenerDesplazamientoActivo.mockResolvedValue({
      id: 'd9',
      id_usuario: 'u1',
      fecha_inicio: new Date(Date.now() - 7 * 3600000).toISOString(),
      distancia_metros: 0,
      duracion_segundos: 0,
      activo: true,
      puntos: []
    });

    await tracker.revisarArranque('u1');

    expect(historial.finalizarDesplazamiento).toHaveBeenCalledWith('d9');
  });


  it('reanuda el desplazamiento activo que quedó recién abierto', async () => {
    const reciente = new Date(Date.now() - 60000).toISOString();

    historial.obtenerDesplazamientoActivo.mockResolvedValue({
      id: 'd9',
      id_usuario: 'u1',
      fecha_inicio: reciente,
      distancia_metros: 0,
      duracion_segundos: 0,
      activo: true,
      puntos: [
        {
          latitud: LAT,
          longitud: LNG,
          fecha: reciente,
          precisionMetros: 10,
          orden: 1
        }
      ]
    });

    await tracker.revisarArranque('u1');
    await tracker.procesar('u1', LAT, LNG, 10);

    expect(historial.finalizarDesplazamiento).not.toHaveBeenCalled();
  });

});

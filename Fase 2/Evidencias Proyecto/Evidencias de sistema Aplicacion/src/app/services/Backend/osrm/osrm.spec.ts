import { TestBed } from '@angular/core/testing';
import { Osrm, PuntoRuta } from './osrm';

/** Respuesta que devuelve el servidor público de OSRM. */
function respuestaOk() {
  return {
    ok: true,
    json: async () => ({
      code: 'Ok',
      routes: [
        {
          distance: 1234.5678,
          duration: 987.6543,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-70.6693, -33.4489],
              [-70.66, -33.45]
            ]
          }
        }
      ]
    })
  };
}

describe('Osrm', () => {
  let service: Osrm;

  const origen: PuntoRuta = { latitud: -33.4489, longitud: -70.6693 };
  const destino: PuntoRuta = { latitud: -33.0472, longitud: -71.6127 };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Osrm);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(respuesta: any) {
    const fetchMock = vi.fn().mockResolvedValue(respuesta);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('puntos insuficientes', () => {
    it('no consulta nada con un solo punto', async () => {
      const fetchMock = stubFetch(respuestaOk());
      expect(await service.obtenerRuta([origen])).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no consulta nada sin puntos', async () => {
      const fetchMock = stubFetch(respuestaOk());
      expect(await service.obtenerRuta([])).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tampoco reconstruye una ruta de un solo punto', async () => {
      const fetchMock = stubFetch(respuestaOk());
      expect(await service.reconstruirRuta([origen])).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('consulta al servidor', () => {
    it('pide la ruta a pie y no en auto', async () => {
      const fetchMock = stubFetch(respuestaOk());
      await service.obtenerRuta([origen, destino]);

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/route/v1/foot/');
    });

    it('manda las coordenadas en orden longitud,latitud', async () => {
      // OSRM usa lng,lat al reves que el resto de la app: mandarlas al reves
      // lleva la ruta a un punto del otro lado del planeta sin avisar.
      const fetchMock = stubFetch(respuestaOk());
      await service.obtenerRuta([origen, destino]);

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('-70.6693,-33.4489;-71.6127,-33.0472');
    });

    it('redondea distancia y duracion a metros y segundos enteros', async () => {
      stubFetch(respuestaOk());
      const ruta = await service.obtenerRuta([origen, destino]);

      expect(ruta!.distanciaMetros).toBe(1235);
      expect(ruta!.duracionSegundos).toBe(988);
    });

    it('da vuelta la geometria para que quede como latitud y longitud', async () => {
      stubFetch(respuestaOk());
      const ruta = await service.obtenerRuta([origen, destino]);

      expect(ruta!.coordenadas).toEqual([
        { latitud: -33.4489, longitud: -70.6693 },
        { latitud: -33.45, longitud: -70.66 }
      ]);
    });

    it('devuelve tambien la geometria cruda, que es la que se pinta', async () => {
      stubFetch(respuestaOk());
      const ruta = await service.obtenerRuta([origen, destino]);

      expect(ruta!.geometria.type).toBe('LineString');
    });
  });

  describe('respuestas que no sirven', () => {
    it('devuelve null si el servidor responde con error', async () => {
      stubFetch({ ok: false, status: 503 });
      expect(await service.obtenerRuta([origen, destino])).toBeNull();
    });

    it('devuelve null si OSRM no encontro ninguna ruta', async () => {
      stubFetch({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) });
      expect(await service.obtenerRuta([origen, destino])).toBeNull();
    });

    it('devuelve null si la respuesta viene sin rutas', async () => {
      stubFetch({ ok: true, json: async () => ({ code: 'Ok' }) });
      expect(await service.obtenerRuta([origen, destino])).toBeNull();
    });

    it('devuelve null si se cae la conexion, sin dejar la pantalla colgada', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
      expect(await service.obtenerRuta([origen, destino])).toBeNull();
    });

    it('devuelve null si la respuesta no es json valido', async () => {
      stubFetch({
        ok: true,
        json: async () => {
          throw new Error('no es json');
        }
      });
      expect(await service.obtenerRuta([origen, destino])).toBeNull();
    });
  });

  describe('obtenerDistanciaYTiempo', () => {
    it('separa distancia y duracion para quien solo necesita los numeros', async () => {
      stubFetch(respuestaOk());
      const r = await service.obtenerDistanciaYTiempo(origen, destino);

      expect(r).toEqual({ metros: 1235, segundos: 988 });
    });

    it('devuelve null cuando la ruta no se pudo calcular', async () => {
      stubFetch({ ok: false, status: 500 });
      expect(await service.obtenerDistanciaYTiempo(origen, destino)).toBeNull();
    });
  });

  describe('reconstruirRuta', () => {
    it('reconstruye una ruta con varios puntos intermedios', async () => {
      const fetchMock = stubFetch(respuestaOk());
      const medio: PuntoRuta = { latitud: -33.2, longitud: -71.0 };

      const ruta = await service.reconstruirRuta([origen, medio, destino]);

      expect(ruta).not.toBeNull();
      expect(fetchMock.mock.calls[0][0] as string).toContain(
        '-70.6693,-33.4489;-71,-33.2;-71.6127,-33.0472'
      );
    });

    it('pide los pasos apagados, que no se usan al dibujar', async () => {
      const fetchMock = stubFetch(respuestaOk());
      await service.reconstruirRuta([origen, destino]);

      expect(fetchMock.mock.calls[0][0] as string).toContain('steps=false');
    });

    it('redondea igual que la ruta normal', async () => {
      stubFetch(respuestaOk());
      const ruta = await service.reconstruirRuta([origen, destino]);

      expect(ruta!.distanciaMetros).toBe(1235);
      expect(ruta!.duracionSegundos).toBe(988);
    });
  });
});
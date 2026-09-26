import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ZonaSeguraService, ZonaSegura } from './zona-segura';

function zona(id: string, lat: number, lng: number, radio: number): ZonaSegura {
  return {
    id,
    id_usuario: 'usuario-1',
    nombre: 'Zona ' + id,
    latitud_centro: lat,
    longitud_centro: lng,
    radio_metros: radio,
    direccion_texto: '',
    region: '',
    comuna: '',
    calle: '',
    numero: '',
    activa: true,
    es_casa: false
  };
}

describe('ZonaSeguraService', () => {
  let service: ZonaSeguraService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])]
    }).compileComponents();

    service = TestBed.inject(ZonaSeguraService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('calcula la distancia entre dos puntos (haversine)', () => {
    // 0.001° de longitud sobre el ecuador ≈ 111 metros
    const distancia = service.distanciaMetros(0, 0, 0, 0.001);
    expect(distancia).toBeGreaterThan(105);
    expect(distancia).toBeLessThan(118);
  });

  it('detecta que está dentro de una zona segura', () => {
    const estado = service.evaluar([zona('z1', -33.4489, -70.6693, 500)], -33.4495, -70.669);

    expect(estado.dentro).toBe(true);
    expect(estado.zonaDentro?.id).toBe('z1');
  });

  it('detecta que está fuera de todas las zonas', () => {
    const estado = service.evaluar([zona('z1', -33.4489, -70.6693, 500)], -33.4489, -70.655);

    expect(estado.dentro).toBe(false);
    expect(estado.zonaDentro).toBeNull();
    expect(estado.zonaCercana?.id).toBe('z1');
    expect(estado.distancia).toBeGreaterThan(500);
  });

  it('usa el radio de cada zona al evaluar', () => {
    // ~460 m al este del centro, con un radio de sólo 300 m
    const estado = service.evaluar([zona('z1', -33.4489, -70.6693, 300)], -33.4489, -70.6643);

    expect(estado.dentro).toBe(false);
    expect(estado.distancia).toBeGreaterThan(400);
    expect(estado.distancia).toBeLessThan(520);
  });

  it('no busca sugerencias con menos de 3 caracteres', async () => {
    const sugerencias = await service.buscarSugerencias('av');
    expect(sugerencias.length).toBe(0);
  });

  it('no evalúa si todavía no hay zonas', () => {
    const estado = service.evaluar([], -33.4489, -70.6693);

    expect(estado.tieneZonas).toBe(false);
    expect(estado.dentro).toBe(false);
  });
});

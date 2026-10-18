import { TestBed } from '@angular/core/testing';
import { FontSizeService } from './font-size';

describe('FontSizeService', () => {
  let service: FontSizeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--font-scale');
    document.body.style.removeProperty('zoom');

    TestBed.configureTestingModule({});
    service = TestBed.inject(FontSizeService);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--font-scale');
    document.body.style.removeProperty('zoom');
  });

  describe('sin nada guardado', () => {
    it('empieza en tamano normal', () => {
      expect(service.obtener()).toBe('normal');
    });

    it('escala 1, o sea que no agranda ni achica', () => {
      expect(service.obtenerScale()).toBe(1.0);
    });

    it('pone la escala en el documento al construirse, para que no haya destello', () => {
      // El constructor ya aplica el valor: si esperara al primer guardar, la
      // app abriria con el tamano anterior durante un instante.
      expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1');
    });
  });

  describe('guardar y recuperar', () => {
    it('recupera el tamano guardado', () => {
      service.guardar('grande');
      expect(service.obtener()).toBe('grande');
    });

    it('aplica la escala del tamano guardado', () => {
      service.guardar('extra-grande');
      expect(service.obtenerScale()).toBe(1.3);
    });

    it('escala el documento al guardar, sin pedir nada mas', () => {
      service.guardar('pequeno');
      expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('0.85');
      expect(document.body.style.zoom).toBe('0.85');
    });

    it('sobrevive a que se vuelva a crear el servicio', () => {
      // Es lo que pasa al reiniciar la app o al recargar: el tamano elegido
      // tiene que seguir puesto sin que la persona lo elija de nuevo.
      service.guardar('grande');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const otro = TestBed.inject(FontSizeService);

      expect(otro.obtener()).toBe('grande');
      expect(otro.obtenerScale()).toBe(1.15);
    });
  });

  describe('etiqueta', () => {
    it('devuelve el texto que se muestra en Ajustes, no el id interno', () => {
      service.guardar('extra-grande');
      expect(service.obtenerEtiqueta()).toBe('Extra grande');
    });

    it('devuelve vacio si lo guardado no es un tamano que exista', () => {
      // Un id desconocido no debe romperse: se muestra sin etiqueta y la
      // escala se queda en 1, antes que inventarse un nombre.
      localStorage.setItem('font-size', 'gigante');
      expect(service.obtenerEtiqueta()).toBe('');
      expect(service.obtenerScale()).toBe(1.0);
    });
  });

  describe('opciones', () => {
    it('ofrece los cuatro tamanos, en orden de mas pequeno a mas grande', () => {
      expect(service.opciones.map(o => o.id)).toEqual([
        'pequeno',
        'normal',
        'grande',
        'extra-grande'
      ]);
    });

    it('las escalas crecen de a uno', () => {
      const escalas = service.opciones.map(o => o.scale);
      expect(escalas).toEqual([0.85, 1.0, 1.15, 1.3]);
      for (let i = 1; i < escalas.length; i++) {
        expect(escalas[i]).toBeGreaterThan(escalas[i - 1]);
      }
    });

    it('cada opcion tiene texto para la persona y para la vista previa', () => {
      for (const opcion of service.opciones) {
        expect(opcion.label.length).toBeGreaterThan(0);
        expect(opcion.preview).toBe('Aa');
      }
    });
  });
});
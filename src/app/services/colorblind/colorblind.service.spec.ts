import { TestBed } from '@angular/core/testing';
import { ColorblindService } from './colorblind.service';

describe('ColorblindService', () => {

  let service: ColorblindService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--cb-filtro');
    TestBed.configureTestingModule({});
    service = TestBed.inject(ColorblindService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('modo e intensidad', () => {
    it('empieza sin filtro', () => {
      expect(service.obtener()).toBe('ninguno');
      expect(service.obtenerIntensidad()).toBe(100);
    });

    it('guarda y recupera el modo', () => {
      service.guardar('deuteranopia');
      expect(service.obtener()).toBe('deuteranopia');
    });

    it('ignora un modo guardado que no existe', () => {
      localStorage.setItem('filtro-color-modo', 'inventado');
      expect(service.obtener()).toBe('ninguno');
    });

    it('usa 100% si la intensidad guardada no es un número', () => {
      localStorage.setItem('filtro-color-intensidad', 'mucho');
      expect(service.obtenerIntensidad()).toBe(100);
    });
  });

  describe('interpolar', () => {
    const identidad = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    let matriz: number[];

    beforeEach(() => {
      matriz = service.opciones.find(o => o.id === 'protanopia')!.matriz!;
    });

    it('al 100% devuelve la matriz sin tocar', () => {
      service.guardarIntensidad(100);
      service.guardar('protanopia');
      expect(service.interpolar(matriz)).toEqual(matriz);
    });

    it('al 0% devuelve la identidad, que es no filtrar', () => {
      service.guardarIntensidad(0);
      service.guardar('protanopia');
      service.interpolar(matriz).forEach((valor, i) => {
        expect(valor).toBeCloseTo(identidad[i], 4);
      });
    });

    it('al 50% queda a mitad de camino entre identidad y matriz', () => {
      service.guardarIntensidad(50);
      service.guardar('protanopia');
      service.interpolar(matriz).forEach((valor, i) => {
        expect(valor).toBeCloseTo(identidad[i] + (matriz[i] - identidad[i]) * 0.5, 4);
      });
    });

    it('conserva los ceros de la matriz, que no es un color negro', () => {
      service.guardarIntensidad(100);
      service.guardar('protanopia');
      // El rojo de protanopía no tiene componente verde en la fila 1: si el
      // cero se perdiera, la pantalla se vería verde en lugar de amarilla.
      expect(service.interpolar(matriz)[2]).toBe(0);
    });
  });

  describe('resumen', () => {
    it('dice "Desactivado" sin filtro, para que Ajustes lo muestre claro', () => {
      expect(service.resumen()).toBe('Desactivado');
    });

    it('incluye modo e intensidad cuando hay filtro', () => {
      service.guardar('tritanopia');
      service.guardarIntensidad(70);
      expect(service.resumen()).toBe('Tritanopía · 70%');
    });
  });

  describe('aplicar', () => {
    function crearMatrizFalso(): Element {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const filtro = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filtro.setAttribute('id', 'cb-colorblind');
      const matriz = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
      matriz.setAttribute('id', 'cb-colorblind-matrix');
      filtro.appendChild(matriz);
      svg.appendChild(filtro);
      document.body.appendChild(svg);
      return matriz;
    }

    it('escribe la matriz interpolada y apunta al filtro', () => {
      const matriz = crearMatrizFalso();
      service.guardar('protanopia');
      service.guardarIntensidad(100);
      service.aplicar();

      const valores = matriz.getAttribute('values')!.split(' ');
      expect(valores).toHaveLength(20);
      // Cada fila son 4 coeficientes + la constante: los coeficientes de color
      // van en 0, 2 y 4, y el alfa es un cero en 1, 3 y 5.
      expect(Number(valores[0])).toBeCloseTo(0.567, 4);
      expect(valores[1]).toBe('0');
      expect(Number(valores[2])).toBeCloseTo(0.433, 4);
      // La cuarta fila es el alfa y no se toca.
      expect(valores.slice(15)).toEqual(['0', '0', '0', '1', '0']);
      expect(document.documentElement.style.getPropertyValue('--cb-filtro'))
        .toBe('url(#cb-colorblind)');

      svgLimpio();
    });

    it('desactiva el filtro cuando el modo es ninguno', () => {
      const matriz = crearMatrizFalso();
      service.guardar('protanopia');
      service.guardarIntensidad(100);
      service.aplicar();
      service.guardar('ninguno');

      // Sin limpiar la variable el filtro se queda puesto para siempre.
      expect(document.documentElement.style.getPropertyValue('--cb-filtro')).toBe('none');

      svgLimpio();
    });
  });
});

function svgLimpio(): void {
  document.querySelectorAll('svg').forEach(n => n.remove());
}

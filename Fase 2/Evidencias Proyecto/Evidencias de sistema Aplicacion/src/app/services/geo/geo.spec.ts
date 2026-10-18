import { haversineMetros, esCoordenadaValida } from './geo';

describe('geo', () => {

  describe('haversineMetros', () => {
    it('da cero cuando el origen y el destino son el mismo punto', () => {
      expect(haversineMetros(-33.4489, -70.6693, -33.4489, -70.6693)).toBe(0);
    });

    it('mide un grado de latitud como unos 111 km', () => {
      // Un grado de latitud es siempre lo mismo en cualquier parte del
      // planeta, asi que este numero es el que sirve de referencia.
      expect(haversineMetros(0, 0, 1, 0)).toBeCloseTo(111195, -2);
    });

    it('mide igual un grado de longitud en el ecuador', () => {
      // Solo en el ecuador: mas al norte un grado de longitud se acorta.
      expect(haversineMetros(0, 0, 0, 1)).toBeCloseTo(111195, -2);
    });

    it('acorta el grado de longitud al alejar del ecuador', () => {
      const ecuador = haversineMetros(0, 0, 0, 1);
      const norte = haversineMetros(60, 0, 60, 1);
      expect(norte).toBeLessThan(ecuador);
    });

    it('da la misma distancia en los dos sentidos', () => {
      const ida = haversineMetros(-33.4489, -70.6693, -33.0472, -71.6127);
      const vuelta = haversineMetros(-33.0472, -71.6127, -33.4489, -70.6693);
      expect(ida).toBeCloseTo(vuelta, 6);
    });

    it('acerca Santiago con una distancia de escala realista', () => {
      // Solo se comprueba el orden de magnitud: si la formula se rompiera
      // (grados sin convertir, radio equivocado) el numero se saldria de aqui
      // por mucho, y eso es lo que hay que detectar.
      const metros = haversineMetros(-33.4489, -70.6693, -33.0472, -71.6127);
      expect(metros).toBeGreaterThan(80_000);
      expect(metros).toBeLessThan(120_000);
    });
  });

  describe('esCoordenadaValida', () => {
    it('acepta unas coordenadas normales de ciudad', () => {
      expect(esCoordenadaValida(-33.4489, -70.6693)).toBe(true);
    });

    it('acepta los bordes exactos del rango', () => {
      expect(esCoordenadaValida(90, 180)).toBe(true);
      expect(esCoordenadaValida(-90, -180)).toBe(true);
    });

    it('rechaza lo que se sale del rango del planeta', () => {
      expect(esCoordenadaValida(91, 0)).toBe(false);
      expect(esCoordenadaValida(-91, 0)).toBe(false);
      expect(esCoordenadaValida(0, 181)).toBe(false);
    });

    it('rechaza el punto cero cero, que es el golfo de Guinea y no una ubicacion', () => {
      expect(esCoordenadaValida(0, 0)).toBe(false);
    });

    it('rechaza NaN e infinito, que llegan cuando el GPS no fijo posicion', () => {
      expect(esCoordenadaValida(NaN, 0)).toBe(false);
      expect(esCoordenadaValida(0, NaN)).toBe(false);
      expect(esCoordenadaValida(Infinity, 0)).toBe(false);
      expect(esCoordenadaValida(0, -Infinity)).toBe(false);
    });
  });
});
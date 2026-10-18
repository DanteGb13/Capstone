import { estaEnLinea, UMBRAL_EN_LINEA_MS } from './presencia';

describe('estaEnLinea', () => {
  // Se fija un "ahora" para que las pruebas no dependan del reloj real.
  const AHORA = new Date('2026-03-10T12:00:00Z').getTime();

  function haceCuanto(milisegundos: number): string {
    return new Date(AHORA - milisegundos).toISOString();
  }

  it('devuelve null cuando no hay dato de la persona', () => {
    // null y no false: el panel tiene que distinguir "no hay dato" de
    // "esta sin conexión", porque se muestran distinto.
    expect(estaEnLinea(null, AHORA)).toBeNull();
    expect(estaEnLinea(undefined, AHORA)).toBeNull();
    expect(estaEnLinea('', AHORA)).toBeNull();
  });

  it('devuelve true con un latido recien llegado', () => {
    expect(estaEnLinea(haceCuanto(5_000), AHORA)).toBe(true);
  });

  it('devuelve true justo en el umbral, porque todavia no se pasó', () => {
    expect(estaEnLinea(haceCuanto(UMBRAL_EN_LINEA_MS), AHORA)).toBe(true);
  });

  it('devuelve false apenas pasa el umbral', () => {
    expect(estaEnLinea(haceCuanto(UMBRAL_EN_LINEA_MS + 1), AHORA)).toBe(false);
  });

  it('devuelve false con un latido de hace mucho', () => {
    expect(estaEnLinea(haceCuanto(60 * 60 * 1000), AHORA)).toBe(false);
  });

  it('devuelve null si la fecha guardada no es una fecha', () => {
    expect(estaEnLinea('no-es-una-fecha', AHORA)).toBeNull();
  });

  it('acepta la fecha tal como la guarda el reloj del telefono', () => {
    // `toISOString` no siempre es lo que queda en la base, asi que tambien
    // tiene que servirtodavia un formato local legible.
    expect(estaEnLinea('2026-03-10T11:59:00', AHORA)).toBe(true);
  });

  it('usa la hora actual cuando no le pasan un ahora', () => {
    const hace10Segundos = new Date(Date.now() - 10_000).toISOString();
    expect(estaEnLinea(hace10Segundos)).toBe(true);
  });
});

describe('UMBRAL_EN_LINEA_MS', () => {
  it('es de dos minutos', () => {
    expect(UMBRAL_EN_LINEA_MS).toBe(120_000);
  });
});
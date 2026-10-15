import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HistorialPage, EventoHistorial } from './historial.page';

describe('HistorialPage', () => {
  let component: HistorialPage;
  let fixture: ComponentFixture<HistorialPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(HistorialPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('agrupa los eventos por día, del más reciente al más antiguo', () => {
    const hoy = new Date();
    const mediodia = new Date(
      hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12, 0
    );
    const ayer = new Date(
      hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1, 12, 0
    );
    const haceTresDias = new Date(
      hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 3, 12, 0
    );

    component.eventos = [
      evento('1', 'sos', 'SOS activado', ayer),
      evento('2', 'zona', 'Fuera de zona segura', mediodia),
      evento('3', 'desplazamiento', 'Desplazamiento finalizado', haceTresDias)
    ];

    const grupos = component.grupos;

    expect(grupos.map((g) => g.etiqueta).slice(0, 2)).toEqual(['Hoy', 'Ayer']);
    expect(grupos[0].eventos[0].id).toBe('2');
    expect(grupos[1].eventos[0].id).toBe('1');
  });

  it('filtra por tipo y por texto de búsqueda', () => {
    const base = new Date();

    component.eventos = [
      evento('1', 'sos', 'SOS activado', new Date(base.getTime() - 3000)),
      evento('2', 'zona', 'Fuera de zona segura', new Date(base.getTime() - 2000)),
      evento('3', 'zona', 'Viaje vigilado terminado', new Date(base.getTime() - 1000))
    ];

    component.filtroActivo = 'alertas';
    expect(component.eventosFiltrados.map((e) => e.id)).toEqual(['3', '2']);

    component.filtroActivo = 'todos';
    component.busqueda = 'viaje';
    expect(component.eventosFiltrados.map((e) => e.id)).toEqual(['3']);
  });

  it('devuelve la hora en formato HH:MM', () => {
    const fecha = new Date(2026, 0, 5, 9, 7);

    expect(component.hora(fecha)).toBe('09:07');
  });
});

function evento(
  id: string,
  tipo: EventoHistorial['tipo'],
  detalle: string,
  fecha: Date
): EventoHistorial {
  return {
    id,
    idAdulto: 'adulto-1',
    tipo,
    titulo: detalle,
    detalle,
    fecha
  };
}

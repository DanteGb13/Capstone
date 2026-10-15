import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ZonaSeguraPage } from './zona-segura.page';
import { ZonaSegura } from '../../services/Backend/zona-segura/zona-segura';

describe('ZonaSeguraPage', () => {
  let component: ZonaSeguraPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZonaSeguraPage],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(ZonaSeguraPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('direccionZona no devuelve coordenadas numéricas', () => {
    const zona = {
      id: 'z1',
      direccion_texto: '',
      latitud_centro: -33.4489,
      longitud_centro: -70.6693
    } as ZonaSegura;

    expect(component.direccionZona(zona)).toBe('');
    expect(component.etiquetaDireccionZona(zona)).toBe('Calculando dirección…');
  });

  it('direccionZona usa la dirección guardada', () => {
    const zona = {
      id: 'z2',
      direccion_texto: 'Roberto Pérez 400, Providencia'
    } as ZonaSegura;

    expect(component.direccionZona(zona)).toBe('Roberto Pérez 400, Providencia');
  });

  it('textoCentroZona muestra la dirección y nunca números', () => {
    expect(component.textoCentroZona).toBe('');

    component.pendienteLat = -33.4489;
    component.pendienteLng = -70.6693;
    component.formDireccion = {
      texto: '',
      region: 'Región Metropolitana',
      comuna: 'Providencia',
      calle: 'Roberto Pérez',
      numero: '400'
    };

    expect(component.textoCentroZona).toBe('Roberto Pérez 400');
  });

  it('nombreParaGuardar nunca queda vacío', () => {
    component.formNombre = '';
    component.formDireccion = { texto: '', region: '', comuna: '', calle: '', numero: '' };
    component.formDireccionTexto = '';
    expect(component.nombreParaGuardar()).toBe('Zona segura');

    component.formDireccion = {
      texto: 'Av. Siempre 123, Providencia',
      region: 'Región Metropolitana',
      comuna: 'Providencia',
      calle: 'Av. Siempre',
      numero: '123'
    };
    expect(component.nombreParaGuardar()).toBe('Av. Siempre 123, Providencia');

    component.formNombre = '  Plaza  ';
    expect(component.nombreParaGuardar()).toBe('Plaza');
  });
});

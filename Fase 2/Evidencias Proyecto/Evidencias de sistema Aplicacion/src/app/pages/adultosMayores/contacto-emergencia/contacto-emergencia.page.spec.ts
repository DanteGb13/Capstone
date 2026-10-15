import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ContactoEmergenciaPage } from './contacto-emergencia.page';

describe('ContactoEmergenciaPage', () => {
  let component: ContactoEmergenciaPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactoEmergenciaPage],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(ContactoEmergenciaPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('iniciales devuelve las iniciales del nombre', () => {
    expect(component.iniciales('María Pérez')).toBe('MP');
    expect(component.iniciales('juan')).toBe('JU');
    expect(component.iniciales('')).toBe('?');
  });
});

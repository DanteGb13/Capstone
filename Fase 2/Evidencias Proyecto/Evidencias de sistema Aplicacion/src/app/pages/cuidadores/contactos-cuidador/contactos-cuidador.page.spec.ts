import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ContactosCuidadorPage } from './contactos-cuidador.page';

describe('ContactosCuidadorPage', () => {
  let component: ContactosCuidadorPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactosCuidadorPage],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(ContactosCuidadorPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('iniciales devuelve las iniciales de un contacto', () => {
    expect(component.iniciales('María Pérez')).toBe('MP');
    expect(component.iniciales('juan')).toBe('JU');
    expect(component.iniciales('')).toBe('?');
  });

  it('inicialesAdulto arma las iniciales desde el adulto vinculado', () => {
    const adulto = { adulto_mayor: { nombre: 'Juan', apellidopa: 'Pérez' } };
    expect(component.inicialesAdulto(adulto)).toBe('JP');
    expect(component.inicialesAdulto({})).toBe('?');
  });

  it('alternarVista alterna entre la lista del adulto y las públicas', () => {
    expect(component.soloPublicos).toBe(false);

    component.alternarVista();
    expect(component.soloPublicos).toBe(true);

    component.alternarVista();
    expect(component.soloPublicos).toBe(false);
  });

  it('seleccionarAdulto cambia de persona y limpia la lista anterior', () => {
    const uno = { id: 'cu-1', id_usuario: 'usu-1', adulto_mayor: { nombre: 'Ana' } };
    const otro = { id: 'cu-2', id_usuario: 'usu-2', adulto_mayor: { nombre: 'Luis' } };

    component.adultosACargo = [uno, otro];
    component.adultoSeleccionado = uno;
    component.idAdulto = 'usu-1';
    component.contactos = [{ id: 'c-1', nombre: 'Viejo' } as any];

    component.seleccionarAdulto(otro);

    expect(component.idAdulto).toBe('usu-2');
    expect(component.contactos).toEqual([]);
    expect(component.esSeleccionado(otro)).toBe(true);
    expect(component.nombreSeleccionado()).toBe('Luis');
  });

  it('mensajeFallo traducido no filtra el detalle real de RLS', () => {
    const mensaje = (component as any).mensajeFallo('row-level security policy', 'cargar');
    expect(mensaje).toContain('no te dio permiso');
  });
});

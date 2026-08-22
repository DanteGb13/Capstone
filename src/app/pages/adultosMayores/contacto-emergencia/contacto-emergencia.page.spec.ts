import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContactoEmergenciaPage } from './contacto-emergencia.page';

describe('ContactoEmergenciaPage', () => {
  let component: ContactoEmergenciaPage;
  let fixture: ComponentFixture<ContactoEmergenciaPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ContactoEmergenciaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

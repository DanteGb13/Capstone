import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CorreoContrasenaPage } from './correo-contrasena.page';

describe('CorreoContrasenaPage', () => {
  let component: CorreoContrasenaPage;
  let fixture: ComponentFixture<CorreoContrasenaPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CorreoContrasenaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

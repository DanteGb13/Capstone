import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EditarInformacionPage } from './editar-informacion.page';

describe('EditarInformacionPage', () => {
  let component: EditarInformacionPage;
  let fixture: ComponentFixture<EditarInformacionPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(EditarInformacionPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SiguientePasoPage } from './siguiente-paso.page';

describe('SiguientePasoPage', () => {
  let component: SiguientePasoPage;
  let fixture: ComponentFixture<SiguientePasoPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SiguientePasoPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

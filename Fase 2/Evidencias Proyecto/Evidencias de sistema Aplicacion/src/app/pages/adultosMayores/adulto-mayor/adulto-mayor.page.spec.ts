import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdultoMayorPage } from './adulto-mayor.page';

describe('AdultoMayorPage', () => {
  let component: AdultoMayorPage;
  let fixture: ComponentFixture<AdultoMayorPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(AdultoMayorPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

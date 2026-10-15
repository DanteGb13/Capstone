import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdultoCargoPage } from './adulto-cargo.page';

describe('AdultoCargoPage', () => {
  let component: AdultoCargoPage;
  let fixture: ComponentFixture<AdultoCargoPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(AdultoCargoPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { TestBed } from '@angular/core/testing';
import { registro } from './registro';

describe('Registro', () => {
  let service: registro;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(registro);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

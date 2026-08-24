import { TestBed } from '@angular/core/testing';
import { Vinculacion } from './vinculacion';

describe('Vinculacion', () => {
  let service: Vinculacion;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Vinculacion);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

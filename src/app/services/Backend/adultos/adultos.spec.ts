import { TestBed } from '@angular/core/testing';
import { Adultos } from './adultos';

describe('Adultos', () => {
  let service: Adultos;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Adultos);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

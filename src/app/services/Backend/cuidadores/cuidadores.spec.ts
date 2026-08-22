import { TestBed } from '@angular/core/testing';
import { Cuidadores } from './cuidadores';

describe('Cuidadores', () => {
  let service: Cuidadores;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Cuidadores);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

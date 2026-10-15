import { TestBed } from '@angular/core/testing';
import { CuidadoresService } from './cuidadores';

describe('Cuidadores', () => {
  let service: CuidadoresService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CuidadoresService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

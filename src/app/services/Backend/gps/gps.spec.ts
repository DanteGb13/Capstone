import { TestBed } from '@angular/core/testing';
import { Gps } from './gps';

describe('Gps', () => {
  let service: Gps;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Gps);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

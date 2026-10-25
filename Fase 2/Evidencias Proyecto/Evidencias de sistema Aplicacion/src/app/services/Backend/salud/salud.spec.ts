vi.mock('@capgo/capacitor-health', () => ({
  Health: {
    queryAggregated: vi.fn(),
    readSamples: vi.fn()
  }
}));

import { TestBed } from '@angular/core/testing';
import { Health } from '@capgo/capacitor-health';
import { Salud } from './salud';
import { SupabaseService } from '../../supabase/supabase';

describe('Salud', () => {
  let salud: Salud;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        Salud,
        { provide: SupabaseService, useValue: { getClient: () => ({}) } }
      ]
    });
    salud = TestBed.inject(Salud);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('calcula las pulsaciones desde muestras válidas si la agregación entrega ceros', async () => {
    const ahora = new Date();
    const lecturaAntigua = new Date(ahora.getTime() - 60 * 60 * 1000).toISOString();
    const lecturaReciente = new Date(ahora.getTime() - 10 * 60 * 1000).toISOString();

    vi.mocked(Health.queryAggregated).mockImplementation(async ({ dataType }) => {
      if (dataType === 'heartRate') {
        return {
          samples: [{
            startDate: lecturaAntigua,
            endDate: lecturaReciente,
            value: 0,
            values: { average: 0, min: 0, max: 0 },
            unit: 'bpm'
          }]
        };
      }
      return { samples: [] };
    });

    vi.mocked(Health.readSamples).mockImplementation(async ({ dataType }) => ({
      samples: dataType === 'heartRate'
        ? [
          {
            dataType: 'heartRate',
            value: 88,
            unit: 'bpm',
            startDate: lecturaReciente,
            endDate: lecturaReciente
          },
          {
            dataType: 'heartRate',
            value: 72,
            unit: 'bpm',
            startDate: lecturaAntigua,
            endDate: lecturaAntigua
          }
        ]
        : []
    }));

    const resumen = await salud.leerResumen();

    expect(resumen.fc_media).toBe(80);
    expect(resumen.fc_minima).toBe(72);
    expect(resumen.fc_maxima).toBe(88);
    expect(resumen.fc_ultima_hora).toBe(lecturaReciente);
  });

  it('usa la hora de una lectura real cuando la agregación sí tiene valores', async () => {
    const ahora = new Date();
    const lectura = new Date(ahora.getTime() - 5 * 60 * 1000).toISOString();

    vi.mocked(Health.queryAggregated).mockImplementation(async ({ dataType }) => ({
      samples: dataType === 'heartRate'
        ? [{
          startDate: lectura,
          endDate: ahora.toISOString(),
          value: 70,
          values: { average: 70, min: 60, max: 80 },
          unit: 'bpm'
        }]
        : []
    }));

    vi.mocked(Health.readSamples).mockImplementation(async ({ dataType }) => ({
      samples: dataType === 'heartRate'
        ? [{
          dataType: 'heartRate',
          value: 75,
          unit: 'bpm',
          startDate: lectura,
          endDate: lectura
        }]
        : []
    }));

    const resumen = await salud.leerResumen();

    expect(resumen.fc_media).toBe(70);
    expect(resumen.fc_minima).toBe(60);
    expect(resumen.fc_maxima).toBe(80);
    expect(resumen.fc_ultima_hora).toBe(lectura);
  });
});

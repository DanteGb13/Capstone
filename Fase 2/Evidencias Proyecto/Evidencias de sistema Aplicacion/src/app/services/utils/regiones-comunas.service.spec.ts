import { RegionesComunasService, RegionChile } from './regiones-comunas.service';

describe('RegionesComunasService', () => {

  let service: RegionesComunasService;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Respuesta con forma del asset embebido: 16 regiones con 2 comunas cada una. */
  function respuestaAsset(): any {
    return Array.from({ length: 16 }, (_, i) => ({
      id: String(i + 1),
      nombre: `Region ${String(i + 1).padStart(2, '0')}`,
      comunas: ['Zeta Comuna', 'Alfa Comuna'],
    }));
  }

  function ok(datos: any) {
    return { ok: true, json: async () => datos };
  }

  beforeEach(() => {
    service = new RegionesComunasService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('carga las 16 regiones desde el asset embebido', async () => {
    fetchMock.mockResolvedValue(ok(respuestaAsset()));

    const regiones = await service.regiones();

    expect(regiones.length).toBe(16);
    expect(regiones[0].nombre).toBe('Region 01');
    expect(regiones[0].comunas).toEqual(['Zeta Comuna', 'Alfa Comuna']);
    expect(fetchMock).toHaveBeenCalledWith('assets/division-administrativa-chile.json');
  });

  it('guarda una copia en localStorage para la próxima sesión', async () => {
    fetchMock.mockResolvedValue(ok(respuestaAsset()));
    await service.regiones();

    expect(localStorage.getItem('sc_dpa_v1')).toBeTruthy();

    // segunda instancia (simula nueva sesión): usa la caché sin ir al asset
    const servicio2 = new RegionesComunasService();
    const regiones = await servicio2.regiones();
    expect(regiones.length).toBe(16);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('comunasDe devuelve las comunas de la región pedida', async () => {
    fetchMock.mockResolvedValue(ok(respuestaAsset()));

    const comunas = await service.comunasDe('Region 03');

    expect(comunas).toEqual(['Zeta Comuna', 'Alfa Comuna']);
  });

  it('comunasDe devuelve vacío para una región desconocida', async () => {
    fetchMock.mockResolvedValue(ok(respuestaAsset()));

    const comunas = await service.comunasDe('No Existe');

    expect(comunas).toEqual([]);
  });

  it('si el asset falla, lanza un error amable', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));

    let mensaje = '';
    try {
      await service.regiones();
    } catch (e: any) {
      mensaje = e?.message ?? '';
    }

    expect(mensaje).toMatch(/cargar las regiones/);
  });

  it('limpiar() borra la caché para que la próxima carga vuelva al asset', async () => {
    fetchMock.mockResolvedValue(ok(respuestaAsset()));
    await service.regiones();
    expect(localStorage.getItem('sc_dpa_v1')).toBeTruthy();

    service.limpiar();

    expect(localStorage.getItem('sc_dpa_v1')).toBeNull();
  });

});

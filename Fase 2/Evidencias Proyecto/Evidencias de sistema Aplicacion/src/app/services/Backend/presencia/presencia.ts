import { Injectable, inject } from '@angular/core';
import { Network } from '@capacitor/network';
import { SupabaseService } from '../../supabase/supabase';

/** Cada cuánto se deja constancia de que la app sigue activa. */
const INTERVALO_MS = 45000;

/** Sin latido durante 2 minutos: se considera "sin conexión". */
export const UMBRAL_EN_LINEA_MS = 120000;

/**
 * Estado "en línea / sin conexión" de una persona.
 *
 * La app del adulto escribe su hora de última actividad (usuario.ultimo_visto)
 * mientras tenga internet; si se queda sin señal el latido se corta y el
 * cuidador ve "Sin conexión". Al volver la señal, el latido se reanuda.
 */
@Injectable({ providedIn: 'root' })
export class PresenciaService {

  private supabaseService = inject(SupabaseService);

  private timer: any = null;

  private escuchaRed: any = null;

  /** Arranca el latido (se llama una sola vez al abrir la app). */
  iniciar(): void {
    if (this.timer) return;

    void this.latir();

    this.timer = setInterval(() => void this.latir(), INTERVALO_MS);

    try {
      // Al volver la señal se marca el estado en línea de inmediato.
      this.escuchaRed = Network.addListener('networkStatusChange', (estado) => {
        if (estado.connected) void this.latir();
      });
    } catch {
      /* sin plugin de red: el latido por tiempo sigue funcionando */
    }
  }

  detener(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.escuchaRed) {
      try {
        this.escuchaRed.remove?.();
      } catch {
        /* ya removida */
      }
      this.escuchaRed = null;
    }
  }

  /**
   * Id de la sesión actual, cacheado.
   *
   * Antes se llamaba `auth.getUser()` en CADA latido. Ese método NO es local:
   * va al servidor de autenticación a validar el token. Con el latido cada 45 s
   * eso son ~1.900 pedidos de autenticación por día y por teléfono, sólo para
   * averiguar un id que no cambia mientras la sesión siga abierta.
   *
   * `getSession()` sí lee de forma local, y el id se guarda en memoria para no
   * ni siquiera releerlo.
   */
  private idCacheado: string | null = null;

  private async idDeUsuario(): Promise<string | null> {
    if (this.idCacheado) return this.idCacheado;

    try {
      const { data } = await this.supabaseService.getClient().auth.getSession();
      const id = data?.session?.user?.id ?? null;
      if (id) this.idCacheado = id;
      return id;
    } catch {
      return null;
    }
  }

  /** Escribe la hora actual en el usuario (sólo funciona con internet). */
  async latir(): Promise<void> {
    try {
      const id = await this.idDeUsuario();
      if (!id) return;

      await this.supabaseService.getClient()
        .from('usuario')
        .update({ ultimo_visto: new Date().toISOString() })
        .eq('id', id);
    } catch {
      /* sin conexión: se vuelve a intentar en el próximo latido */
    }
  }

  /** Última hora en que la persona tuvo la app activa (la lee el cuidador). */
  async obtenerUltimoVisto(idUsuario: string): Promise<string | null> {
    const vistos = await this.obtenerUltimosVistos([idUsuario]);
    return vistos[idUsuario] ?? null;
  }

  /**
   * Último avistamiento de VARIAS personas en una sola consulta.
   *
   * El panel del cuidador preguntaba uno por uno, y con 3 adultos mayores eran
   * 3 viajes a la base cada 30 segundos. Con esto es siempre uno solo.
   */
  async obtenerUltimosVistos(idsUsuarios: string[]): Promise<Record<string, string | null>> {
    const salida: Record<string, string | null> = {};
    const ids = (idsUsuarios || []).filter(Boolean);
    if (ids.length === 0) return salida;

    for (const id of ids) salida[id] = null;

    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('usuario')
        .select('id, ultimo_visto')
        .in('id', ids);

      if (error) {
        console.warn('No se pudieron leer los últimos avistamientos:', error.message);
        return salida;
      }

      for (const fila of data ?? []) {
        salida[fila.id] = fila.ultimo_visto || null;
      }
    } catch {
      // sin conexión: todos quedan en null = "sin conexión", que es lo correcto
    }

    return salida;
  }
}

/**
 * ¿Está en línea la persona?
 *  true  -> latido reciente (tiene internet y la app activa),
 *  false -> pasó el umbral sin latir (sin conexión),
 *  null  -> sin datos de la persona.
 */
export function estaEnLinea(
  ultimoVisto: string | null | undefined,
  ahora: number = Date.now()
): boolean | null {
  if (!ultimoVisto) return null;

  const edad = ahora - new Date(ultimoVisto).getTime();
  if (isNaN(edad)) return null;

  return edad <= UMBRAL_EN_LINEA_MS;
}

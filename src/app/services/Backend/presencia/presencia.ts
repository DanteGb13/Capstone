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

  /** Escribe la hora actual en el usuario (sólo funciona con internet). */
  async latir(): Promise<void> {
    try {
      const cliente = this.supabaseService.getClient();
      const { data } = await cliente.auth.getUser();
      const id = data?.user?.id;
      if (!id) return;

      await cliente
        .from('usuario')
        .update({ ultimo_visto: new Date().toISOString() })
        .eq('id', id);
    } catch {
      /* sin conexión: se vuelve a intentar en el próximo latido */
    }
  }

  /** Última hora en que la persona tuvo la app activa (la lee el cuidador). */
  async obtenerUltimoVisto(idUsuario: string): Promise<string | null> {
    if (!idUsuario) return null;

    try {
      const { data } = await this.supabaseService.getClient()
        .from('usuario')
        .select('ultimo_visto')
        .eq('id', idUsuario)
        .maybeSingle();

      return data?.ultimo_visto || null;
    } catch {
      return null;
    }
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

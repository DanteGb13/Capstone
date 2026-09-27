import { Injectable, NgZone, inject } from '@angular/core';
import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase';

/** Tablas cuya watching reemplaza al sondeo cada 30 s. */
export type TablaVinculacion = 'solicitud_vinculacion' | 'cuidador_usuario';

export interface EventoVinculacion {
  tabla: TablaVinculacion;
  operacion: 'INSERT' | 'UPDATE' | 'DELETE';
  nuevo: Record<string, any> | null;
  viejo: Record<string, any> | null;
}

/** Cuánto se espera para decidir que Realtime no está delivering. */
const TIEMPO_CANARIO_MS = 6000;

/**
 * Suscripciones en vivo a la vinculación.
 *
 * POR QUÉ EXISTE ESTE SERVICIO
 *
 * Antes se esperaba que apareciera una vinculación nueva con un
 * `setInterval(30_000)` que sólo corría con el panel abierto. El resultado:
 * hasta 30 s de espera, y nada si estabas en otra pantalla.
 *
 * POR QUÉ HAY QUE TENER CUIDADO CON ESTO
 *
 * Supabase Realtime tiene dos capas: el WebSocket (siempre encendido) y la
 * replicación de Postgres. Una tabla sólo emite eventos si está agregada a la
 * publicación `supabase_realtime`:
 *
 *     alter publication supabase_realtime add table public.solicitud_vinculacion;
 *     alter publication supabase_realtime add table public.cuidador_usuario;
 *
 * Si falta ese paso, `subscribe()` devuelve SUBSCRIBED — o sea, reporta que
 * todo salió bien — y no llega ningún evento jamás. No hay error ni warning.
 * Por eso este servicio:
 *  1. mide cuánto tarda en conectar y lo loguea,
 *  2. corre un canario para detectar que no está llegando nada,
 *  3. expone `disponible` para que las pantallas caigan al sondeo.
 *
 * El sondeo NUNCA se elimina: sigue siendo la red de seguridad.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {

  private supabaseService = inject(SupabaseService);

  private ngZone = inject(NgZone);

  private canal: RealtimeChannel | null = null;

  private idUsuarioActual: string | null = null;

  private oyentes = new Set<(e: EventoVinculacion) => void>();

  /**
   * false cuando la suscripción no está entregando eventos. La app no muestra
   * ningún error al usuario en este caso: sólo cambia de estrategia internamente.
   */
  private _disponible = false;

  /** Por qué se cree que no está disponible, para el log. */
  private _motivo = 'sin suscribir';

  /** Marcador para saber si el canario espera un evento o ninguno. */
  private canarioActivo = false;

  private temporizadorCanario: any = null;

  get disponible(): boolean {
    return this._disponible;
  }

  get motivo(): string {
    return this._motivo;
  }

  // =====================================================
  // API PÚBLICA
  // =====================================================

  /** Se registra un oyente. Devuelve la función para darse de baja. */
  escuchar(fn: (e: EventoVinculacion) => void): () => void {
    this.oyentes.add(fn);
    return () => this.oyentes.delete(fn);
  }

  /**
   * Abre la suscripción para el usuario indicado.
   * Es idempotente: llamarla de más no crea canales duplicados.
   */
  async suscribir(idUsuario: string): Promise<void> {
    if (!idUsuario) return;

    if (this.canal && this.idUsuarioActual === idUsuario) {
      return;
    }

    await this.cerrar();

    this.idUsuarioActual = idUsuario;
    this._disponible = false;
    this._motivo = 'suscribiendo';

    const supabase: SupabaseClient = this.supabaseService.getClient();
    const inicio = Date.now();

    // Un solo canal para las dos tablas: menos conexiones y una sola señal de
    // "conectado". Los filtros usan el id del usuario para no recibir eventos
    // de terceros.
    const canal = supabase
      .channel(`vinculacion-${idUsuario.slice(0, 8)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'solicitud_vinculacion',
          filter: `id_usuario=eq.${idUsuario}`
        },
        (payload) => this.recibir('solicitud_vinculacion', payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cuidador_usuario',
          filter: `id_usuario=eq.${idUsuario}`
        },
        (payload) => this.recibir('cuidador_usuario', payload)
      )
      .subscribe((estado) => this.estadoCambio(estado, inicio));

    this.canal = canal;
  }

  /** Cierra la suscripción. Se llama al cerrar sesión o al salir del panel. */
  async cerrar(): Promise<void> {
    this.limpiarCanario();

    if (this.canal) {
      try {
        await this.supabaseService.getClient().removeChannel(this.canal);
      } catch (e) {
        console.warn('No se pudo cerrar el canal de Realtime:', e);
      }
      this.canal = null;
    }

    this.idUsuarioActual = null;
    this._disponible = false;
    this._motivo = 'sin suscribir';
  }

  /**
   * Fuerza una comprobación de que la suscripción está viva.
   *
   * Útil para diagnosticar: si tras `esperar` ms no llegó ningún evento, avisa
   * por log que probablemente falte el `alter publication`.
   */
  comprobar(esperar = TIEMPO_CANARIO_MS): Promise<boolean> {
    return new Promise((resolve) => {
      this.canarioActivo = true;
      this.limpiarCanario();
      this.temporizadorCanario = setTimeout(() => {
        this.temporizadorCanario = null;
      if (this.canarioActivo) {
        this.canarioActivo = false;
        this.limpiarCanario();
        this.marcarNoDisponible(
          `la suscripción conectó pero no llegó ningún evento en ${esperar} ms: ` +
          'probablemente falte el "alter publication supabase_realtime"'
        );
      }
        resolve(this._disponible);
      }, esperar);
    });
  }

  // =====================================================
  // INTERNO
  // =====================================================

  private estadoCambio(estado: string, inicio: number): void {
    const ms = Date.now() - inicio;

    if (estado === 'SUBSCRIBED') {
      // Que conecte NO prueba que la tabla esté en la publicación: por eso el
      // canario sigue corriendo. Un CHANNEL_ERROR o TIMED_OUT sí es un fallo
      // claro y ahí sí se marca como no disponible de inmediato.
      console.log(`[Realtime] conectado en ${ms} ms (id ${this.idUsuarioActual?.slice(0, 8)})`);
      this.limpiarCanario();
      this.temporizadorCanario = setTimeout(() => {
        this.temporizadorCanario = null;
        // Conectó pero nadie envió evento en la ventana de prueba: no se puede
        // afirmar que funcione, pero tampoco se declara roto (puede que no
        // hubiera nada que notificar). Se deja disponible y el sondeo sigue
        // de respaldo.
        this.marcarDisponible('conectado, sin eventos en la ventana de prueba');
      }, 1000);
      return;
    }

    if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
      this.marcarNoDisponible(`estado del canal: ${estado} (${ms} ms)`);
    }
  }

  private recibir(tabla: TablaVinculacion, payload: any): void {
    // El primer evento real demuestra que la publicación está bien configurada.
    if (this.canarioActivo) {
      this.canarioActivo = false;
      this.limpiarCanario();
      this.marcarDisponible('primer evento recibido');
    }

    const evento: EventoVinculacion = {
      tabla,
      operacion: (payload.eventType ?? 'UPDATE') as EventoVinculacion['operacion'],
      nuevo: (payload.new ?? null) as Record<string, any> | null,
      viejo: (payload.old ?? null) as Record<string, any> | null
    };

    // Los listeners tocan el estado de la vista: hay que volver al hilo de
    // Angular o el cambio no se ve hasta la próxima detección de cambios.
    this.ngZone.run(() => {
      for (const fn of this.oyentes) {
        try {
          fn(evento);
        } catch (e) {
          console.warn('[Realtime] un oyente falló:', e);
        }
      }
    });
  }

  private marcarDisponible(motivo: string): void {
    if (this._disponible) return;
    this._disponible = true;
    this._motivo = motivo;
    console.log(`[Realtime] disponible (${motivo})`);
  }

  private marcarNoDisponible(motivo: string): void {
    if (!this._disponible && this._motivo === motivo) return;
    this._disponible = false;
    this._motivo = motivo;
    console.warn(
      `[Realtime] NO disponible: ${motivo}. ` +
      'La app seguirá con el sondeo periódico, así que no se rompe nada. ' +
      'Verificá en Supabase que la tabla esté en la publicación supabase_realtime.'
    );
  }

  private limpiarCanario(): void {
    if (this.temporizadorCanario) {
      clearTimeout(this.temporizadorCanario);
      this.temporizadorCanario = null;
    }
    this.canarioActivo = false;
  }
}

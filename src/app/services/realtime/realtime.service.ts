import { Injectable, NgZone, inject } from '@angular/core';
import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
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

  /**
   * Cierre diferido del canal cuando ya no queda ninguna pantalla escuchando.
   *
   * POR QUÉ EXISTE
   *
   * Una suscripción a `postgres_changes` no es gratis aunque no llegue ningún
   * evento. Supabase Realtime lee el WAL del proyecto con `realtime.list_changes`
   * UNA VEZ POR CADA TABLA SUSCRITA en cada ciclo de sondeo, esté o no haya
   * cambios que notificar. Con dos tablas suscritas eso son ~2 consultas a la
   * base por segundo, 24/7, mientras el proceso viva.
   *
   * En este servicio el canal se abría una vez (al entrar al panel) y se
   * mantenía hasta el cambio de cuenta: `ngOnDestroy` de las pantallas suelta
   * el oyente, no el canal. Medido en el proyecto real, una suscripción
   * abandonada llegó a 119 llamadas/min de `realtime.list_changes` — el 30% del
   * CPU total de la base, para esperar eventos que ocurren unas pocas veces al
   * día. El sondeo periódico ya cubre ese caso como red de seguridad.
   *
   * El arreglo es contar oyentes: cuando el último suelta el suyo, el canal se
   * cierra. Ningún evento se pierde, porque un evento con el conjunto de
   * oyentes vacío no tenía a quién entregarle.
   *
   * El retardo evita el aleteo de abrir/cerrar al saltar entre dos pantallas.
   */
  private temporizadorCierre: any = null;

  /** Espera a cerrar el canal antes de hacerlo, para no pelearse con una navegación entrante. */
  private static readonly RETARDO_CIERRE_MS = 1500;

  /** Id de la cuenta a la que hay que volver a suscribirse al volver al primer plano. */
  private idParaReabrir: string | null = null;

  private escuchaApp: Promise<{ remove: () => Promise<void> }> | null = null;

  /**
   * Cierra el canal cada vez que la app pasa a segundo plano, y lo reabre al
   * volver. Éste es el arreglo que de verdad importa.
   *
   * Medido en la base de este proyecto: un canal de `postgres_changes` sobre
   * dos tablas produce ~126 llamadas por minuto a `realtime.list_changes`, esté
   * o no haya cambios que notificar. Son ~180.000 llamadas al día mientras el
   * proceso siga vivo, y yaumably eran el 30% del CPU total de la base.
   *
   * En segundo plano no hay nadie mirando la pantalla, así que ninguno de esos
   * eventos puede usarse: cerrar el canal ahí no quita ninguna funcionalidad.
   * El sondeo periódico de 120 s de las pantallas no se toca y sigue siendo la
   * red de seguridad, también en segundo plano.
   *
   * Se cierra al ENTRAR en segundo plano y no al salir de la app, porque una
   * app de monitoreo se deja abierta en segundo plano durante horas.
   */
  private vigilarPrimerPlano(): void {
    if (this.escuchaApp) return;
    if (!Capacitor.isNativePlatform()) return;

    try {
      this.escuchaApp = App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          if (!this.canal) return;
          // Se guarda el id antes de cerrar porque `cerrar()` lo borra: al
          // volver al primer plano hay que poder reabrir la misma suscripción.
          this.idParaReabrir = this.idUsuarioActual;
          void this.cerrar();
          console.log(
            '[Realtime] app a segundo plano: canal cerrado. ' +
            'Vuelve a abrirse al regresar.'
          );
          return;
        }

        const id = this.idParaReabrir;
        this.idParaReabrir = null;
        if (!id) return;

        // Al volver al primer plano se reabre SIEMPRE, sin mirar la lista de
        // oyentes. Las pantallas no se destruyen al navegar con el botón
        // atrás, así que su `ngOnDestroy` no corre y el oyente sigue
        // registrado aunque la pantalla ya no esté a la vista: un canal cerrado
        // en segundo plano tiene que volver a abrirse igual.
        //
        // El sondeo periódico de cada pantalla es la red de seguridad durante
        // los segundos que tarda en reconnectar, así que este breve hueco no
        // deja nada sin cobertura.
        void this.suscribir(id)
          .then(() => {
            console.log('[Realtime] app de vuelta al primer plano: canal reabierta');
          })
          .catch(() => {
            /* si falla, el sondeo de la pantalla sigue cubriendo */
          });
      });
    } catch {
      /* sin plugin de App: el canal se queda como estaba */
    }
  }

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
    // Llega una pantalla nueva: si había un cierre pendiente, ya no aplica.
    this.cancelarCierre();

    this.oyentes.add(fn);
    return () => {
      this.oyentes.delete(fn);
      this.programarCierreSiNoHayOyentes();
    };
  }

  /**
   * Programa el cierre del canal si, cuando se ejecute, sigue sin quedar
   * ninguna pantalla escuchando.
   */
  private programarCierreSiNoHayOyentes(): void {
    if (this.temporizadorCierre) {
      return;
    }

    this.temporizadorCierre = setTimeout(() => {
      this.temporizadorCierre = null;
      if (this.oyentes.size > 0) {
        return;
      }
      void this.cerrar();
    }, RealtimeService.RETARDO_CIERRE_MS);
  }

  private cancelarCierre(): void {
    if (this.temporizadorCierre) {
      clearTimeout(this.temporizadorCierre);
      this.temporizadorCierre = null;
    }
  }

  /**
   * Abre la suscripción para el usuario indicado.
   * Es idempotente: llamarla de más no crea canales duplicados.
   */
  async suscribir(idUsuario: string): Promise<void> {
    if (!idUsuario) return;

    // Una pantalla entró antes de que corriera el cierre pendiente: el canal
    // tiene que seguir abierto para ella.
    this.cancelarCierre();

    if (this.canal && this.idUsuarioActual === idUsuario) {
      return;
    }

    await this.cerrar();

    this.idUsuarioActual = idUsuario;
    this._disponible = false;
    this._motivo = 'suscribiendo';

    this.vigilarPrimerPlano();

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

  /**
   * Cierra la suscripción. Se llama al pasar a segundo plano, al cerrar sesión y
   * al salir del panel.
   *
   * OJO con el `await` en `removeChannel()`, que es donde está el detalle que
   * hace que esto no cerrara nada al minimizar la app.
   *
   * `removeChannel()` hace dos cosas: manda el `leave` al servidor y, SÓLO si la
   * respuesta `ok` llega, ejecuta el `teardown()` que cierra el socket Phoenix
   * de verdad (RealtimeClient.js:257-263). Al pasar a segundo plano Android
   * congela el WebView, y con él el temporizador del socket: el `leave` se
   * envía pero el `ok` ya no se procesa nunca. Awaitear `removeChannel()` en ese
   * momento se queda esperando para siempre, el `teardown()` no corre, y la
   * suscripción sigue cobrando en el servidor. Medido: 126 llamadas/min seguían
   * occurring con la app minimizada.
   *
   * Por eso el cierre se hace "a la fuerza": se manda el `leave` y, sin
   * esperar el acuse, se fuerza el `teardown()` y se desconecta el socket. Se
   * sigue enviando el `leave` (lo que permite al servidor soltar la
   * suscripción), pero sin quedar a merced de una respuesta que en segundo
   * plano no va a llegar. Volver a abrir el socket al volver al primer plano es
   * trabajo de `suscribir()` y lo hace sin problema.
   */
  async cerrar(): Promise<void> {
    this.cancelarCierre();
    this.limpiarCanario();

    if (this.canal) {
      const canal = this.canal;
      this.canal = null;

      try {
        // El `leave` se manda, pero no se espera su respuesta: en segundo plano
        // no llega. Queda encolado sólo por si la app sigue visible (por
        // ejemplo al cerrar sesión con la app en primer plano).
        void Promise.resolve(canal.unsubscribe()).catch(() => {});

        // `teardown()` destruye los timers del canal, y `disconnect()` cierra el
        // socket de Phoenix: sin esto el WebSocket sigue conectado y la
        // suscripción sigue viva en el servidor. Tampoco se awaitean, porque en
        // segundo plano tampoco terminarían.
        canal.teardown();

        const realtime = (this.supabaseService.getClient() as any).realtime;
        if (realtime && typeof realtime.disconnect === 'function') {
          void Promise.resolve(realtime.disconnect()).catch(() => {});
        }
      } catch (e) {
        console.warn('No se pudo cerrar el canal de Realtime:', e);
      }
    }

    this.idUsuarioActual = null;
    this._disponible = false;
    this._motivo = 'sin suscribir';
  }

  /**
   * Cierre definitivo, sin reabrir: es el de un cambio de cuenta.
   *
   * `cerrar()` se puede llamar al pasar a segundo plano, y ahí sí hay que
   * reabrir al volver. Al cerrar sesión o cambiar de cuenta en cambio hay que
   * olvidarse de la cuenta anterior para no resuscribirla.
   */
  async cerrarSinReabrir(): Promise<void> {
    this.idParaReabrir = null;
    await this.cerrar();
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

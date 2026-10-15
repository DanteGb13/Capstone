import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Salud, type ResumenSalud } from './salud';
import { UbicacionForeground } from '../ubicacion-foreground/ubicacion-foreground';
import { PerfilCacheService } from '../../perfil-cache/perfil-cache.service';

/** Rol del adulto mayor en la tabla `rol` (el cuidador es 'Familiar'). */
const ROL_ADULTO_MAYOR = 'Usuario';

/**
 * Mantiene vivo el envío automático de los signos vitales.
 *
 * El adulto mayor no tiene que hacer nada: este servicio se encarga de
 * subirlos a Supabase cada 15 minutos y también cada vez que vuelve a abrir
 * la app, para que el cuidador no se quede con datos rancios si estuvo
 * mucho tiempo con el teléfono apagado.
 *
 * Se apoya en el servicio de ubicación en primer plano, que ya existe y que
 * el panel del adulto mayor mantiene encendido: no se agrega un segundo
 * servicio en segundo plano, que es lo que más batería gasta.
 */
@Injectable({
  providedIn: 'root'
})
export class SaludSyncService {

  private salud = inject(Salud);
  private perfilCache = inject(PerfilCacheService);

  private escucha: PluginListenerHandle | null = null;

  /**
   * Evita que dos sincronizaciones se pisen.
   *
   * El servicio nativo avisa cada 15 minutos y además la app sincroniza al
   * volver al primer plano. Si ambas caen cerca, sin este candado la segunda
   * leería Health Connect mientras la primera todavía lo está leyendo.
   */
  private sincronizando = false;

  /** Evita repetir el envío si la última vez fue hace segundos. */
  private ultimoEnvioMs = 0;

  private readonly MINIMO_ENTRE_ENVIOS_MS = 60 * 1000;

  private escuchandoApp = false;

  /** Cuándo se publicó el resumen por última vez; null si nunca se ha podido. */
  ultimaSyncMs: number | null = null;

  /** Último error legible, para poder explicarle al usuario qué falta. */
  ultimoProblema: string | null = null;

  /**
   * Lo último que se leyó de Health Connect, se haya publicado o no.
   *
   * Es la diferencia entre "el reloj no manda nada" y "la app no lo puede
   * guardar": las dos se ven igual en el panel del cuidador, pero sólo con
   * este dato se puede saber cuál de las dos es.
   */
  ultimoResumen: ResumenSalud | null = null;

  private iniciado = false;


  /**
   * Arranca la sincronización automática. Es idempotente: llamarlo de nuevo
   * no duplica la escucha.
   */
  async iniciar(): Promise<void> {
    if (this.iniciado || !Capacitor.isNativePlatform()) return;
    this.iniciado = true;

    // El servicio nativo pide la sincronización cada 15 minutos. Sin este
    // servicio en primer plano no hay avisos, y está bien: el resto de la
    // app sigue funcionando.
    try {
      this.escucha = await UbicacionForeground.addListener('saludSync', () => {
        void this.sincronizar();
      });
    } catch (e) {
      console.warn('[SaludSync] no se pudo escuchar el aviso nativo:', e);
    }

    this.escucharRegresoAlPrimerPlano();

    // Un envío al arrancar deja los datos frescos de inmediato en vez de
    // esperar al primer aviso del servicio.
    void this.sincronizar();
  }

  /**
   * Vuelve a sincronizar cuando la app pasa de segundo plano a primer plano.
   *
   * Es el caso más común: el adulto mayor deja el teléfono en un cajón y lo
   * vuelve a abrir horas después. Sin esto el cuidador vería el resumen de la
   * mañana hasta que se cumplieran los 15 minutos.
   */
  private escucharRegresoAlPrimerPlano(): void {
    if (this.escuchandoApp) return;
    this.escuchandoApp = true;

    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      void this.sincronizar();
    }).catch(() => {
      this.escuchandoApp = false;
    });
  }

  /**
   * Publica los datos de salud de este usuario en Supabase.
   *
   * Nunca lanza: un fallo aquí es esperable (sin internet, permiso revocado,
   * Health Connect vacío) y no debe romper la pantalla que la llamó.
   */
  async sincronizar(forzar = false): Promise<boolean> {
    if (this.sincronizando) return false;

    this.sincronizando = true;

    try {
      /*
       * El filtro por rol es una red de seguridad, no una puerta.
       *
       * `iniciar()` sólo se llama desde el panel del adulto mayor, así que en
       * la práctica el rol ya es el correcto. Pero `detectarRol()` puede
       * devolver null si el perfil todavía no cargó (arranque en frío), y
       * antes de arreglar esto eso hacía que la sincronización se saliera sin
       * dejar rastro ni un solo aviso: el cuidador veía "nunca ha enviado
       * datos" y no había forma de saber por qué.
       *
       * Por eso sólo se salta cuando el rol se conoce Y no es el del adulto
       * mayor. Si no se sabe, se intenta igual: subir de más no rompe nada,
       * pero no hacerlo sí.
       */
      const rol = await this.detectarRol();
      if (rol !== null && rol !== ROL_ADULTO_MAYOR) {
        this.ultimoProblema = null;
        return false;
      }

      const idUsuario = await this.perfilCache.idUsuario();
      if (!idUsuario) {
        this.ultimoProblema = 'No se pudo identificar al usuario.';
        return false;
      }

      /*
       * La subida es automática y no la empuja nadie: el aviso nativo cada 15
       * minutos, la vuelta al primer plano y el arranque. Antes esta función
       * consultaba además si el cuidador había pedido datos frescos, y eso
       * significaba un viaje extra a la base en cada revisión sin cambiar
       * nada. Se quitó junto con el botón que la alimentaba.
       */

      if (!forzar) {
        const desdeUltimo = Date.now() - this.ultimoEnvioMs;
        if (desdeUltimo < this.MINIMO_ENTRE_ENVIOS_MS) return false;
      }

      const resultado = await this.salud.reportarMiSalud(idUsuario);

      // Se guarda lo leído aunque no se haya publicado: así la pantalla del
      // adulto puede decir "hoy llevas 3.200 pasos" y demostrar que Health
      // Connect sí está llegando, en vez de dejar un "sin datos" que no
      // distingue entre el reloj y la app.
      this.ultimoResumen = resultado.resumen;

      if (resultado.subido) {
        this.ultimaSyncMs = Date.now();
        this.ultimoEnvioMs = Date.now();
        this.ultimoProblema = null;
      } else {
        this.ultimoProblema = resultado.problema;
      }

      return resultado.subido;
    } catch (e) {
      console.warn('[SaludSync] falló la sincronización:', e);
      this.ultimoProblema = 'No se pudieron enviar los datos de salud.';
      return false;
    } finally {
      this.sincronizando = false;
    }
  }

  /**
   * Rol del usuario actual, o null si todavía no se pudo leer.
   *
   * Va aparte del id porque el filtro por rol de `sincronizar()` sólo se
   * aplica cuando el rol se conoce: se prefiere subir de más antes que dejar
   * al adulto mayor sin sincronizar por un perfil que aún no cargó.
   */
  private async detectarRol(): Promise<string | null> {
    try {
      const perfil = await this.perfilCache.perfil();
      return perfil?.rol || null;
    } catch (e) {
      return null;
    }
  }

  /** Corta la escucha al cambiar de cuenta. */
  async detener(): Promise<void> {
    try {
      await this.escucha?.remove();
    } catch {
      // ignore
    }
    this.escucha = null;
    this.iniciado = false;
    this.ultimaSyncMs = null;
    this.ultimoResumen = null;
  }

}

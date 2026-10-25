import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Health, type HealthDataType } from '@capgo/capacitor-health';
import { SupabaseService } from '../../supabase/supabase';
import { PermisosExtra } from '../permisos-extra/permisos-extra';

/**
 * Datos que la app pide leer de Health Connect.
 *
 * La lista es corta a propósito: pedir menos permisos hace que el diálogo de
 * Health Connect sea más fácil de entender para un adulto mayor, y son las
 * cifras que de verdad le sirven a un cuidador.
 */
export const TIPOS_SALUD: HealthDataType[] = [
  'steps',
  'distance',
  'calories',
  'heartRate',
  'restingHeartRate',
  'oxygenSaturation',
  'respiratoryRate',
  'sleep'
];

/** Una fila de `signos_vitales`, tal como la devuelve Supabase. */
export interface SignosVitales {
  id_usuario: string;
  pasos: number | null;
  distancia_metros: number | null;
  calorias: number | null;
  fc_media: number | null;
  fc_minima: number | null;
  fc_maxima: number | null;
  fc_reposo: number | null;
  spo2: number | null;
  respiracion: number | null;
  sueno_minutos: number | null;
  /** Cuándo se midió el pulso mostrado. Sin esto, un dato viejo se ve actual. */
  fc_ultima_hora: string | null;
  spo2_ultima_hora: string | null;
  sueno_ultima_noche: string | null;
  fuente: string | null;
  dispositivo: string | null;
  fecha_actualizacion: string | null;
}

/**
 * Lo mismo, ya normalizado para pintar en pantalla.
 *
 * Los `null` de la base se convierten en `null` también acá a propósito: la
 * plantilla usa `null` para distinguir "no hay dato" de "el dato es cero".
 * Con un 0 falso, un reloj que nunca midió se vería idéntico a alguien que
 * no se movió en todo el día.
 */
export interface ResumenSalud extends Omit<SignosVitales, 'id_usuario'> {
  id_usuario: string;
  /** Minutos transcurridos desde la última subida; null si nunca ha reportado. */
  antiguedadMinutos: number | null;
}

export type DisponibilidadSalud =
  | { disponible: true; motivo: null }
  | { disponible: false; motivo: string };

/** Cómo terminó un intento de publicación. */
export interface ResultadoReporte {
  /** ¿Se logró escribir la fila en Supabase? */
  subido: boolean;
  /** Lo que se leyó de Health Connect, exista o no el permiso. */
  resumen: ResumenSalud | null;
  /** Por qué no se publicó, en palabras mostrables; null si sí se publicó. */
  problema: string | null;
}

/** Cuánto se mira hacia atrás en el diagnóstico. */
const DIAS_BUSQUEDA_DIAGNOSTICO = 30;

/** Una fila del diagnóstico: qué le pasó a un tipo de dato. */
export interface DiagnosticoDato {
  tipo: string;
  /** Estado del permiso para ese tipo. */
  permiso: 'concedido' | 'denegado' | 'desconocido';
  /** Cuántas muestras crudas hay en la ventana revisada. */
  muestras: number;
  /** Resumen legible de una línea. */
  detalle: string;
}

/**
 * Resultado del diagnóstico.
 *
 * Existe para responder una pregunta que ninguna otra función distingue:
 * ¿el problema es que el usuario no autorizó, que el reloj no escribió nada
 * en Health Connect, o que la app no supo leerlo? Las tres se ven igual desde
 * afuera ("sin datos") y cada una necesita una solución distinta, una de
 * ellas del usuario final.
 */
export interface DiagnosticoSalud {
  disponible: boolean;
  motivoNoDisponible: string | null;
  datos: DiagnosticoDato[];
  /** Fecha y hora en que se hizo el diagnóstico. */
  fecha: string;
}

@Injectable({
  providedIn: 'root'
})
export class Salud {

  private supabaseService = inject(SupabaseService);

  private supabase = this.supabaseService.getClient();


  // =====================================================
  // DISPONIBILIDAD Y PERMISOS
  // =====================================================

  /**
   * Si este teléfono puede leer datos de salud.
   *
   * Health Connect es exclusivo de Android 9+. En el navegador y en iPhone
   * no existe, y la app tiene que seguir funcionando igual: el resto del
   * cuidado (ubicación, SOS, alarmas) no depende de esto.
   */
  async disponibilidad(): Promise<DisponibilidadSalud> {
    if (!Capacitor.isNativePlatform()) {
      return { disponible: false, motivo: 'Sólo funciona en la app de Android.' };
    }

    if (Capacitor.getPlatform() !== 'android') {
      return { disponible: false, motivo: 'Health Connect no existe en iPhone.' };
    }

    try {
      const res = await Health.isAvailable();
      if (!res.available) {
        return {
          disponible: false,
          motivo: res.reason || 'Health Connect no está disponible en este teléfono.'
        };
      }
      return { disponible: true, motivo: null };
    } catch (e) {
      console.warn('No se pudo consultar la disponibilidad de Health Connect:', e);
      return { disponible: false, motivo: 'No se pudo verificar Health Connect.' };
    }
  }

  /** Abre la pantalla de Health Connect para que el usuario re Active el acceso. */
  async abrirAjustes(): Promise<void> {
    try {
      await Health.openHealthConnectSettings();
    } catch (e) {
      console.warn('No se pudieron abrir los ajustes de Health Connect:', e);
    }
  }

/**
   * Pide los permisos. Sólo hay que llamarlo una vez: después el estado se
   * consulta con `tienePermisos()`, que no vuelve a molestar al usuario.
   */
async solicitarPermisos(): Promise<{ autorizado: boolean; denegados: HealthDataType[] }> {
    const disp = await this.disponibilidad();
    if (!disp.disponible) {
      return { autorizado: false, denegados: [...TIPOS_SALUD] };
    }

    // El permiso de actividad va PRIMERO y aparte del diálogo de Health Connect.
    // Son dos cosas distintas: uno es un permiso normal de Android y el otro son
    // los permisos de Health Connect. Si sólo se abre el segundo, el usuario
    // autoriza los pasos en la pantalla de Google y los pasos siguen sin llegar,
    // porque el sistema nunca concedió ACTIVITY_RECOGNITION.
    await this.solicitarPermisoActividad();

    try {
      const estado = await Health.requestAuthorization({ read: TIPOS_SALUD, write: [] });
      return {
        autorizado: estado.readDenied.length === 0,
        denegados: estado.readDenied
      };
    } catch (e) {
      console.warn('No se pudieron pedir los permisos de salud:', e);
      return { autorizado: false, denegados: [...TIPOS_SALUD] };
    }
  }

  /**
   * Pide `ACTIVITY_RECOGNITION`, el permiso que desbloquea pasos y distancia.
   *
   * Va separado porque en Android 10+ cualquier dato derivado del sensor de
   * pasos lo exige, y el plugin de Health Connect no lo declara: lo declara la
   * app. Sin esto, los pasos y la distancia nunca llegan y no hay error visible
   * en ninguna parte.
   *
   * Un fallo aquí no se propaga: si el permiso no se puede pedir (teléfono
   * viejo, navegador), la app sigue funcionando con el resto de los datos.
   */
  private async solicitarPermisoActividad(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    try {
      const { concedido } = await PermisosExtra.solicitarActividad();
      return !!concedido;
    } catch (e) {
      console.warn('No se pudo pedir el permiso de actividad física:', e);
      return false;
    }
  }

  /**
   * Si el teléfono puede leer pasos.
   *
   * Se consulta aparte de los permisos de Health Connect porque son
   * independientes: el usuario puede haber autorizado los pasos en Health
   * Connect y que Android nunca haya concedido la actividad. En ese caso
   * `tienePermisos()` da true y los pasos igual llegan vacíos, que es
   * exactamente la falla que_costó entender.
   */
  async tienePermisoActividad(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    try {
      const { concedido } = await PermisosExtra.verificarActividad();
      return !!concedido;
    } catch (e) {
      console.warn('No se pudo verificar el permiso de actividad física:', e);
      return false;
    }
  }

  /**
   * Si ya están los permisos, sin mostrar ningún diálogo.
   *
   * Basta con un tipo concedido para que el servicio vale: puede que el
   * usuario haya aceptado los pasos y rechazado el sueño, y en ese caso
   * todavía hay pantalla que mostrar.
   */
  async tienePermisos(): Promise<boolean> {
    const disp = await this.disponibilidad();
    if (!disp.disponible) return false;

    try {
      const estado = await Health.checkAuthorization({ read: TIPOS_SALUD, write: [] });
      return estado.readAuthorized.length > 0;
    } catch (e) {
      console.warn('No se pudo verificar el permiso de salud:', e);
      return false;
    }
  }


  /**
   * Qué tipos de dato nos faltan por autorizar.
   *
   * `tienePermisos()` responde "¿hay alguno concedido?" y con eso basta para
   * decidir si vale la pena leer. Pero no sirve para saber si el corazón, el
   * sueño o el oxígeno van a volver algo.
   *
   * El problema real: si el usuario acepta los pasos y rechaza el resto, la
   * app lo trata como autorizado completo, consulta, Health Connect le
   * devuelve vacío y la pantalla muestra guiones sin explicar que lo que falta
   * es un permiso. Es el peor tipo de fallo, porque parece que el reloj no
   * manda nada cuando en realidad la app ni siquiera puede mirar.
   */
  async tiposSinPermiso(): Promise<HealthDataType[]> {
    const disp = await this.disponibilidad();
    if (!disp.disponible) return [];

    // Si falta el permiso de actividad, se agrega a la lista de faltantes
    // aunque Health Connect diga que "steps" está autorizado. Así el panel
    // puede decir "Falta autorizar: los pasos" en vez de quedarse mudo
    // esperando datos que no van a llegar nunca.
    const faltaActividad = !(await this.tienePermisoActividad());

    try {
      const estado = await Health.checkAuthorization({ read: TIPOS_SALUD, write: [] });
      const denegados = new Set<string>(estado.readDenied as string[]);

      if (faltaActividad) {
        // Sólo tiene sentido señalarlo cuando el usuario decidió leer pasos.
        denegados.add('steps');
        denegados.add('distance');
      }

      return TIPOS_SALUD.filter((t) => denegados.has(t));
    } catch (e) {
      console.warn('No se pudo revisar los permisos por tipo:', e);
      return [];
    }
  }

  /** Traduce las claves internas a palabras que se puedan mostrar. */
  traducirTipo(tipo: HealthDataType): string {
    const nombres: Partial<Record<HealthDataType, string>> = {
      steps: 'los pasos',
      distance: 'la distancia',
      calories: 'las calorías',
      heartRate: 'las pulsaciones',
      restingHeartRate: 'la frecuencia en reposo',
      oxygenSaturation: 'el oxígeno',
      respiratoryRate: 'la respiración',
      sleep: 'el sueño'
    };
    return nombres[tipo] || tipo;
  }


  // =====================================================
  // LECTURA DE HEALTH CONNECT
  // =====================================================

  /**
   * Resumen de salud de HOY, leído del teléfono.
   *
   * Cada métrica va en su propio try/catch a propósito: si el usuario
   * denegó el sueño, se pierde el sueño y se muestra el resto de la
   * pantalla. Si una sola lectura fallara, el cuidador vería un "sin datos"
   * en lugar de las cifras que sí están disponibles.
   */
  async leerResumen(): Promise<ResumenSalud> {
    const ahora = new Date();
    const inicioHoy = new Date(ahora);
    inicioHoy.setHours(0, 0, 0, 0);

    const desdeAyer = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);

    /*
     * El pulso se busca en 30 días, no en el día.
     *
     * La app del reloj con este modelo no escribe la frecuencia cardíaca de
     * forma continua: guarda lo que alguien mide a mano. En la práctica puede
     * pasar semanas sin que haya ninguna lectura nueva, así que pedir sólo el
     * día corriente daba siempre cero y el cuidador veía un guion donde en
     * realidad había un dato, sólo que viejo.
     *
     * 30 días es el máximo que Health Connect deja leer sin el permiso
     * `READ_HEALTH_DATA_HISTORY`; más atrás la plataforma oculta los registros.
     */

    const hace30dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);

    const iso = (d: Date) => d.toISOString();

    const vacio: ResumenSalud = {
      id_usuario: '',
      pasos: null,
      distancia_metros: null,
      calorias: null,
      fc_media: null,
      fc_minima: null,
      fc_maxima: null,
      fc_reposo: null,
      spo2: null,
      respiracion: null,
      sueno_minutos: null,
      fc_ultima_hora: null,
      spo2_ultima_hora: null,
      sueno_ultima_noche: null,
      fuente: null,
      dispositivo: null,
      fecha_actualizacion: null,
      antiguedadMinutos: null
    };

    // Los contadores del día se suman; si se usara 'max' sobre deltas de
    // Health Connect se obtendría el último tramo y no el total.
    const [pasos, distancia, calorias, fc, fcReposo, spo2, spo2Hora, respiracion, sueno, suenoFecha] =
      await Promise.all([
        this.acumularDelDia('steps', iso(inicioHoy), iso(ahora), 'sum'),
        this.acumularDelDia('distance', iso(inicioHoy), iso(ahora), 'sum'),
        this.acumularDelDia('calories', iso(inicioHoy), iso(ahora), 'sum'),
        this.agregarCorazonDia(iso(hace30dias), iso(ahora)),
        this.agregar('restingHeartRate', iso(hace30dias), iso(ahora), 'average'),
        this.ultimaMuestra('oxygenSaturation', iso(desdeAyer), iso(ahora)),
        this.horaUltimaMuestra('oxygenSaturation', iso(desdeAyer), iso(ahora)),
        this.promedioMuestras('respiratoryRate', iso(desdeAyer), iso(ahora)),
        // El sueño se busca en 30 días y se toma la sesión más reciente. La
        // ventana anterior arrancaba a las 20:00 de ayer y eso descartaba
        // cualquier sesión que terminara de día.
        this.suenoDeNoche(iso(hace30dias), iso(ahora)),
        this.horaUltimaMuestra('sleep', iso(hace30dias), iso(ahora))
      ]);

    const origen = await this.detectarFuente(iso(desdeAyer), iso(ahora));

    return {
      ...vacio,
      pasos: pasos === null ? null : Math.round(pasos),
      distancia_metros: distancia === null ? null : Math.round(distancia),
      calorias: calorias === null ? null : Math.round(calorias),
      fc_media: fc.media === null ? null : Math.round(fc.media),
      fc_minima: fc.minima === null ? null : Math.round(fc.minima),
      fc_maxima: fc.maxima === null ? null : Math.round(fc.maxima),
      fc_reposo: fcReposo === null ? null : Math.round(fcReposo),
      spo2: spo2 === null ? null : Math.round(spo2),
      respiracion: respiracion === null ? null : Math.round(respiracion),
      sueno_minutos: sueno === null ? null : Math.round(sueno),
      fc_ultima_hora: fc.ultimaHora,
      spo2_ultima_hora: spo2Hora,
      sueno_ultima_noche: suenoFecha,
      fuente: origen.fuente,
      dispositivo: origen.dispositivo,
      fecha_actualizacion: ahora.toISOString()
    };
  }

  /** Total del día para un contador (pasos, distancia, calorias). */
  private async acumularDelDia(
    dataType: HealthDataType,
    startDate: string,
    endDate: string,
    aggregation: 'sum'
  ): Promise<number | null> {
    try {
      const { samples } = await Health.queryAggregated({
        dataType,
        startDate,
        endDate,
        bucket: 'day',
        aggregation
      });

      if (!samples?.length) {
        console.log(
          `[Salud] '${dataType}': sin registros de HOY. O el reloj no se uso, ` +
          'o la app del fabricante no ha sincronizado. No se inventa un 0.'
        );
        return null;
      }

      // Con bucket 'day' y un rango que empieza hoy debería haber un solo
      // cubo, pero se suman todos por si el rango cruzara la medianoche.
      const total = samples.reduce((suma, s) => suma + (s.values?.sum ?? s.value ?? 0), 0);
      return total > 0 ? total : null;
    } catch (e) {
      console.warn(`No se pudo leer '${dataType}':`, e);
      return null;
    }
  }

  /** Promedio/min/máximo de la frecuencia cardiaca del día, en una sola consulta. */
  /**
   * Mensaje legible de una excepción.
   *
   * `catch` entrega `unknown` y el error del plugin no siempre trae
   * `message` como propiedad tipada. Sin esto, el log que sirve para
   * diagnosticar quedaba justo en la parte que daba error de compilación.
   */
  private mensajeError(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (e && typeof e === 'object' && 'message' in e) {
      return String((e as { message: unknown }).message);
    }
    return String(e);
  }

  /**
   * Fecha de la lectura más reciente de un tipo dentro de la ventana.
   *
   * Va aparte del valor porque son cosas distintas: "99 %" y "medido hace tres
   * días" no es lo mismo que "99 %" y "medido hace un minuto", y para un
   * cuidador esa segunda parte es la que dice si el dato sirve.
   */
  private async horaUltimaMuestra(
    dataType: HealthDataType,
    startDate: string,
    endDate: string
  ): Promise<string | null> {
    try {
      const { samples } = await Health.readSamples({
        dataType,
        startDate,
        endDate,
        limit: 200
      });

      if (!samples?.length) return null;
      return this.masReciente(samples)?.startDate || null;
    } catch {
      return null;
    }
  }

  /**
   * Promedio/min/máximo de la frecuencia cardiaca.
   *
   * Se intenta primero la agregación nativa y, si no devuelve nada, se calcula
   * con las lecturas crudas. Ese segundo camino no es un adorno: la
   * agregación de Heart Connect agrupa intervalos de medición, y hay casos en
   * que devuelve vacío aunque las lecturas existan. Con un solo camino, un
   * vacío de la API se veía en pantalla como "promedio, mínima y máxima sin
   * dato" y era imposible distinguir si faltaba el dato o lo perdíamos
   * nosotros.
   */
  private async agregarCorazonDia(
    startDate: string,
    endDate: string
  ): Promise<{
    media: number | null;
    minima: number | null;
    maxima: number | null;
    ultimaHora: string | null;
  }> {

    const vacio = { media: null, minima: null, maxima: null, ultimaHora: null };

    try {
      const { samples } = await Health.queryAggregated({
        dataType: 'heartRate',
        startDate,
        endDate,
        bucket: 'day',
        aggregation: ['average', 'min', 'max']
      });

      const ultimoConDatos = [...(samples || [])]
        .filter((sample) => {
          const valores = sample.values || {};
          return [valores.average, valores.min, valores.max].some((valor) => {
            const numero = Number(valor);
            return Number.isFinite(numero) && numero > 0 && numero < 255;
          });
        })
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];

      if (ultimoConDatos) {
        const valores = ultimoConDatos.values || {};
        const lecturaValida = (valor: unknown): number | null => {
          const numero = Number(valor);
          return Number.isFinite(numero) && numero > 0 && numero < 255 ? numero : null;
        };
        const agregado = {
          media: lecturaValida(valores.average),
          minima: lecturaValida(valores.min),
          maxima: lecturaValida(valores.max),
          ultimaHora: null as string | null
        };

        if (agregado.media !== null || agregado.minima !== null || agregado.maxima !== null) {
          // El fin de un bucket diario no representa la hora de la última
          // medición; se usa la marca de tiempo de una muestra real.
          const lecturas = await this.calcularDesdeMuestras('heartRate', startDate, endDate);
          return { ...agregado, ultimaHora: lecturas?.ultimaHora ?? null };
        }
      }

      console.log(
        '[Salud] FC: la agregación no devolvió pulsaciones válidas; se calcula con las lecturas crudas'
      );
    } catch (e) {
      console.warn(
        '[Salud] FC: falló la agregación, se intenta con lecturas crudas:',
        this.mensajeError(e)
      );
    }

    const desdeMuestras = await this.calcularDesdeMuestras('heartRate', startDate, endDate);

    if (!desdeMuestras) {
      console.log(
        '[Salud] FC: sin lecturas de corazón en los últimos 30 días. ' +
        'Si el reloj mide, la app del fabricante tiene que escribirlas en Health Connect.'
      );
      return vacio;
    }

    console.log('[Salud] FC calculada desde lecturas crudas:', desdeMuestras);
    return { ...desdeMuestras, ultimaHora: desdeMuestras.ultimaHora };
  }


  /**
   * Promedio/mín/máximo a partir de las lecturas crudas, en JavaScript.
   *
   * Es el plan B de `agregarCorazonDia` y de la FC en reposo.
   */
  private async calcularDesdeMuestras(
    dataType: HealthDataType,
    startDate: string,
    endDate: string
  ): Promise<{
    media: number | null;
    minima: number | null;
    maxima: number | null;
    ultimaHora: string | null;
  } | null> {

    try {
      const { samples } = await Health.readSamples({
        dataType,
        startDate,
        endDate,
        limit: 500,
        ascending: false
      });

      // Con orden descendente la primera muestra es la más reciente, que es la
      // que sirve para saber cuándo se midió por última vez.
      const ordenada = [...(samples || [])].sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
      );
      // Se descartan los valores imposibles: Health Connect usa 255 como
      // "sin lectura" y deja ceros cuando el sensor está apagado. Un latido de
      // 255 no existe, y sin filtrarlo contaminaría el promedio hacia arriba.
      const util = ordenada.filter(
        (s) => Number.isFinite(Number(s.value)) && Number(s.value) > 0 && Number(s.value) < 255
      );

      if (util.length === 0) return null;

      let suma = 0;
      let minimo = util[0].value;
      let maximo = util[0].value;

      for (const s of util) {
        const v = Number(s.value);
        suma += v;
        if (v < minimo) minimo = v;
        if (v > maximo) maximo = v;
      }

      return {
        media: suma / util.length,
        minima: minimo,
        maxima: maximo,
        ultimaHora: util[0]?.startDate || null
      };
    } catch (e) {
      console.warn(`[Salud] no se pudieron leer muestras de '${dataType}':`, this.mensajeError(e));
      return null;
    }
  }

  /** Un único valor agregado del día (FC en reposo). */
  private async agregar(
    dataType: HealthDataType,
    startDate: string,
    endDate: string,
    aggregation: 'average' | 'sum'
  ): Promise<number | null> {
    try {
      const { samples } = await Health.queryAggregated({
        dataType,
        startDate,
        endDate,
        bucket: 'day',
        aggregation
      });

      if (samples?.length) {
        const ultimo = samples[samples.length - 1];
        const valor = ultimo.values?.[aggregation] ?? ultimo.value ?? null;
        if (valor !== null && Number.isFinite(valor)) return valor;
      }

      console.log(
        `[Salud] '${dataType}': la agregación no devolvió nada; se calcula con las lecturas crudas`
      );
    } catch (e) {
      console.warn(
        `[Salud] '${dataType}': falló la agregación, se intenta con lecturas crudas:`,
        this.mensajeError(e)
      );
    }

    // Mismo plan B que el corazón: si la agregación no devuelve nada, se
    // promedian las lecturas crudas. Sin esto, "FC en reposo" dependía de una
    // sola llamada y se perdía en silencio igual que las otras.
    const desdeMuestras = await this.calcularDesdeMuestras(dataType, startDate, endDate);

    if (!desdeMuestras) {
      console.log(`[Salud] '${dataType}': 0 lecturas en Health Connect.`);
      return null;
    }

    return desdeMuestras.media;
  }

  /**
   * Última lectura de un tipo que no admite agregación.
   *
   * SpO2 y frecuencia respiratoria no se pueden agrupar con `queryAggregated`
   * en Health Connect, así que se leen muestra por muestra.
   *
   * Se ordenan por fecha antes de tomar la primera porque Health Connect no
   * trae los registros ordenados: sin esto, la "última" lectura era en
   * realidad la más antigua del rango.
   */
  private async ultimaMuestra(
    dataType: HealthDataType,
    startDate: string,
    endDate: string
  ): Promise<number | null> {
    try {
      const { samples } = await Health.readSamples({
        dataType,
        startDate,
        endDate,
        limit: 200
      });

      if (!samples?.length) return null;
      return this.masReciente(samples).value;
    } catch (e) {
      console.warn(`No se pudo leer la última muestra de '${dataType}':`, e);
      return null;
    }
  }

  /** La muestra más reciente por fecha de inicio. */
  private masReciente(samples: any[]): any {
    return [...samples].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    )[0];
  }

  /** Promedio de las últimas muestras de un tipo sin agregación. */
  private async promedioMuestras(
    dataType: HealthDataType,
    startDate: string,
    endDate: string
  ): Promise<number | null> {
    try {
      const { samples } = await Health.readSamples({
        dataType,
        startDate,
        endDate,
        limit: 50,
        ascending: false
      });

      if (!samples?.length) return null;

      const valores = samples.map((s) => s.value).filter((v) => Number.isFinite(v) && v > 0);
      if (valores.length === 0) return null;

      return valores.reduce((a, b) => a + b, 0) / valores.length;
    } catch (e) {
      console.warn(`No se pudo promediar '${dataType}':`, e);
      return null;
    }
  }

  /**
   * Minutos de sueño de la última noche.
   *
   * Dos cosas que esta función hizo mal y costaron un rato de depuración:
   *
   * 1. Filtraba por `sleepState`, y el plugin nunca setea ese campo: emite una
   *    sola muestra por sesión con la duración total. Todas las muestras se
   *    descartaban y el sueño salía vacío aunque estuviera ahí.
   *
   * 2. Buscaba sólo desde las 20:00 de ayer. Eso asume que la gente duerme de
   *    noche, y es falso: el registro del teléfono va de 07:13 a 13:57, así que
   *    terminaba a media mañana y quedaba fuera de la ventana por completo.
   *    Ahora se busca en todo el rango y se toma la sesión más reciente, que
   *    da igual a qué hora se duerma.
   *
   * Cuando el plugin trae `stages` se usan en vez de la duración total, para
   * no contar los minutos en que la persona estuvo despierta en la cama. En el
   * registro de ejemplo son 3 minutos de 404, pero en una noche normal puede
   * ser la diferencia entre 5 y 7 horas.
   */
  private async suenoDeNoche(startDate: string, endDate: string): Promise<number | null> {
    try {
      const { samples } = await Health.readSamples({
        dataType: 'sleep',
        startDate,
        endDate,
        // Alto a propósito: Health Connect no ordena, y con un límite chico se
        // reciben los registros más antiguos en vez de los últimos.
        limit: 500
      });

      if (!samples?.length) return null;

      /*
       * Health Connect NO ordena: sin `ORDER BY` devuelve los registros en
       * orden de inserción, que acá resultó ser el más antiguo primero. Por eso
       * con un límite chico se recibían las 20 sesiones MÁS VIEJAS del rango y
       * la app se quedaba durmiendo con datos de hace días.
       *
       * Se piden muchas y se ordena aquí. Con `limit` alto entra la ventana
       * entera y el orden deja de importar.
       */
      const sesiones = [...samples].sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
      );

      const sesion = sesiones[0];
      const minutos = this.minutosDeSueno(sesion);

      console.log('[Salud] sueño: ' + JSON.stringify({
        sesiones: sesiones.length,
        elegida: sesion.startDate,
        minutos: minutos === null ? null : Math.round(minutos),
        conEtapas: Array.isArray(sesion.stages) && sesion.stages.length > 0
      }));

      return minutos;
    } catch (e) {
      console.warn('No se pudo leer el sueño:', e);
      return null;
    }
  }

  /**
   * Minutos realmente dormidos de una sesión.
   *
   * Con `stages` se suman sólo las etapas de sueño. Sin ellas se usa la
   * duración total, porque es el único dato disponible.
   */
  private minutosDeSueno(sesion: any): number | null {
    const etapas: any[] = Array.isArray(sesion?.stages) ? sesion.stages : [];
    const deSueno = ['asleep', 'deep', 'light', 'rem'];

    if (etapas.length > 0) {
      const minutos = etapas
        .filter((e) => deSueno.includes(e?.stage))
        .reduce((suma, e) => suma + (Number(e?.durationMinutes) || 0), 0);

      if (minutos > 0) return minutos;
    }

    if (Number.isFinite(sesion?.value) && sesion.value > 0) {
      return sesion.value;
    }

    const desde = new Date(sesion?.startDate).getTime();
    const hasta = new Date(sesion?.endDate).getTime();
    if (Number.isFinite(desde) && Number.isFinite(hasta) && hasta > desde) {
      return (hasta - desde) / 60000;
    }

    return null;
  }

  /**
   * De qué dispositivo vienen los datos.
   *
   * Health Connect guarda en la misma bolsa los registros del reloj y los del
   * propio teléfono (por ejemplo, los pasos que cuenta el móvil en el bolsillo).
   * Sin esto el cuidador vería "3.200 pasos" sin saber si venían de la muñeca
   * o del bolsillo, que no es lo mismo cuando la persona no se pone la
   * pulsera.
   *
   * Se prueban varios tipos y no sólo el corazón porque este reloj no escribe
   * pulsaciones en Health Connect. Buscando sólo ahí, la fuente salía en null
   * y el cuidador veía los datos sin saber de dónde venían.
   */
  private async detectarFuente(
    startDate: string,
    endDate: string
  ): Promise<{ fuente: string | null; dispositivo: string | null }> {

    for (const tipo of ['heartRate', 'oxygenSaturation', 'sleep', 'steps', 'calories'] as HealthDataType[]) {
      try {
        const { samples } = await Health.readSamples({
          dataType: tipo,
          startDate,
          endDate,
          limit: 20,
          ascending: false
        });

        if (!samples?.length) continue;

        const conDispositivo = samples.find((s) => s.deviceType);
        const base = conDispositivo || samples[0];

        return {
          fuente: base?.sourceName ?? null,
          dispositivo: base?.deviceType ?? null
        };
      } catch {
        // Se prueba el siguiente tipo: que uno falle no debe dejar la fuente
        // en blanco si otro tipo sí dice de dónde vienen los datos.
      }
    }

    return { fuente: null, dispositivo: null };
  }


  // =====================================================
  // SUBIR AL ADULTO MAYOR (SU PROPIO TELÉFONO)
  // =====================================================

  /**
   * Lee Health Connect y publica el resumen en Supabase para que lo lean sus
   * cuidadores.
   *
   * Devuelve el detalle del intento en vez de un simple booleano porque los
   * tres finales posibles se distinguen desde afuera y el usuario necesita
   * saber cuál fue:
   *
   *  - sin permiso        -> hay que abrir el diálogo de Health Connect
   *  - sin datos en HC    -> el reloj todavía no escribió nada ahí
   *  - error al guardar   -> la app está rota, no el reloj
   *
   * La última se ignoraba con un simple `return false` y sólo quedaba un
   * `console.warn`, que nadie ve. Así un desajuste entre el código y la tabla
   * (una columna que no existe, por ejemplo) hacía que el cuidador viera
   * "nunca ha enviado datos" sin ninguna pista de por qué.
   */
  async reportarMiSalud(idUsuario: string): Promise<ResultadoReporte> {
    if (!idUsuario) {
      return { subido: false, resumen: null, problema: 'No se pudo identificar al usuario.' };
    }

    const conPermisos = await this.tienePermisos();
    if (!conPermisos) {
      return {
        subido: false,
        resumen: null,
        problema: 'Falta autorizar a SiempreCerca para leer los datos de tu reloj.'
      };
    }

    try {
      const resumen = await this.leerResumen();

      /*
       * Se revisa el permiso ANTES de juzgar que no hay datos.
       *
       * El orden importa: si el usuario aceptó los pasos pero rechazó el
       * corazón, la lectura devuelve pasos y `null` en todo lo demás. Sin
       * este chequeo, la app concluía "el reloj todavía no ha enviado datos"
       * y le echaba la culpa al reloj, cuando lo que faltaba era un permiso
       * que la propia app nunca le pidió volver a marcar.
       */
      const sinPermiso = await this.tiposSinPermiso();

      // "No hay nada" ahora significa que ningún campo trae valor. Antes la
      // comprobación miraba dos campos y descartaba la sincronización entera
      // cuando esos dos venían vacíos, aunque hubiera sueño u oxígeno listos
      // para publicar.
      if (sinPermiso.length > 0 && this.estaVacio(resumen)) {
        const faltan = sinPermiso.map((t) => this.traducirTipo(t)).join(', ');
        return {
          subido: false,
          resumen,
          problema: `Falta autorizar el acceso a: ${faltan}. Toca el reloj para activarlo.`
        };
      }

      if (this.estaVacio(resumen)) {
        // Health Connect respondió bien pero no hay nada. Casi siempre es que
        // la app del reloj todavía no vuelca sus datos a Health Connect. Se
        // sale sin tocar la base para no dejar una fila toda en null que el
        // cuidador interpretaría como "está todo mal".
        return {
          subido: false,
          resumen,
          problema: 'El reloj todavía no ha enviado datos. Abre su app y sincroniza.'
        };
      }

      const { error } = await this.supabase
        .from('signos_vitales')
        .upsert({
          id_usuario: idUsuario,
          pasos: resumen.pasos,
          distancia_metros: resumen.distancia_metros,
          calorias: resumen.calorias,
          fc_media: resumen.fc_media,
          fc_minima: resumen.fc_minima,
          fc_maxima: resumen.fc_maxima,
          fc_reposo: resumen.fc_reposo,
          spo2: resumen.spo2,
          respiracion: resumen.respiracion,
          sueno_minutos: resumen.sueno_minutos,
          fc_ultima_hora: resumen.fc_ultima_hora,
          spo2_ultima_hora: resumen.spo2_ultima_hora,
          sueno_ultima_noche: resumen.sueno_ultima_noche,
          fuente: resumen.fuente,
          dispositivo: resumen.dispositivo,
          fecha_actualizacion: resumen.fecha_actualizacion
        }, { onConflict: 'id_usuario' });

      if (error) {
        // El mensaje de Postgres va tal cual a la consola porque normalmente
        // es la única forma de saber qué columna o policy se está chocando.
        console.warn('[Salud] no se pudo guardar el resumen:', error.message);
        return {
          subido: false,
          resumen,
          problema: 'No se pudieron guardar los datos. Revisa la consola.'
        };
      }

      // Como texto y no como objeto: el puente de consola de Capacitor
      // convierte los objetos en "[object Object]" al llegar a logcat, que es
      // justo donde uno mira cuando hay que averiguar qué se está guardando.
      console.log('[Salud] resumen publicado: ' + JSON.stringify({
        pasos: resumen.pasos,
        calorias: resumen.calorias,
        fc_media: resumen.fc_media,
        spo2: resumen.spo2,
        sueno_minutos: resumen.sueno_minutos,
        fc_ultima_hora: resumen.fc_ultima_hora,
        sueno_ultima_noche: resumen.sueno_ultima_noche,
        fuente: resumen.fuente,
        dispositivo: resumen.dispositivo
      }));
      return { subido: true, resumen, problema: null };
    } catch (e) {
      console.warn('[Salud] falló la sincronización:', e);
      return { subido: false, resumen: null, problema: 'Falló la sincronización.' };
    }
  }

  /**
   * Si el resumen no trae absolutamente nada publicable.
   *
   * Antes miraba sólo `pasos` y `fc_media`, y con eso se descartaba la
   * sincronización completa. Pasó de verdad: el reloj llevaba 20 días sin
   * registrar pasos y no hay frecuencia cardíaca en Health Connect, pero sí
   * había un sueño de 404 minutos y oxígeno al 99 %. Los dos campos que se
   * miraban venían en null, la app concluía "el reloj no ha enviado nada" y
   * **no publicaba nada**, con lo que el cuidador veía una pantalla vacía
   * mientras el teléfono sí tenía datos.
   *
   * Ahora se mira todo. Con un solo dato alcanza para publicar: el resto se
   * guarda en null y la pantalla muestra guion donde corresponda.
   */
  private estaVacio(resumen: ResumenSalud): boolean {
    return [
      resumen.pasos,
      resumen.distancia_metros,
      resumen.calorias,
      resumen.fc_media,
      resumen.fc_reposo,
      resumen.spo2,
      resumen.respiracion,
      resumen.sueno_minutos
    ].every((v) => v === null || v === undefined);
  }


  // =====================================================
  // LEER DESDE EL CUIDADOR
  // =====================================================

  /**
   * Estado de salud de las personas a cargo.
   *
   * Se consulta por `in` en un solo viaje: el panel del cuidador tiene varias
   * personas y pedir una fila por persona multiplicaba los viajes a la base
   * por el mismo pantallazo.
   */
  async obtenerSaludVinculados(idsUsuario: string[]): Promise<Map<string, ResumenSalud>> {
    const resultado = new Map<string, ResumenSalud>();

    const ids = (idsUsuario || []).filter(Boolean);
    if (ids.length === 0) return resultado;

    try {
      const { data, error } = await this.supabase
        .from('signos_vitales')
        .select('*')
        .in('id_usuario', ids);

      if (error) {
        console.warn('[Salud] no se pudieron leer los datos de los vinculados:', error.message);
        return resultado;
      }

      const ahora = Date.now();

      for (const fila of data || []) {
        const fecha = fila.fecha_actualizacion ? new Date(fila.fecha_actualizacion).getTime() : NaN;
        resultado.set(fila.id_usuario, {
          ...fila,
          antiguedadMinutos: Number.isFinite(fecha)
            ? Math.max(0, Math.round((ahora - fecha) / 60000))
            : null
        });
      }
    } catch (e) {
      console.warn('[Salud] error leyendo datos de los vinculados:', e);
    }

    return resultado;
  }


  // =====================================================
  // DIAGNÓSTICO
  // =====================================================

  /**
   * Revisa tipo por tipo qué hay realmente en Health Connect.
   *
   * Usa `readSamples` y NO `queryAggregated` a propósito: la agregación
   * devuelve cero muestras tanto si no hay datos como si la consulta está mal,
   * y justamente lo que hay que descartar es la segunda posibilidad. Contar
   * muestras crudas sí separa los dos casos.
   *
   * Con esto se distinguen las tres fallas que se ven iguales desde afuera:
   *
   *   permiso denegado        -> el usuario tiene que autorizar
   *   permiso ok, 0 muestras  -> el reloj no escribe en Health Connect
   *   permiso ok, muestras>0  -> el problema es de la app, no del reloj
   */
  async diagnosticar(): Promise<DiagnosticoSalud> {
    const fecha = new Date().toISOString();
    const datos: DiagnosticoDato[] = [];

    const disp = await this.disponibilidad();
    if (!disp.disponible) {
      return { disponible: false, motivoNoDisponible: disp.motivo, datos, fecha };
    }

    // El estado de permisos se consulta una sola vez para todos los tipos.
    let concedidos = new Set<string>();
    try {
      const estado = await Health.checkAuthorization({ read: TIPOS_SALUD, write: [] });
      concedidos = new Set(estado.readAuthorized as string[]);
    } catch (e) {
      console.warn('[Salud] no se pudo verificar los permisos por tipo:', e);
    }

    /*
     * Ventana de 30 días, no de 24 horas.
     *
     * Con 24 h el diagnóstico contaba cero registros de frecuencia cardíaca y
     * eso se leía como "el reloj no manda el corazón". La realidad es otra:
     * Mi Fitness sí lo escribe, pero sólo cuando alguien se toma una medición
     * manual, y puede que la última sea de hace semanas. Contar 30 días
     * muestra lo que realmente hay.
     *
     * 30 días es además el tope que Health Connect permite leer sin el
     * permiso `READ_HEALTH_DATA_HISTORY`: más atrás la plataforma oculta los
     * registros por diseño.
     */
    const fin = new Date();
    const inicio = new Date(fin.getTime() - DIAS_BUSQUEDA_DIAGNOSTICO * 24 * 60 * 60 * 1000);
    const desde = inicio.toISOString();
    const hasta = fin.toISOString();

    for (const tipo of TIPOS_SALUD) {
      const permiso: DiagnosticoDato['permiso'] = concedidos.size === 0
        ? 'desconocido'
        : (concedidos.has(tipo) ? 'concedido' : 'denegado');

      if (permiso === 'denegado') {
        datos.push({ tipo, permiso, muestras: 0, detalle: 'Permiso no concedido' });
        continue;
      }

      try {
        const { samples } = await Health.readSamples({
          dataType: tipo,
          startDate: desde,
          endDate: hasta,
          limit: 200
        });

        const n = samples?.length || 0;
        datos.push({
          tipo,
          permiso,
          muestras: n,
          detalle: n === 0 ? 'Sin registros en 24 h' : this.resumirMuestras(tipo, samples!)
        });
      } catch (e: any) {
        datos.push({
          tipo,
          permiso,
          muestras: 0,
          detalle: `Error al leer: ${this.mensajeError(e) || 'desconocido'}`
        });
      }
    }

    console.log('[Salud] diagnóstico:', datos);

    return { disponible: true, motivoNoDisponible: null, datos, fecha };
  }

  /** Una línea con el contenido de las muestras, para no volcar arrays enteros. */
  private resumirMuestras(tipo: HealthDataType, samples: any[]): string {
    const primera = samples[0];
    const ultima = samples[samples.length - 1];

    if (tipo === 'sleep') {
      return `${samples.length} sesiones`;
    }

    if (tipo === 'steps' || tipo === 'distance' || tipo === 'calories') {
      const total = samples.reduce((s, m) => s + (m.value || 0), 0);
      return `${Math.round(total)} ${primera?.unit || ''}`.trim();
    }

    // Para el corazón y similares, la fecha importa más que el promedio: una
    // lectura de hace dos meses no es lo mismo que la de esta mañana, y sin
    // la fecha el diagnóstico parece decir que nunca se escribió nada.
    const fecha = this.fechaCorta(primera?.startDate);

    return `${primera?.value} a ${ultima?.value} ${primera?.unit || ''}`.trim() +
      (fecha ? ` · última ${fecha}` : '');
  }

  /** "hoy", "ayer" o "24 jul", para no saturar de fechas largas. */
  private fechaCorta(iso?: string): string | null {
    if (!iso) return null;

    const fecha = new Date(iso);
    if (isNaN(fecha.getTime())) return null;

    const hoy = new Date();
    const dias = Math.floor(
      (hoy.setHours(0, 0, 0, 0) - new Date(fecha).setHours(0, 0, 0, 0)) / 86400000
    );

    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 30) return `hace ${dias} d`;

    return fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  }


  // =====================================================
  // SOLICITUD DE ACTUALIZACIÓN (LA PIDE EL CUIDADOR)
  // =====================================================

  /** Corta las solicitudes pendientes que el adulto mayor ya atendió con una subida real. */
  async marcarSolicitudesAtendidas(idUsuario: string): Promise<void> {
    try {
      await this.supabase
        .from('solicitud_actualizacion_salud')
        .update({ atendida_en: new Date().toISOString() })
        .eq('id_usuario', idUsuario)
        .is('atendida_en', null);
    } catch (e) {
      console.warn('[Salud] no se pudieron cerrar las solicitudes:', e);
    }
  }

  /**
   * Para qué adulto mayor hay una solicitud de este cuidador esperando.
   *
   * Ya no la usa la interfaz: el botón "Pedir datos frescos" se retiró porque
   * la subida es automática y el cuidador no tiene por qué empujarla. Se deja
   * el método por si más adelante hace falta, y porque la tabla sigue existindo.
   */
  async obtenerSolicitudesPendientesPropias(): Promise<Set<string>> {
    const salida = new Set<string>();

    try {
      const { data } = await this.supabase
        .from('solicitud_actualizacion_salud')
        .select('id_usuario')
        .is('atendida_en', null);

      for (const fila of data || []) {
        if (fila.id_usuario) salida.add(fila.id_usuario);
      }
    } catch {
      // sin solicitudes: se devuelve el conjunto vacío
    }

    return salida;
  }

}

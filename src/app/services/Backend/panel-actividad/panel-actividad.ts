import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { haversineMetros } from '../../geo/geo';

/** Un día del gráfico de actividad. */
export interface ResumenDia {
  /** YYYY-MM-DD */
  fecha: string;
  /** dd/mm, para la etiqueta del eje. */
  etiqueta: string;
  distanciaM: number;
  viajes: number;
  /**
   * Minutos sin moverse DENTRO de un trayecto. Se derivan de los puntos, no de
   * `duracion_segundos`: ese campo es la duración total del trayecto
   * (`fin - fecha_inicio`), así que restarlo no deja el tiempo moviéndose.
   */
  minutosQuieto: number;
}

/** Un lugar donde el adulto pasó tiempo, con su nombre si hay zona que lo cubra. */
export interface LugarFrecuente {
  nombre: string;
  lat: number;
  lon: number;
  horas: number;
  /** % del total de permanencia medida, 0-100. */
  porcentaje: number;
  esCasa: boolean;
  /** false = cluster sin zona configurada que lo nombre. */
  conNombre: boolean;
}

export type TipoAlerta = 'sos' | 'zona' | 'salud';

export interface AlertaItem {
  tipo: TipoAlerta;
  titulo: string;
  detalle: string;
  fecha: string;
  resuelta: boolean;
  /** Minutos entre que se generó y se atendió. Solo SOS. */
  minutosRespuesta: number | null;
}

export interface EstadoZona {
  fuera: boolean;
  minutosFuera: number;
  primeraAlerta: string | null;
  ultimaNotificacion: string | null;
}

/**
 * Cuántas veces se salió de un conjunto de zonas y cuántas volvió a entrar.
 *
 * Lo que cuenta son CRUCES de frontera, no trayectos: un mismo trayecto puede
 * salir, volver a entrar y salir otra vez, y son tres hechos distintos.
 */
export interface TransicionesZona {
  /** Veces que pasó de estar dentro de una zona a estar fuera de todas. */
  salidas: number;
  /** Veces que pasó de estar fuera de todas a estar dentro de alguna. */
  entradas: number;
  /**
   * Trayectos con dos puntos válidos o más. Es el denominador de los dos
   * números: sin él, un 0 no distingue entre "no salió" y "no se pudo saber".
   */
  evaluados: number;
}

/**
 * Salidas y vueltas a casa, más dónde estaba en el último punto del período.
 */
export interface MovimientoCasa extends TransicionesZona {
  /** Zonas marcadas como casa que hay configuradas. 0 = no se puede calcular. */
  zonasCasa: number;
  /**
   * Si el último punto válido cae dentro de casa. `null` cuando no hay ningún
   * punto: no es lo mismo "no está en casa" que "no hay dato para saberlo".
   */
  ahoraDentro: boolean | null;
  /** Fecha del último punto válido. Con `ahoraDentro` da la hora de esa posición. */
  ultimoPunto: string | null;
}

export interface ResumenPanel {
  idUsuario: string;
  dias: ResumenDia[];
  lugares: LugarFrecuente[];
  alertas: AlertaItem[];
  zona: EstadoZona | null;
  casa: MovimientoCasa;
  /** Salidas de cualquier zona segura, no solo de las de casa. */
  salidasZona: TransicionesZona;
  /** Días con al menos un trayecto, para no mentir en el promedio diario. */
  diasConDatos: number;
  distanciaTotalM: number;
  /** true si los trayectos no tienen puntos: los promedios no significan nada. */
  sinPuntos: boolean;
  /**
   * Un registro por trayecto, con sus números tal cual los escribió el GPS.
   * Es lo que el cuidador revisa cuando quiere un dato puntual ("¿cuánto
   * caminó el martes?") en vez de una gráfica.
   */
  trayectos: DetalleTrayecto[];
  /**
   * Secciones que no se pudieron leer, con el nombre que se le muestra al
   * cuidador ("los trayectos", "las alertas SOS").
   *
   * Va separado de las listas vacías a propósito. Antes, una consulta denegada
   * por las políticas de la base de datos devolvía `[]` igual que una semana sin
   * movimiento, así que el panel decía "sin datos" y nadie podía saber que en
   * realidad no se había podido leer. Un `fallos` con algo adentro es la única
   * señal de que los ceros de abajo no son de fiar.
   */
  fallos: string[];
}

/** Un punto del trayecto, para dibujar la ruta en el mapa. */
export interface PuntoRuta {
  lat: number;
  lon: number;
}

/** Un trayecto con los valores exactos, sin agrupar por día. */
export interface DetalleTrayecto {
  id: string;
  inicio: string;
  fin: string | null;
  distanciaM: number;
  duracionS: number;
  /** true si el GPS no alcanzó a cerrar el trayecto. */
  abierto: boolean;
  /** Puntos de GPS válidos que tiene el trayecto. 0 = sin detalle. */
  puntos: number;
  /**
   * Puntos suficientes para pintar la línea de la ruta. Vacía si el trayecto
   * tiene menos de dos puntos válidos: con uno solo no hay línea que dibujar.
   */
  ruta: PuntoRuta[];
  /** Minutos sin moverse DENTRO del trayecto, por el criterio de `tiempoQuietoPorDia`. */
  minutosQuieto: number;
  /** Porcentaje del trayecto que estuvo quieto, 0-100. null si no hay puntos. */
  pctQuieto: number | null;
  /** km/h sobre la duración total. null si la duración no es confiable. */
  velocidadKmh: number | null;
  /** Distancia que no cuadra con los puntos: 0 = todo coherente. */
  distanciaSinPuntosM: number;
}

/** Puntos con peor precisión que esto no sirven ni para distancia ni para mapa. */
const PRECISION_MAX_M = 100;

/** Dos puntos más cercanos que esto cuentan como "no se movió". */
const UMBRAL_QUIETO_M = 60;

/**
 * Hueco máximo que se cuenta como tiempo quieto. Pasado esto no se sabe qué pasó: el
 * GPS pudo apagarse, el celular quedó quieto en un auto, o el
 * adulto se fue a un sitio sin señal. Contarlo como permanencia infla el
 * número, así que se descarta y el lugar aparece con menos horas.
 */
const HUECO_MAX_QUIETO_MS = 15 * 60 * 1000;

/** Dos paradas más cercanas que esto son el mismo lugar. */
const UMBRAL_CLUSTER_M = 90;

/**
 * Puntos que se dibujan por trayecto en el mapa. El recorte no es cosmético: un
 * trayecto de varias horas puede tener miles de puntos y pintarlos todos atasca
 * el mapa sin que se vea nada distinto. 150 bastan para que la línea se lea
 * como la ruta que es.
 */
const PUNTOS_MAPA_MAX = 150;

/**
 * Margen que se descuenta al borde de la zona, en metros.
 *
 * El GPS no da la misma coordenada dos veces: un punto a 100 m del centro de una
 * zona puede salir a 99 o a 103 según el momento. Sin este margen, un trayecto
 * que se para justo en la puerta aparecería como una salida y una vuelta que no
 * ocurrieron. Un punto dentro del margen no cambia el estado en el que se está.
 */
const MARGEN_ZONA_M = 15;


@Injectable({
  providedIn: 'root'
})
export class PanelActividadService {

  private supabaseService = inject(SupabaseService);

  private supabase = this.supabaseService.getClient();


  /**
   * Trae todo lo que el panel necesita, sección por sección.
   *
   * Cada bloque va en su propio try/catch a propósito. Si una tabla está vacía,
   * o las políticas de seguridad la niegan, el resto del panel tiene que
   * seguir saliendo: un panel en blanco por una tabla que nadie ha escrito
   * todavía es peor que un panel con un hueco.
   */
  async cargar(idUsuario: string, dias = 7): Promise<ResumenPanel> {
    let resumen = await this.unaVez(idUsuario, dias);

    // Al entrar por primera vez la sesión todavía se está asentando, y es justo
    // cuando más se cae una lectura: ése era el arranque en frío intermitente.
    // Reintentar la corrida entera una vez convierte ese fallo en medio segundo
    // de espera. Se reintenta todo y no solo la sección caída porque una corrida
    // completa son siete consultas pequeñas, y mezclar viajes de un intento con
    // puntos de otro dejaría números que no se corresponden.
    const intentos = 2;
    for (let intento = 2; intento <= intentos && resumen.fallos.length; intento++) {
      await new Promise((listo) => setTimeout(listo, 500));
      resumen = await this.unaVez(idUsuario, dias);
    }

    return resumen;
  }

  /**
   * Una corrida completa de lecturas, sin reintentos.
   *
   * Devuelve además la lista de secciones que fallaron. Cada lectura declara su
   * nombre para el aviso, así que un fallo se le puede mostrar al cuidador tal
   * como suena ("no se pudieron leer los trayectos") en vez de convertirse en un
   * cero indistinguible de "no pasó nada".
   */
  private async unaVez(idUsuario: string, dias: number): Promise<ResumenPanel> {
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const desdeIso = desde.toISOString();

    const [viajesL, zonasL, sosL, saludL, zonaAlertaL] = await Promise.all([
      this.leerViajes(idUsuario, desdeIso),
      this.leerZonas(idUsuario),
      this.leerSos(idUsuario, desdeIso),
      this.leerSaludPendiente(idUsuario),
      this.leerZonaAlerta(idUsuario)
    ]);

    const viajes = viajesL.valor;
    const zonas = zonasL.valor;
    const sos = sosL.valor;
    const salud = saludL.valor;
    const zonaAlerta = zonaAlertaL.valor;

    const puntosL = viajes.length
      ? await this.leerPuntos(viajes.map((v) => v.id))
      : { valor: [] as any[], fallo: null as string | null };
    const puntos = puntosL.valor;

    const fallos = [viajesL, zonasL, sosL, saludL, zonaAlertaL, puntosL]
      .map((lectura) => lectura.fallo)
      .filter((fallo): fallo is string => !!fallo);

    const porDia = this.resumenPorDia(viajes, dias);
    const { quietoPorDia, total: minutosQuietoTotal } = this.tiempoQuietoPorDia(puntos);
    for (const dia of porDia) {
      dia.minutosQuieto = quietoPorDia.get(dia.fecha) || 0;
    }

    const lugares = this.lugaresFrecuentes(puntos, zonas, minutosQuietoTotal);
    const alertas = this.armarAlertas(sos, zonaAlerta, salud);
    const trayectos = this.detallarTrayectos(viajes, puntos);
    const casa = this.movimientosCasa(puntos, zonas);
    const salidasZona = this.transicionesZona(puntos, zonas);

    return {
      idUsuario,
      dias: porDia,
      lugares,
      alertas,
      zona: zonaAlerta,
      casa,
      salidasZona,
      diasConDatos: porDia.filter((d) => d.viajes > 0).length,
      distanciaTotalM: porDia.reduce((s, d) => s + d.distanciaM, 0),
      sinPuntos: puntos.length === 0,
      trayectos,
      fallos
    };
  }

  /**
   * Corre una consulta y separa "no hay nada" de "no se pudo leer".
   *
   * supabase-js no lanza excepción cuando la consulta falla: devuelve
   * `{ data: null, error: {...} }`. Un try/catch a secas no alcanza, porque el
   * error viaja como valor; por eso también se mira el campo `error`. Los dos
   * caminos (excepción y error) se registran en consola con el nombre de la
   * sección, y ese mismo nombre vuelve en `fallo` para que el panel lo muestre.
   */
  private async leer(
    seccion: string,
    consulta: () => PromiseLike<{ data: any; error: any }>
  ): Promise<{ data: any; fallo: string | null }> {
    try {
      const { data, error } = await consulta();
      if (error) {
        console.warn('[panel-actividad] no se pudo leer ' + seccion + ':', error.message || error);
        return { data: null, fallo: seccion };
      }
      return { data, fallo: null };
    } catch (e) {
      console.warn('[panel-actividad] no se pudo leer ' + seccion + ':', e);
      return { data: null, fallo: seccion };
    }
  }


  /**
   * Un registro por trayecto con todo lo que se puede calcular de él: puntos,
   * tiempo quieto, velocidad y si la distancia escrita por el GPS cuadra con
   * los puntos que quedaron guardados.
   *
   * El chequeo de coherencia es lo importante. `distancia_metros` lo escribe el
   * teléfono cuando cierra el trayecto, sumando la distancia entre puntos
   * válidos. Si después se borran o descartan puntos, la distancia queda
   * huérfana: se vería un número que ya nada respalda. Por eso se recalcula la
   * distancia con los puntos disponibles y se muestra la diferencia cuando no
   * cuadran, en vez de taparla.
   */
  private detallarTrayectos(viajes: any[], puntos: any[]): DetalleTrayecto[] {
    const porViaje = new Map<string, any[]>();
    for (const p of puntos) {
      const lista = porViaje.get(p.id_desplazamiento) || [];
      lista.push(p);
      porViaje.set(p.id_desplazamiento, lista);
    }

    return viajes
      .filter((v) => Number.isFinite(Date.parse(v.fecha_inicio)))
      .map((v) => {
        const lista = (porViaje.get(v.id) || []).filter((p) => this.puntoEsUtil(p));
        lista.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));

        const distanciaM = Number(v.distancia_metros) || 0;
        const duracionS = Number(v.duracion_segundos) || 0;
        const abierto = v.activo === true || !v.fecha_fin;

        // `tiempoQuietoPorDia` reparte por día; aquí el total del trayecto es
        // exactamente la suma de sus puntos.
        const { total: minutosQuieto } = this.tiempoQuietoPorDia(lista);
        const distanciaPuntos = this.distanciaDeLista(lista);
        // Solo se considera incoherente si hay suficientes puntos para que la
        // comparación signifique algo. Con dos puntos sueltos la diferencia es
        // ruido, no un error de datos.
        const comparable = lista.length >= 5;
        const diferencia = comparable
          ? Math.abs(distanciaM - distanciaPuntos)
          : 0;

        const minutosTrayecto = duracionS / 60;
        const pctQuieto = lista.length >= 2 && minutosTrayecto > 0
          ? Math.min(100, Math.round((minutosQuieto / minutosTrayecto) * 100))
          : null;

        return {
          id: v.id,
          inicio: v.fecha_inicio,
          fin: v.fecha_fin || null,
          distanciaM,
          duracionS,
          abierto,
          puntos: lista.length,
          ruta: this.rutaParaMapa(lista),
          minutosQuieto,
          pctQuieto,
          // La velocidad de un trayecto abierto no es confiable: el GPS sigue
          // escribiendo la distancia mientras la duración se quedó atrás.
          velocidadKmh: !abierto && duracionS > 0
            ? Math.round((distanciaM / duracionS) * 3.6 * 10) / 10
            : null,
          distanciaSinPuntosM: diferencia
        } as DetalleTrayecto;
      })
      .sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio));
  }


  /** Distancia recorrida por una lista de puntos, ya ordenada por fecha. */
  private distanciaDeLista(lista: any[]): number {
    let total = 0;
    for (let i = 1; i < lista.length; i++) {
      total += haversineMetros(
        Number(lista[i - 1].latitud), Number(lista[i - 1].longitud),
        Number(lista[i].latitud), Number(lista[i].longitud)
      );
    }
    return total;
  }

  /**
   * La línea del trayecto para el mapa, con la lista acortada.
   *
   * Se conservan el primer y el último punto aunque queden fuera del muestreo:
   * son los que marcan dónde empezó y dónde terminó la ruta, y si se perdieran
   * la línea mentiría sobre el recorrido. El resto se toma de uno en uno según
   * el paso que toque, y se descarta lo que no se dibuja.
   */
  private rutaParaMapa(lista: any[]): PuntoRuta[] {
    if (lista.length < 2) {
      return [];
    }
    const paso = Math.max(1, Math.ceil(lista.length / PUNTOS_MAPA_MAX));
    const salida: PuntoRuta[] = [];
    for (let i = 0; i < lista.length; i += paso) {
      salida.push({
        lat: Number(lista[i].latitud),
        lon: Number(lista[i].longitud)
      });
    }
    const fin = lista[lista.length - 1];
    const ultimo = { lat: Number(fin.latitud), lon: Number(fin.longitud) };
    const previo = salida[salida.length - 1];
    if (!previo || previo.lat !== ultimo.lat || previo.lon !== ultimo.lon) {
      salida.push(ultimo);
    }
    return salida;
  }


  // =====================================================
  // LECTURAS
  // =====================================================

  private async leerViajes(idUsuario: string, desdeIso: string) {
    const { data, fallo } = await this.leer('los trayectos', () =>
      this.supabase
        .from('historial_desplazamiento')
        .select('id, fecha_inicio, fecha_fin, distancia_metros, duracion_segundos, activo')
        .eq('id_usuario', idUsuario)
        .gte('fecha_inicio', desdeIso)
        .order('fecha_inicio', { ascending: true }));
    return { valor: (data || []) as any[], fallo };
  }

  private async leerPuntos(idsViaje: string[]) {
    const { data, fallo } = await this.leer('los puntos del GPS', () =>
      this.supabase
        .from('historial_punto')
        .select('id_desplazamiento, latitud, longitud, fecha, precision_metros, orden')
        .in('id_desplazamiento', idsViaje));
    return { valor: (data || []) as any[], fallo };
  }

  private async leerZonas(idUsuario: string) {
    const { data, fallo } = await this.leer('las zonas seguras', () =>
      this.supabase
        .from('zona_segura')
        .select('id, nombre, latitud_centro, longitud_centro, radio_metros, es_casa, activa')
        .eq('id_usuario', idUsuario)
        .eq('activa', true));
    const valor = (data || [])
      .map((z: any) => ({
        nombre: z.nombre || 'Zona sin nombre',
        lat: Number(z.latitud_centro),
        lon: Number(z.longitud_centro),
        radio: Number(z.radio_metros) || 150,
        esCasa: !!z.es_casa
      }))
      // `latitud_centro` es varchar en el esquema. Un valor con coma decimal o
      // un espacio sucio se convierte en NaN y debe quedar afuera, no contar
      // como zona válida.
      .filter((z: any) => Number.isFinite(z.lat) && Number.isFinite(z.lon));
    return { valor, fallo };
  }

  private async leerSos(idUsuario: string, desdeIso: string) {
    const { data, fallo } = await this.leer('las alertas SOS', () =>
      this.supabase
        .from('sos_alerta')
        .select('id, creada_en, confirmada_por, confirmada_en')
        .eq('id_adulto', idUsuario)
        .gte('creada_en', desdeIso)
        .order('creada_en', { ascending: false }));
    return { valor: (data || []) as any[], fallo };
  }

  private async leerSaludPendiente(idUsuario: string) {
    const { data, fallo } = await this.leer('las solicitudes de salud', () =>
      this.supabase
        .from('solicitud_actualizacion_salud')
        .select('id, solicitada_en, motivo')
        .eq('id_usuario', idUsuario)
        .is('atendida_en', null));
    return { valor: (data || []) as any[], fallo };
  }

  /**
   * Estado actual de la geocerca. `zona_alerta` no tiene PRIMARY KEY en
   * `id_usuario`, así que puede haber más de una fila; se toma la más reciente
   * en vez de `maybeSingle`, que fallaría si encuentra dos.
   */
  private async leerZonaAlerta(idUsuario: string) {
    const { data, fallo } = await this.leer('el estado de la zona segura', () =>
      this.supabase
        .from('zona_alerta')
        .select('fuera, primera_alerta, ultima_notificacion, actualizada_en')
        .eq('id_usuario', idUsuario)
        .order('actualizada_en', { ascending: false })
        .limit(1));
    const fila = (data || [])[0];
    if (!fila) {
      return { valor: null as EstadoZona | null, fallo };
    }
    const desde = Date.parse(fila.primera_alerta || fila.actualizada_en || '');
    const minutosFuera = Date.now() - desde;
    const valor = {
      fuera: !!fila.fuera,
      minutosFuera: Number.isFinite(minutosFuera) ? Math.max(0, Math.round(minutosFuera / 60000)) : 0,
      primeraAlerta: fila.primera_alerta || null,
      ultimaNotificacion: fila.ultima_notificacion || null
    } as EstadoZona;
    return { valor, fallo };
  }



  // =====================================================
  // CÁLCULO
  // =====================================================

  /**
   * Un día por cada día del rango, aunque no haya trayecto. Sin esto el gráfico
   * saltaría los días sin datos y la barra parecería continua.
   */
  private resumenPorDia(viajes: any[], dias: number): ResumenDia[] {
    const salida: ResumenDia[] = [];
    const hoy = new Date();

    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() - i);
      const fecha = this.claveDia(d);
      salida.push({
        fecha,
        etiqueta: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
        distanciaM: 0,
        viajes: 0,
        minutosQuieto: 0
      });
    }

    const porFecha = new Map(salida.map((s) => [s.fecha, s]));

    for (const v of viajes) {
      const t = Date.parse(v.fecha_inicio);
      if (!Number.isFinite(t)) {
        continue;
      }
      const destino = porFecha.get(this.claveDia(new Date(t)));
      if (!destino) {
        continue;
      }
      destino.distanciaM += Number(v.distancia_metros) || 0;
      destino.viajes += 1;
    }

    return salida;
  }

  private claveDia(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Tiempo sin moverse, derivado de las brechas entre puntos de un mismo
   * trayecto.
   *
   * Va trayecto por trayecto a propósito: entre dos trayectos distintos hay un
   * hueco que no es ni movimiento ni tiempo quieto, y sumarlo inflaría las horas de
   * todos los lugares.
   */
  private tiempoQuietoPorDia(puntos: any[]): { quietoPorDia: Map<string, number>; total: number } {
    const porViaje = new Map<string, any[]>();
    for (const p of puntos) {
      if (!this.puntoEsUtil(p)) {
        continue;
      }
      const lista = porViaje.get(p.id_desplazamiento) || [];
      lista.push(p);
      porViaje.set(p.id_desplazamiento, lista);
    }

    const quietoPorDia = new Map<string, number>();
    let total = 0;

    for (const lista of porViaje.values()) {
      lista.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
      if (lista.length < 2) {
        continue;
      }
      for (let i = 1; i < lista.length; i++) {
        const anterior = lista[i - 1];
        const actual = lista[i];
        const hueco = Date.parse(actual.fecha) - Date.parse(anterior.fecha);
        if (hueco <= 0 || hueco > HUECO_MAX_QUIETO_MS) {
          continue;
        }
        const distancia = haversineMetros(
          Number(anterior.latitud), Number(anterior.longitud),
          Number(actual.latitud), Number(actual.longitud)
        );
        if (distancia > UMBRAL_QUIETO_M) {
          continue;
        }
        const dia = this.claveDia(new Date(Date.parse(anterior.fecha)));
        const minutos = hueco / 60000;
        quietoPorDia.set(dia, (quietoPorDia.get(dia) || 0) + minutos);
        total += minutos;
      }
    }

    return { quietoPorDia, total };
  }

  private puntoEsUtil(p: any): boolean {
    if (!p) {
      return false;
    }
    const lat = Number(p.latitud);
    const lon = Number(p.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return false;
    }
    if (!Number.isFinite(Date.parse(p.fecha))) {
      return false;
    }
    const precision = Number(p.precision_metros);
    // `null`/undefined es "no informado" y se acepta. Un número grande es una
    // lectura mala y se descarta.
    if (Number.isFinite(precision) && precision > PRECISION_MAX_M) {
      return false;
    }
    return true;
  }

  /**
   * Agrupa las paradas en lugares y le pone nombre.
   *
   * El nombre sale de `zona_segura`, que es lo único con nombre que existe en
   * el esquema. Donde no hay zona que cubra el punto, el lugar queda como
   * "Sin nombre": inventar nombres o poner categorías fijas sería mentir sobre
   * lo que el dato sabe.
   */
  private lugaresFrecuentes(
    puntos: any[],
    zonas: any[],
    minutosTotal: number
  ): LugarFrecuente[] {
    const porViaje = new Map<string, any[]>();
    for (const p of puntos) {
      if (!this.puntoEsUtil(p)) {
        continue;
      }
      const lista = porViaje.get(p.id_desplazamiento) || [];
      lista.push(p);
      porViaje.set(p.id_desplazamiento, lista);
    }

    interface Cluster { lat: number; lon: number; minutos: number; }
    const clusters: Cluster[] = [];

    for (const lista of porViaje.values()) {
      lista.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
      for (let i = 1; i < lista.length; i++) {
        const anterior = lista[i - 1];
        const actual = lista[i];
        const hueco = Date.parse(actual.fecha) - Date.parse(anterior.fecha);
        if (hueco <= 0 || hueco > HUECO_MAX_QUIETO_MS) {
          continue;
        }
        const lat = Number(anterior.latitud);
        const lon = Number(anterior.longitud);
        if (haversineMetros(lat, lon, Number(actual.latitud), Number(actual.longitud)) > UMBRAL_QUIETO_M) {
          continue;
        }

        const minutos = hueco / 60000;
        let destino: Cluster | undefined;
        for (const c of clusters) {
          if (haversineMetros(c.lat, c.lon, lat, lon) <= UMBRAL_CLUSTER_M) {
            destino = c;
            break;
          }
        }
        if (destino) {
          // Promedio móvil: mantiene el centro cerca de donde realmente estuvo
          // en vez de quedar clavado en el primer punto del cluster.
          const total = destino.minutos + minutos;
          destino.lat = (destino.lat * destino.minutos + lat * minutos) / total;
          destino.lon = (destino.lon * destino.minutos + lon * minutos) / total;
          destino.minutos = total;
        } else {
          clusters.push({ lat, lon, minutos });
        }
      }
    }

    return clusters
      .filter((c) => c.minutos >= 10)
      .sort((a, b) => b.minutos - a.minutos)
      .slice(0, 5)
      .map((c) => {
        const zona = this.zonaQueCubre(c.lat, c.lon, zonas);
        const horas = c.minutos / 60;
        return {
          nombre: zona ? zona.nombre : 'Lugar sin nombre',
          lat: c.lat,
          lon: c.lon,
          horas: Math.round(horas * 10) / 10,
          porcentaje: minutosTotal > 0 ? Math.round((c.minutos / minutosTotal) * 100) : 0,
          esCasa: zona ? zona.esCasa : false,
          conNombre: !!zona
        };
      });
  }

  /**
   * La zona más específica que cubre el punto: entre dos radios que encajan,
   * gana el más Chico, porque "Casa" debería ganarle a "Barrio centro".
   */
  /**
   * Cruces de frontera de un conjunto de zonas: cuántas veces se salió de todas
   * y cuántas volvió a entrar en alguna.
   *
   * El GPS no sabe qué es una zona ni registra entradas y salidas: solo guarda
   * puntos. La forma de sacarlo es recorrer el recorrido de cada trayecto y ver
   * en qué momento el punto deja de estar dentro de alguna zona.
   *
   * Se recorre TODO el recorrido y no solo el primer y el último punto porque
   * lo normal no es salir y volver en dos trayectos: es un solo trayecto que va,
   * pasa por casa a dejar algo, y sigue. Mirando solo los extremos, esa pasada
   * por casa no aparecía en ningún número.
   *
   * Cada cambio de estado cuenta una vez: de dentro a fuera es una salida, de
   * fuera a dentro una vuelta. El primer punto de cada trayecto solo fija en qué
   * se estaba y no cuenta nada: de dónde venga el trayecto no lo sabemos.
   *
   * Hay un margen de `MARGEN_ZONA_M` para que el temblor del GPS en el borde no
   * produzca una ida y una vuelta falsas. Un punto que cae dentro del margen no
   * cambia el estado: se queda como estaba.
   *
   * Con un solo punto válido no se puede afirmar nada, porque no se sabe de dónde
   * salió ni a dónde llegó. Esos trayectos quedan fuera de los dos números y
   * también fuera de `evaluados`, que es su denominador.
   *
   * Lo que NO se ve, y por eso el panel lo dice al pie: una ida corta que el GPS
   * no cerró como trayecto, o una salida que pasaría entera entre dos puntos.
   * Los números cuentan lo que los puntos alcanzan a ver, no lo que pasó.
   */
  private transicionesZona(puntos: any[], zonas: any[]): TransicionesZona {
    const base: TransicionesZona = { salidas: 0, entradas: 0, evaluados: 0 };
    if (!zonas || !zonas.length) {
      return base;
    }

    const bienDentro = (lat: number, lon: number) =>
      zonas.some((z: any) => haversineMetros(lat, lon, z.lat, z.lon) <= Math.max(0, z.radio - MARGEN_ZONA_M));
    const bienFuera = (lat: number, lon: number) =>
      zonas.every((z: any) => haversineMetros(lat, lon, z.lat, z.lon) > z.radio + MARGEN_ZONA_M);

    // Los puntos de cada trayecto, ordenados por fecha. La consulta no los
    // devuelve en orden, y recorrerlos desordenados inventaría cruces falsos.
    const porViaje = new Map<string, any[]>();
    for (const p of puntos || []) {
      if (!this.puntoEsUtil(p)) {
        continue;
      }
      const lista = porViaje.get(p.id_desplazamiento) || [];
      lista.push(p);
      porViaje.set(p.id_desplazamiento, lista);
    }

    let salidas = 0;
    let entradas = 0;
    let evaluados = 0;
    for (const lista of porViaje.values()) {
      if (lista.length < 2) {
        continue;
      }
      lista.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
      evaluados++;

      let estado: 'dentro' | 'fuera' | null = null;
      for (const p of lista) {
        const lat = Number(p.latitud);
        const lon = Number(p.longitud);
        if (bienDentro(lat, lon)) {
          if (estado === 'fuera') {
            entradas++;
          }
          estado = 'dentro';
        } else if (bienFuera(lat, lon)) {
          if (estado === 'dentro') {
            salidas++;
          }
          estado = 'fuera';
        }
      }
    }

    return { salidas, entradas, evaluados };
  }

  /**
   * Lo mismo que `transicionesZona` pero solo sobre las zonas marcadas como
   * casa, más dónde estaba en el último punto del período.
   *
   * "Ahora está en casa" sale del último punto, no de una alerta: `zona_alerta`
   * solo guarda el estado de la zona segura y nadie la está escribiendo. Por eso
   * se devuelve también la hora de ese punto, para no presentar como "ahora" un
   * dato de hace tres días.
   */
  private movimientosCasa(puntos: any[], zonas: any[]): MovimientoCasa {
    const casas = (zonas || []).filter((z: any) => z.esCasa);
    const cruces = this.transicionesZona(puntos, casas);

    let ultimo: any = null;
    for (const p of puntos || []) {
      if (!this.puntoEsUtil(p)) {
        continue;
      }
      if (!ultimo || Date.parse(p.fecha) > Date.parse(ultimo.fecha)) {
        ultimo = p;
      }
    }

    let ahoraDentro: boolean | null = null;
    if (ultimo && casas.length) {
      ahoraDentro = casas.some(
        (z: any) => haversineMetros(Number(ultimo.latitud), Number(ultimo.longitud), z.lat, z.lon) <= z.radio
      );
    }

    return { ...cruces, zonasCasa: casas.length, ahoraDentro, ultimoPunto: ultimo ? ultimo.fecha : null };
  }

  private zonaQueCubre(lat: number, lon: number, zonas: any[]) {
    let mejor: any = null;
    for (const z of zonas) {
      if (haversineMetros(lat, lon, z.lat, z.lon) > z.radio) {
        continue;
      }
      if (!mejor || z.radio < mejor.radio) {
        mejor = z;
      }
    }
    return mejor;
  }

  private armarAlertas(sos: any[], zona: EstadoZona | null, salud: any[]): AlertaItem[] {
    const items: AlertaItem[] = [];

    for (const s of sos) {
      const creada = Date.parse(s.creada_en);
      const atendida = s.confirmada_en ? Date.parse(s.confirmada_en) : NaN;
      const resuelta = Number.isFinite(atendida);
      items.push({
        tipo: 'sos',
        titulo: 'Alerta SOS',
        detalle: resuelta ? 'Atendida por el cuidador' : 'Sin confirmar',
        fecha: s.creada_en,
        resuelta,
        minutosRespuesta: resuelta ? Math.max(0, Math.round((atendida - creada) / 60000)) : null
      });
    }

    if (zona) {
      items.push({
        tipo: 'zona',
        titulo: zona.fuera ? 'Fuera de la zona segura' : 'Dentro de la zona segura',
        detalle: zona.fuera ? `Lleva ${zona.minutosFuera} min fuera` : 'Ubicación dentro del área configurada',
        fecha: zona.ultimaNotificacion || zona.primeraAlerta || new Date().toISOString(),
        resuelta: !zona.fuera,
        minutosRespuesta: null
      });
    }

    for (const p of salud) {
      items.push({
        tipo: 'salud',
        titulo: 'Pide actualizar su salud',
        detalle: p.motivo || 'Sin motivo indicado',
        fecha: p.solicitada_en,
        resuelta: false,
        minutosRespuesta: null
      });
    }

    return items.sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
  }
}

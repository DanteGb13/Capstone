import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { SupabaseService } from '../../supabase/supabase';
import { UbicacionForeground, PermisosUbicacion } from '../ubicacion-foreground/ubicacion-foreground';

export interface UbicacionInfo {
  latitud: number;
  longitud: number;
  precision?: number;
  fecha: string;
  direccionTexto?: string;
  enLinea: boolean;
  /**
   * De dónde salió la coordenada:
   *  'bd'/'cache'  -> datos reales reportados por el adulto,
   *  'casa'        -> dirección de casa del perfil (respaldo),
   *  'dispositivo' -> GPS de ESTE teléfono (no indica dónde está el adulto).
   */
  origen?: 'bd' | 'cache' | 'casa' | 'dispositivo';
}

/**
 * Datos del servicio de geocodificación de OSM.
 *
 * Es un servicio comunitario y gratuito con una regla estricta: máximo una
 * petición por segundo. Pasarse no da un error visible, da respuestas de 5 a
 * 30 segundos. Por eso todo lo que se consulta aquí pasa por una caché y por
 * un turno de turno, en vez de salir a la red cada vez que se necesita un
 * texto.
 */
const NOMINATIM_MINIMO_MS = 1100;

/** Tope de espera a Nominatim: si no contesta, se sigue sin dirección. */
const NOMINATIM_TIMEOUT_MS = 4000;

/** Radio de redondeo al cachear: ~11 m, suficiente y no ensucia la caché. */
const PRECISION_CACHE_DIRECCION = 4;

@Injectable({
  providedIn: 'root'
})
export class Gps {

  private supabase = this.supabaseService.getClient();

  constructor(
    private supabaseService: SupabaseService
  ) { }

  /**
   * Direcciones ya resueltas, en memoria y en el teléfono.
   *
   * Vive aquí y no en cada pantalla porque el texto de una calle no cambia:
   * si dos pantallas piden la dirección de la misma esquina, la segunda la
   * tiene al instante y no le pega un latigazo a Nominatim.
   */
  private dirMemoria = new Map<string, string>();

  /** Peticiones de dirección que ya están en curso, para no duplicarlas. */
  private dirEnVuelo = new Map<string, Promise<string>>();

  /** Cuándo se le preguntó a Nominatim por última vez. */
  private ultimaConsultaDirMs = 0;


  // =====================================================
  // OBTENER UBICACIÓN ACTUAL DEL DISPOSITIVO
  // =====================================================

  /**
   * Posición del GPS de este teléfono.
   *
   * Va deliberadamente por lo rápido y no por lo exacto: `maximumAge` permite
   * una lectura reciente del caché y sin `enableHighAccuracy` el chip no tiene
   * que prenderse en frío. En interiores un fix de alta precisión puede tardar
   * 5 a 20 segundos, y para saber DÓNDE está la persona no hace falta el
   * último metro. Quien necesite precisión la pide después con el watcher,
   * que sí la exige.
   */
  async obtenerUbicacionActualDispositivo(): Promise<{ latitud: number; longitud: number; precision: number } | null> {
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        maximumAge: 15000,
        timeout: 8000
      });

      return {
        latitud: position.coords.latitude,
        longitud: position.coords.longitude,
        precision: position.coords.accuracy || 10
      };
    } catch (error) {
      // Fallback a API de navegador
      return new Promise((resolver) => {
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              resolver({
                latitud: pos.coords.latitude,
                longitud: pos.coords.longitude,
                precision: pos.coords.accuracy || 10
              });
            },
            () => {
              // Sin GPS no se inventa una ubicación: antes se devolvía
              // Santiago por defecto y eso provocaba avisos falsos desde lejos.
              resolver(null);
            },
            { enableHighAccuracy: false, maximumAge: 15000, timeout: 8000 }
          );
        } else {
          resolver(null);
        }
      });
    }
  }


  // =====================================================
  // REPORTAR Y GUARDAR UBICACIÓN DEL ADULTO MAYOR EN BD
  // =====================================================

  async reportarUbicacionAdulto(idUsuario: string): Promise<UbicacionInfo> {
    const coords = await this.obtenerUbicacionActualDispositivo();

    // Sin lectura de GPS no se reporta nada: se conserva la última ubicación
    // real en vez de grabar una coordenada falsa.
    if (!coords) {
      throw new Error('Sin lectura de GPS');
    }

    const ahora = new Date().toISOString();

    const info: UbicacionInfo = {
      latitud: coords.latitud,
      longitud: coords.longitud,
      precision: coords.precision,
      fecha: ahora,
      enLinea: true
    };

    // 1. Guardar en tabla public.ubicacion de Supabase (con manejo seguro de RLS)
    try {
      const { data: ubicacionData, error: ubicacionError } = await this.supabase
        .from('ubicacion')
        .insert({
          latitud: coords.latitud.toString(),
          longitud: coords.longitud.toString(),
          fecha: ahora,
          id_usuario: idUsuario
        })
        .select('id')
        .maybeSingle();

      if (!ubicacionError && ubicacionData?.id) {
        // 2. Actualizar id_ubicación en la tabla public.usuario
        await this.supabase
          .from('usuario')
          .update({
            id_ubicación: ubicacionData.id
          })
          .eq('id', idUsuario);
      } else if (ubicacionError) {
        console.warn('Nota: Permiso RLS en tabla ubicacion:', ubicacionError.message);
      }
    } catch (e) {
      console.warn('Excepción al insertar en tabla ubicacion:', e);
    }

    // 3. Cache local
    localStorage.setItem(`gps_ubicacion_${idUsuario}`, JSON.stringify(info));

    // 4. Reverse geocoding: en segundo plano. Esta pantalla ya tiene lo que
    //    necesita (la posición se acaba de guardar arriba), y esperar a que
    //    responda Nominatim sólo agregaría segundos a una tarea que se hace
    //    al abrir el panel. La dirección queda cacheada para cuando el
    //    cuidador la pida.
    this.resolverDireccionEnSegundoPlano(coords.latitud, coords.longitud, info, (conDireccion) => {
      try {
        localStorage.setItem(`gps_ubicacion_${idUsuario}`, JSON.stringify(conDireccion));
      } catch {
        /* sin persistencia */
      }
    });

    return info;
  }


  // =====================================================
  // OBTENER UBICACIÓN DE UN ADULTO MAYOR (PARA EL CUIDADOR)
  // =====================================================

  /**
   * Ubicación de un adulto mayor, para la pantalla del cuidador.
   *
   * `alObtenerDireccion` es opcional y es la razón por la que esta pantalla ya
   * no se demora: la dirección se pide aparte y se avisa cuando llega. Antes
   * el método esperaba a Nominatim y el pin no se dibujaba hasta que el
   * servicio de OSM respondía, que son 1 a 3 segundos y hasta 30 si el
   * servicio está saturado. El mapa necesita el punto, no la calle.
   */
  async obtenerUbicacionAdulto(
    idUsuario: string,
    direccionFallback?: any,
    alObtenerDireccion?: (info: UbicacionInfo) => void
  ): Promise<UbicacionInfo> {
    // 1. Buscar en la base de datos Supabase (tabla public.ubicacion)
    try {
      const { data: ubicacionBD, error: ubError } = await this.supabase
        .from('ubicacion')
        .select('*')
        .eq('id_usuario', idUsuario)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ubError && ubicacionBD?.latitud && ubicacionBD?.longitud) {
        const lat = parseFloat(ubicacionBD.latitud);
        const lng = parseFloat(ubicacionBD.longitud);

        if (!isNaN(lat) && !isNaN(lng)) {
          const info: UbicacionInfo = {
            latitud: lat,
            longitud: lng,
            precision: 15,
            fecha: ubicacionBD.fecha || new Date().toISOString(),
            direccionTexto: this.direccionDeCache(lat, lng),
            enLinea: true,
            origen: 'bd'
          };

          this.resolverDireccionEnSegundoPlano(lat, lng, info, alObtenerDireccion);

          // Sólo la ubicación real del adulto se guarda como última conocida
          localStorage.setItem(`gps_ubicacion_${idUsuario}`, JSON.stringify(info));
          return info;
        }
      } else if (ubError) {
        console.warn('Nota: Consulta a tabla ubicacion:', ubError.message);
      }
    } catch (err) {
      console.warn('Error consultando tabla ubicacion en Supabase:', err);
    }

    // 2. Sin registro en BD (p. ej. sin internet): se usa la última ubicación
    //    real conocida de este dispositivo.
    const cached = localStorage.getItem(`gps_ubicacion_${idUsuario}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.latitud && parsed.longitud) {
          if (!parsed.direccionTexto) {
            parsed.direccionTexto = this.direccionDeCache(parsed.latitud, parsed.longitud);
            this.resolverDireccionEnSegundoPlano(
              parsed.latitud,
              parsed.longitud,
              parsed,
              alObtenerDireccion
            );
          }
          return { ...parsed, origen: parsed.origen || 'cache' } as UbicacionInfo;
        }
      } catch (e) {
        console.error(e);
      }
    }

    // 3. Si hay dirección registrada del adulto mayor, geocodificar su domicilio
    if (direccionFallback?.comuna || direccionFallback?.calle) {
      const dirQuery = `${direccionFallback.calle || ''} ${direccionFallback.numero || ''}, ${direccionFallback.comuna || ''}, ${direccionFallback.region || ''}, Chile`.trim();
      const geocoded = await this.geocodificarDireccion(dirQuery);
      if (geocoded) {
        // No es donde está el adulto: sólo la dirección del perfil (respaldo)
        return {
          latitud: geocoded.latitud,
          longitud: geocoded.longitud,
          precision: 20,
          fecha: new Date().toISOString(),
          direccionTexto: dirQuery,
          enLinea: false,
          origen: 'casa'
        };
      }
    }

    // 4. GPS de ESTE dispositivo: último recurso y tampoco es el adulto
    const devicePos = await this.obtenerUbicacionActualDispositivo();
    if (!devicePos) {
      throw new Error('Sin ubicación disponible del adulto mayor');
    }

    const info: UbicacionInfo = {
      latitud: devicePos.latitud,
      longitud: devicePos.longitud,
      precision: devicePos.precision,
      fecha: new Date().toISOString(),
      direccionTexto: 'Ubicación reportada por GPS',
      enLinea: false,
      origen: 'dispositivo'
    };

    this.resolverDireccionEnSegundoPlano(
      devicePos.latitud,
      devicePos.longitud,
      info,
      alObtenerDireccion
    );

    return info;
  }


// =====================================================
// REVERSE GEOCODING (COORDENADAS -> DIRECCIÓN TEXTO)
// =====================================================

/**
 * Dirección que ya se conoce de una coordenada, sin tocar la red.
 *
 * Es la que se usa para pintar el mapa: si el texto no está cacheado todavía,
 * se devuelve vacío y la pantalla muestra la posición igual, sin esperar.
 */
private direccionDeCache(lat: number, lng: number): string {
    const clave = this.claveDireccion(lat, lng);

    const enMemoria = this.dirMemoria.get(clave);
    if (enMemoria) return enMemoria;

    try {
      const guardado = localStorage.getItem(clave);
      if (guardado) {
        this.dirMemoria.set(clave, guardado);
        return guardado;
      }
    } catch {
      /* sin persistencia */
    }

    return '';
  }

  private claveDireccion(lat: number, lng: number): string {
    const f = 10 ** PRECISION_CACHE_DIRECCION;
    return `gps_dir_${Math.round(lat * f)}_${Math.round(lng * f)}`;
  }

  private guardarDireccionEnCache(lat: number, lng: number, texto: string): void {
    if (!texto) return;

    this.dirMemoria.set(this.claveDireccion(lat, lng), texto);

    try {
      localStorage.setItem(this.claveDireccion(lat, lng), texto);
    } catch {
      /* sin persistencia */
    }
  }

  /**
   * Espera a que le toque el turno a Nominatim.
   *
   * Su política es de una consulta por segundo. Saltársela produce respuestas
   * de 5 a 30 s, así que el retraso de un segundo es mucho más barato que la
   * espera que genera saltársela.
   */
  private async esperarTurnoNominatim(): Promise<void> {
    const desde = Date.now() - this.ultimaConsultaDirMs;
    const falta = NOMINATIM_MINIMO_MS - desde;

    if (falta > 0) {
      await new Promise((resolver) => setTimeout(resolver, falta));
    }

    this.ultimaConsultaDirMs = Date.now();
  }

  async obtenerDireccionTexto(lat: number, lng: number): Promise<string> {
    // 1. Si ya se sabe, no se pregunta. Es el caso más común y el que hace
    //    que entrar a la pantalla sea instantáneo la segunda vez.
    const cacheada = this.direccionDeCache(lat, lng);
    if (cacheada) return cacheada;

// 2. Si esa misma consulta ya está en curso, se espera a esa y no se abre
    //    otra: si dos pantallas piden la misma esquina a la vez, se le pregunta
    //    dos veces por duplicado y las dos respuestas se hacen lentas.
    const clave = this.claveDireccion(lat, lng);
    const enVuelo = this.dirEnVuelo.get(clave);
    if (enVuelo) return enVuelo;

    const consulta = this.consultarDireccion(lat, lng).finally(() => {
      this.dirEnVuelo.delete(clave);
    });

    this.dirEnVuelo.set(clave, consulta);
    return consulta;
  }

  private async consultarDireccion(lat: number, lng: number): Promise<string> {
    await this.esperarTurnoNominatim();

    // El `fetch` necesita AbortController: sin esto, si Nominatim se queda
    // colgado la promesa no se resuelve nunca y la pantalla queda esperando.
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), NOMINATIM_TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        {
          signal: controlador.signal,
          headers: {
            'Accept-Language': 'es'
          }
        }
      );

      if (!response.ok) return '';

      const data = await response.json();
      let texto = '';

      if (data && data.display_name) {
        const road = data.address?.road || data.address?.pedestrian || '';
        const houseNumber = data.address?.house_number || '';
        const suburb = data.address?.suburb || data.address?.neighbourhood || data.address?.city_district || '';
        const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || '';

        if (road && city) {
          texto = `${road} ${houseNumber ? houseNumber + ', ' : ''}${suburb ? suburb + ', ' : ''}${city}`.trim();
        } else {
          texto = data.display_name.split(',').slice(0, 3).join(', ');
        }
      }

      this.guardarDireccionEnCache(lat, lng, texto);
      return texto;
    } catch (error) {
      // Sin abortar por error se traga la consola; con timeout tampoco hay
      // nada que hacer: se sigue sin dirección, que es texto cosmético.
      console.warn('Error reverse geocoding:', error);
      return '';
    } finally {
      clearTimeout(corte);
    }
  }

  /**
   * Pide la dirección sin esperarla.
   *
   * El mapa no necesita la calle para mostrar un punto, así que la posición se
   * devuelve de inmediato y el texto llega después por el callback. Cuando el
   * texto no se puede resolver nunca, la posición sigue siendo correcta: lo
   * único que se pierde es el nombre de la calle.
   */
  private resolverDireccionEnSegundoPlano(
    lat: number,
    lng: number,
    info: UbicacionInfo,
    alObtener?: (info: UbicacionInfo) => void
  ): void {
    // Ya hay dirección (o ya se pidió): no hay nada que hacer.
    if (info.direccionTexto) return;

    void this.obtenerDireccionTexto(lat, lng)
      .then((texto) => {
        if (!texto) return;

        info.direccionTexto = texto;
        alObtener?.(info);
      })
      .catch(() => {
        /* el texto es cosmético: si falla, se sigue con la posición */
      });
  }


  // =====================================================
  // GEOCODIFICACIÓN (DIRECCIÓN TEXTO -> COORDENADAS)
  // =====================================================

  async geocodificarDireccion(query: string): Promise<{ latitud: number; longitud: number } | null> {
    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
        {
          headers: {
            'Accept-Language': 'es'
          }
        }
      );

      if (!res.ok) return null;

      const data = await res.json();
      if (data && data.length > 0) {
        return {
          latitud: parseFloat(data[0].lat),
          longitud: parseFloat(data[0].lon)
        };
      }
    } catch (e) {
      console.warn('Error geocodificando:', e);
    }
    return null;
  }


  // =====================================================
  // FOREGROUND SERVICE (UBICACIÓN EN SEGUNDO PLANO)
  // =====================================================

  async iniciarUbicacionForeground(intervaloMs: number = 30000, distanciaMinimaM: number = 20): Promise<boolean> {
    try {
      const resultado = await UbicacionForeground.iniciar({
        intervaloMs,
        distanciaMinimaM
      });
      return resultado.iniciado;
    } catch (error: any) {
      if (error?.message?.includes('PERMISO_BACKGROUND_REQUERIDO')) {
        console.warn('Permiso de ubicación "Todo el tiempo" requerido. Se abrió Ajustes.');
      } else {
        console.warn('Error iniciando foreground service:', error);
      }
      return false;
    }
  }

  async detenerUbicacionForeground(): Promise<boolean> {
    try {
      const resultado = await UbicacionForeground.detener();
      return resultado.detenido;
    } catch (error) {
      console.warn('Error deteniendo foreground service:', error);
      return false;
    }
  }

  async estaForegroundActivo(): Promise<boolean> {
    try {
      const resultado = await UbicacionForeground.estaActivo();
      return resultado.activo;
    } catch (error) {
      return false;
    }
  }

  /**
   * Estado de los permisos de ubicación.
   *
   * Antes este método declaraba a mano `notificaciones` y `todosConcedidos`,
   * dos campos que el plugin nativo nunca devolvió: el tipo mentía sobre lo
   * que venía de verdad. Ahora se usa el tipo real del plugin, que además
   * distingue precisión de ubicación aproximada.
   */
  async verificarPermisosUbicacion(): Promise<PermisosUbicacion> {
    try {
      return await UbicacionForeground.verificarPermisos();
    } catch (error) {
      return {
        ubicacionForeground: false,
        ubicacionBackground: false,
        precisa: false,
        aproximada: false,
        backgroundAplica: false,
        servicioActivo: false,
        puedePedirForeground: true,
        puedePedirBackground: true
      };
    }
  }

  async abrirAjustesUbicacion(): Promise<void> {
    try {
      await UbicacionForeground.abrirAjustes();
    } catch (error) {
      console.warn('Error abriendo ajustes:', error);
    }
  }

}
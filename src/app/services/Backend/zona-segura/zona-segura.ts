import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { Gps } from '../gps/gps';
import { SOSService } from '../sos/sos';
import { PushNotificationService } from '../push-notification/push-notification';

export interface ZonaSegura {
  id: string;
  id_usuario: string;
  nombre: string;
  latitud_centro: number;
  longitud_centro: number;
  radio_metros: number;
  direccion_texto: string;
  region: string;
  comuna: string;
  calle: string;
  numero: string;
  activa: boolean;
  es_casa: boolean;
  fecha_creacion?: string;
  fecha_actualizacion?: string;
}

export interface DireccionZona {
  texto: string;
  region: string;
  comuna: string;
  calle: string;
  numero: string;
}

export interface EstadoZonaSegura {
  tieneZonas: boolean;
  dentro: boolean;
  zonaDentro: ZonaSegura | null;
  zonaCercana: ZonaSegura | null;
  distancia: number;
  alertaEnviada: boolean;
}

export interface DireccionSugerida {
  id: string;
  texto: string;
  principal: string;
  secundario: string;
  latitud: number;
  longitud: number;
  region: string;
  comuna: string;
  calle: string;
  numero: string;
}

export const RADIO_POR_DEFECTO = 500;

const TABLA = 'zona_segura';
const CLAVE_ALERTA = 'zs_alerta_';
const CLAVE_ESTADO = 'zs_estado_';
const ESPERA_ALERTA_MS = 10 * 60 * 1000;

@Injectable({
  providedIn: 'root'
})
export class ZonaSeguraService {

  private supabase = this.supabaseService.getClient();

  /** Último error de escritura (para mostrarlo en pantalla). */
  ultimoError: string = '';

  constructor(
    private supabaseService: SupabaseService,
    private gps: Gps,
    private sosService: SOSService,
    private pushService: PushNotificationService
  ) { }

  // =====================================================
  // USUARIO ACTUAL
  // =====================================================

  private async usuarioActualId(): Promise<string | null> {
    try {
      const { data } = await this.supabase.auth.getUser();
      return data?.user?.id ?? null;
    } catch {
      return null;
    }
  }

  async nombreUsuarioActual(): Promise<string> {
    try {
      const id = await this.usuarioActualId();
      if (!id) return '';
      const { data } = await this.supabase
        .from('usuario')
        .select('nombre, apellidopa, apellidoma')
        .eq('id', id)
        .maybeSingle();
      if (!data) return '';
      return `${data.nombre || ''} ${data.apellidopa || ''} ${data.apellidoma || ''}`.trim();
    } catch {
      return '';
    }
  }

  // =====================================================
  // CONSULTA / CRUD
  // =====================================================

  async obtenerZonas(idUsuario: string): Promise<ZonaSegura[]> {
    if (!idUsuario) return [];

    try {
      const { data, error } = await this.supabase
        .from(TABLA)
        .select('*')
        .eq('id_usuario', idUsuario)
        .eq('activa', true)
        .order('es_casa', { ascending: false })
        .order('fecha_creacion', { ascending: true });

      if (error) {
        console.warn('Nota: consulta a tabla zona_segura:', error.message);
        return [];
      }

      return (data || []).map((fila: any) => this.aModelo(fila));
    } catch (e) {
      console.error('Error obteniendo zonas seguras:', e);
      return [];
    }
  }

  async contarZonas(idUsuario: string): Promise<number> {
    try {
      const { count } = await this.supabase
        .from(TABLA)
        .select('id', { count: 'exact', head: true })
        .eq('id_usuario', idUsuario);
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  async crearZona(zona: Partial<ZonaSegura>): Promise<ZonaSegura | null> {
    this.ultimoError = '';
    const ahora = new Date().toISOString();

    const payload: any = {
      id_usuario: zona.id_usuario,
      nombre: zona.nombre || '',
      latitud_centro: String(zona.latitud_centro),
      longitud_centro: String(zona.longitud_centro),
      radio_metros: Math.round(zona.radio_metros || RADIO_POR_DEFECTO),
      direccion_texto: zona.direccion_texto || '',
      region: zona.region || '',
      comuna: zona.comuna || '',
      calle: zona.calle || '',
      numero: zona.numero || '',
      es_casa: !!zona.es_casa,
      activa: true,
      fecha_creacion: ahora,
      fecha_actualizacion: ahora
    };

    try {
      let { data, error } = await this.supabase
        .from(TABLA)
        .insert(payload)
        .select('*')
        .maybeSingle();

      // Si alguna columna de fecha es generada por la base, la decide el servidor
      if (error && this.esColumnaGenerada(error)) {
        delete payload.fecha_creacion;
        delete payload.fecha_actualizacion;
        ({ data, error } = await this.supabase
          .from(TABLA)
          .insert(payload)
          .select('*')
          .maybeSingle());
      }

      if (error) {
        this.ultimoError = error.message;
        console.error('Error creando zona segura:', error.message, error);
        return null;
      }

      return data ? this.aModelo(data) : null;
    } catch (e: any) {
      this.ultimoError = e?.message || String(e);
      console.error('Error creando zona segura:', e);
      return null;
    }
  }

  private esColumnaGenerada(error: any): boolean {
    return error?.code === '55000'
      || String(error?.message || '').toLowerCase().includes('generated column');
  }

  async actualizarZona(id: string, cambios: Partial<ZonaSegura>): Promise<boolean> {
    if (!id) return false;
    this.ultimoError = '';

    const payload: any = { fecha_actualizacion: new Date().toISOString() };
    if (cambios.nombre !== undefined) payload.nombre = cambios.nombre;
    if (cambios.latitud_centro !== undefined) payload.latitud_centro = String(cambios.latitud_centro);
    if (cambios.longitud_centro !== undefined) payload.longitud_centro = String(cambios.longitud_centro);
    if (cambios.radio_metros !== undefined) payload.radio_metros = Math.round(cambios.radio_metros);
    if (cambios.direccion_texto !== undefined) payload.direccion_texto = cambios.direccion_texto;
    if (cambios.region !== undefined) payload.region = cambios.region;
    if (cambios.comuna !== undefined) payload.comuna = cambios.comuna;
    if (cambios.calle !== undefined) payload.calle = cambios.calle;
    if (cambios.numero !== undefined) payload.numero = cambios.numero;
    if (cambios.activa !== undefined) payload.activa = cambios.activa;

    try {
      let { error } = await this.supabase
        .from(TABLA)
        .update(payload)
        .eq('id', id);

      // Si fecha_actualizacion es generada por la base, la decide el servidor
      if (error && this.esColumnaGenerada(error)) {
        delete payload.fecha_actualizacion;
        ({ error } = await this.supabase
          .from(TABLA)
          .update(payload)
          .eq('id', id));
      }

      if (error) {
        this.ultimoError = error.message;
        console.error('Error actualizando zona segura:', error.message);
        return false;
      }
      return true;
    } catch (e: any) {
      this.ultimoError = e?.message || String(e);
      console.error('Error actualizando zona segura:', e);
      return false;
    }
  }

  async eliminarZona(id: string): Promise<boolean> {
    if (!id) return false;
    this.ultimoError = '';

    try {
      const { error } = await this.supabase
        .from(TABLA)
        .delete()
        .eq('id', id);

      if (error) {
        this.ultimoError = error.message;
        console.error('Error eliminando zona segura:', error.message);
        return false;
      }
      return true;
    } catch (e: any) {
      this.ultimoError = e?.message || String(e);
      console.error('Error eliminando zona segura:', e);
      return false;
    }
  }

  private aModelo(fila: any): ZonaSegura {
    return {
      id: fila.id,
      id_usuario: fila.id_usuario,
      nombre: fila.nombre || '',
      latitud_centro: parseFloat(fila.latitud_centro),
      longitud_centro: parseFloat(fila.longitud_centro),
      radio_metros: Number(fila.radio_metros) || RADIO_POR_DEFECTO,
      direccion_texto: fila.direccion_texto || '',
      region: fila.region || '',
      comuna: fila.comuna || '',
      calle: fila.calle || '',
      numero: fila.numero || '',
      activa: fila.activa !== false,
      es_casa: !!fila.es_casa,
      fecha_creacion: fila.fecha_creacion,
      fecha_actualizacion: fila.fecha_actualizacion
    };
  }

  // =====================================================
  // ZONA PREDETERMINADA (DIRECCIÓN DE CASA DEL PERFIL)
  // =====================================================

  /**
   * Crea la zona "Mi casa" con la dirección guardada en el perfil.
   * Solo se hace la primera vez, si el usuario todavía no tiene zonas.
   */
  async asegurarZonaInicial(idUsuario: string): Promise<ZonaSegura | null> {
    if (!idUsuario) return null;

    try {
      const total = await this.contarZonas(idUsuario);
      if (total > 0) return null;

      const direccion = await this.obtenerDireccionUsuario(idUsuario);
      if (!direccion || !direccion.calle.trim()) return null;

      const coords = await this.geocodificar(this.formatearDireccion(direccion));
      if (!coords) return null;

      return await this.crearZona({
        id_usuario: idUsuario,
        nombre: 'Mi casa',
        latitud_centro: coords.latitud,
        longitud_centro: coords.longitud,
        radio_metros: RADIO_POR_DEFECTO,
        direccion_texto: this.formatearDireccion(direccion),
        region: direccion.region,
        comuna: direccion.comuna,
        calle: direccion.calle,
        numero: direccion.numero,
        es_casa: true
      });
    } catch (e) {
      console.warn('No se pudo crear la zona predeterminada de casa:', e);
      return null;
    }
  }

  /**
   * Vuelve a geocodificar la dirección del perfil y actualiza la zona "casa".
   * Útil si el usuario cambió su dirección en el perfil.
   */
  async actualizarZonaCasa(idZona: string, idUsuario: string): Promise<boolean> {
    try {
      const direccion = await this.obtenerDireccionUsuario(idUsuario);
      if (!direccion || !direccion.calle.trim()) return false;

      const coords = await this.geocodificar(this.formatearDireccion(direccion));
      if (!coords) return false;

      return await this.actualizarZona(idZona, {
        latitud_centro: coords.latitud,
        longitud_centro: coords.longitud,
        direccion_texto: this.formatearDireccion(direccion),
        region: direccion.region,
        comuna: direccion.comuna,
        calle: direccion.calle,
        numero: direccion.numero
      });
    } catch (e) {
      console.warn('Error actualizando zona de casa:', e);
      return false;
    }
  }

  async obtenerDireccionUsuario(idUsuario: string): Promise<DireccionZona | null> {
    try {
      const { data, error } = await this.supabase
        .from('usuario')
        .select('direccion:id_direccion(region, comuna, calle, numero)')
        .eq('id', idUsuario)
        .maybeSingle();

      if (error || !data) return null;

      let dir: any = data.direccion;
      if (Array.isArray(dir)) dir = dir[0];
      if (!dir) return null;

      return {
        texto: '',
        region: dir.region || '',
        comuna: dir.comuna || '',
        calle: dir.calle || '',
        numero: (dir.numero ?? '').toString()
      };
    } catch (e) {
      console.warn('Error leyendo dirección del usuario:', e);
      return null;
    }
  }

  formatearDireccion(dir: DireccionZona): string {
    const partes = [
      `${dir.calle || ''} ${dir.numero || ''}`.trim(),
      dir.comuna,
      dir.region,
      'Chile'
    ].filter((p) => p && p.toString().trim().length > 0);

    return partes.join(', ');
  }

  // =====================================================
  // GEOCODIFICACIÓN
  // =====================================================

  /**
   * Dirección texto -> coordenadas.
   * Usa el mismo motor que las sugerencias en vivo (Photon primero y
   * Nominatim como respaldo) y, en último caso, Nominatim directo.
   */
  async geocodificar(direccion: string): Promise<{ latitud: number; longitud: number } | null> {
    const texto = (direccion || '').trim();
    if (!texto) return null;

    try {
      const sugerencias = await this.buscarSugerencias(texto, null);
      if (sugerencias.length) {
        return { latitud: sugerencias[0].latitud, longitud: sugerencias[0].longitud };
      }
    } catch (e) {
      console.warn('Fallo geocodificando con el buscador de sugerencias:', e);
    }

    try {
      return await this.gps.geocodificarDireccion(texto);
    } catch (e) {
      console.warn('Error geocodificando dirección:', e);
      return null;
    }
  }

  /**
   * Coordenadas -> dirección con texto.
   * Intenta Nominatim, luego Photon y, si ninguno responde,
   * devuelve las coordenadas para que nunca quede vacío.
   */
  async reverseGeocodificar(latitud: number, longitud: number): Promise<DireccionZona> {
    const nominatim = await this.reverseEnNominatim(latitud, longitud);
    if (nominatim && (nominatim.calle || nominatim.comuna)) return nominatim;

    const photon = await this.reverseEnPhoton(latitud, longitud);
    if (photon && (photon.calle || photon.comuna)) return photon;

    if (nominatim?.texto) return nominatim;
    if (photon?.texto) return photon;

    return {
      texto: `${latitud.toFixed(5)}, ${longitud.toFixed(5)}`,
      region: '',
      comuna: '',
      calle: '',
      numero: ''
    };
  }

  private async reverseEnNominatim(
    latitud: number,
    longitud: number
  ): Promise<DireccionZona | null> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitud}&lon=${longitud}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'es' } }
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data || !data.display_name) return null;

      const a = data.address || {};
      const calle = a.road || a.pedestrian || a.neighbourhood || a.suburb || '';
      const numero = (a.house_number || '').toString();
      const comuna = a.city || a.town || a.village || a.county || a.municipality || '';
      const region = a.state || a.region || a.province || '';

      const partes = [`${calle} ${numero}`.trim(), comuna, region].filter(
        (p) => p && p.trim().length > 0
      );

      return {
        texto: partes.length ? partes.join(', ') : String(data.display_name || ''),
        region,
        comuna,
        calle,
        numero
      };
    } catch (e) {
      console.warn('Reverse geocoding con Nominatim falló:', e);
      return null;
    }
  }

  private async reverseEnPhoton(
    latitud: number,
    longitud: number
  ): Promise<DireccionZona | null> {
    try {
      const data = await this.fetchJson(
        `https://photon.komoot.io/reverse?lat=${latitud}&lon=${longitud}&lang=es`
      );

      const p = data?.properties;
      if (!p) return null;

      const calle = p.street || '';
      const numero = p.housenumber ? String(p.housenumber) : '';
      const comuna = p.city || p.district || p.county || '';
      const region = p.state || p.region || '';

      const primera = calle ? `${calle}${numero ? ' ' + numero : ''}` : p.name || '';
      const partes = [primera, comuna, region].filter((x) => x && String(x).trim().length > 0);

      return {
        texto: partes.join(', '),
        region,
        comuna,
        calle,
        numero
      };
    } catch (e) {
      console.warn('Reverse geocoding con Photon falló:', e);
      return null;
    }
  }

  // =====================================================
  // SUGERENCIAS EN VIVO (BÚSQUEDA TIPO GOOGLE MAPS)
  // =====================================================

  /**
   * Busca lugares/direcciones mientras la persona escribe.
   * Usa Photon (OpenStreetMap) y, si no responde, Nominatim como respaldo.
   * Entiende referencias como "Plaza Chacabuco", "Mall Plaza Norte"
   * o "Banco Estado Quilicura" porque los puntos de interés están en OSM.
   */
  async buscarSugerencias(
    texto: string,
    cercaDe: [number, number] | null = null
  ): Promise<DireccionSugerida[]> {
    const q = (texto || '').trim();
    if (q.length < 3) return [];

    const photon = await this.buscarEnPhoton(q, cercaDe);
    if (photon.length) return photon;

    return await this.buscarEnNominatim(q, cercaDe);
  }

  private async buscarEnPhoton(
    q: string,
    cercaDe: [number, number] | null
  ): Promise<DireccionSugerida[]> {
    try {
      const params = new URLSearchParams({ q, limit: '6', lang: 'es' });
      if (cercaDe) {
        params.set('lat', String(cercaDe[0]));
        params.set('lon', String(cercaDe[1]));
      }

      const data = await this.fetchJson(`https://photon.komoot.io/api/?${params.toString()}`);
      const features: any[] = Array.isArray(data?.features) ? data.features : [];

      const vistas = new Set<string>();
      const sugerencias: DireccionSugerida[] = [];

      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        const p = f?.properties || {};
        const coords = f?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;

        const calle = p.street || p.name || '';
        const numero = p.housenumber ? String(p.housenumber) : '';
        const comuna = p.city || p.district || p.county || '';
        const region = p.state || p.region || '';

        let principal = p.name || '';
        if (!principal && calle) principal = `${calle}${numero ? ' ' + numero : ''}`;
        if (!principal) principal = comuna || 'Lugar';
        if (!principal) continue;

        const conCalle = calle ? `${calle}${numero ? ' ' + numero : ''}` : '';
        const secundario = [p.name ? conCalle : '', comuna, region]
          .filter((x: string) => x && String(x).trim())
          .join(', ');
        const textoCompleto = secundario ? `${principal}, ${secundario}` : principal;

        if (vistas.has(textoCompleto)) continue;
        vistas.add(textoCompleto);

        sugerencias.push({
          id: `ph-${i}-${coords[0]}-${coords[1]}`,
          texto: textoCompleto,
          principal,
          secundario,
          latitud: Number(coords[1]),
          longitud: Number(coords[0]),
          region,
          comuna,
          calle: p.street || '',
          numero
        });
      }

      return sugerencias;
    } catch (e) {
      console.warn('Photon no respondió, se usará Nominatim:', e);
      return [];
    }
  }

  private async buscarEnNominatim(
    q: string,
    cercaDe: [number, number] | null
  ): Promise<DireccionSugerida[]> {
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        limit: '6',
        addressdetails: '1',
        'accept-language': 'es',
        q
      });

      if (cercaDe) {
        const delta = 0.5;
        const xmin = cercaDe[1] - delta;
        const xmax = cercaDe[1] + delta;
        const ymax = cercaDe[0] + delta;
        const ymin = cercaDe[0] - delta;
        params.set('viewbox', `${xmin},${ymax},${xmax},${ymin}`);
        params.set('bounded', '0');
      }

      const data = await this.fetchJson(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`
      );
      const items: any[] = Array.isArray(data) ? data : [];

      return items.map((item, i) => {
        const a = item?.address || {};
        const calle = a.road || a.pedestrian || a.neighbourhood || a.suburb || '';
        const numero = a.house_number ? String(a.house_number) : '';
        const comuna = a.city || a.town || a.village || a.municipality || a.county || '';
        const region = a.state || a.region || '';
        const principal = calle
          ? `${calle}${numero ? ' ' + numero : ''}`
          : String(item.name || (item.display_name || '').split(',')[0] || 'Lugar');
        const secundario = [comuna, region].filter((x) => x && String(x).trim()).join(', ');

        return {
          id: `nm-${i}-${item.lon}-${item.lat}`,
          texto: String(item.display_name || principal),
          principal,
          secundario: secundario || String(item.display_name || ''),
          latitud: Number(item.lat),
          longitud: Number(item.lon),
          region,
          comuna,
          calle,
          numero
        };
      });
    } catch (e) {
      console.warn('Nominatim no respondió buscando sugerencias:', e);
      return [];
    }
  }

  private async fetchJson(url: string): Promise<any> {
    const control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const temporizador = control ? setTimeout(() => control.abort(), 5000) : null;

    try {
      const respuesta = await fetch(url, {
        signal: control?.signal,
        headers: { Accept: 'application/json' }
      });
      if (!respuesta.ok) return null;
      return await respuesta.json();
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  // =====================================================
  // DISTANCIA (HAVERSINE) Y EVALUACIÓN
  // =====================================================

  distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (grados: number) => (grados * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  evaluar(zonas: ZonaSegura[], latitud: number, longitud: number): EstadoZonaSegura {
    const estado: EstadoZonaSegura = {
      tieneZonas: zonas.length > 0,
      dentro: false,
      zonaDentro: null,
      zonaCercana: null,
      distancia: 0,
      alertaEnviada: false
    };

    if (!zonas.length || isNaN(latitud) || isNaN(longitud)) return estado;

    let menor = Number.POSITIVE_INFINITY;

    for (const zona of zonas) {
      const distancia = this.distanciaMetros(latitud, longitud, zona.latitud_centro, zona.longitud_centro);

      if (distancia < menor) {
        menor = distancia;
        estado.zonaCercana = zona;
      }

      if (distancia <= zona.radio_metros) {
        estado.dentro = true;
        estado.zonaDentro = zona;
        estado.zonaCercana = zona;
        estado.distancia = distancia;
        return estado;
      }
    }

    estado.distancia = isNaN(menor) ? 0 : menor;
    return estado;
  }

  /**
   * Evalúa la posición de un adulto mayor y avisa a los cuidadores.
   *
   * El aviso lo manda la Edge Function "evaluar-zona", que guarda el cooldown
   * en la base de datos: así con la app abierta (este camino) y con la app
   * cerrada (servicio nativo) nunca se duplican los avisos.
   *
   * Cadencia:
   *  - al salir de zona: alerta intensa (canal zona-alertas),
   *  - después: actualización de estado cada 10 minutos (zona-estado),
   *  - al volver: aviso de estado.
   */
  async evaluarYNotificar(
    idAdulto: string,
    latitud: number,
    longitud: number
  ): Promise<EstadoZonaSegura | null> {
    if (!idAdulto) return null;

    const zonas = await this.obtenerZonas(idAdulto);
    if (!zonas.length) return null;

    const estado = this.evaluar(zonas, latitud, longitud);
    const antes = this.estadoPrevio(idAdulto);

    if (estado.dentro) {
      if (antes === 'fuera') {
        // Volvió: el servidor cierra la alerta y avisa a los cuidadores
        const r = await this.llamarEvaluarZona(latitud, longitud, idAdulto);
        estado.alertaEnviada = r === 'enviada';
      }
      this.limpiarAlerta(idAdulto);
      this.guardarEstadoPrevio(idAdulto, 'dentro');
      return estado;
    }

    const transicion = antes !== 'fuera';
    if (transicion || this.puedeAlertar(idAdulto)) {
      const r = await this.llamarEvaluarZona(latitud, longitud, idAdulto);

      if (r === 'error') {
        // Servicio no disponible: respaldo local (cooldown en este dispositivo)
        const enviada = await this.enviarAlertaSalida(idAdulto, latitud, longitud, estado);
        if (enviada) this.registrarAlerta(idAdulto);
        estado.alertaEnviada = enviada;
      } else {
        estado.alertaEnviada = r === 'enviada';
        // Mientras siga fuera, esperamos 10 min antes de volver a consultar
        this.registrarAlerta(idAdulto);
      }
    }

    this.guardarEstadoPrevio(idAdulto, 'fuera');
    return estado;
  }

  /**
   * Llama a la Edge Function evaluar-zona.
   *  - 'enviada'  -> correspondía avisar y se envió
   *  - 'sin_aviso'-> fuera de zona pero aún no toca actualizar (cooldown en BD)
   *  - 'error'    -> la función no respondió (usar respaldo local)
   */
  private async llamarEvaluarZona(
    latitud: number,
    longitud: number,
    idAdulto: string
  ): Promise<'enviada' | 'sin_aviso' | 'error'> {
    try {
      const { data, error } = await this.supabase.functions.invoke('evaluar-zona', {
        body: { latitud, longitud, id_usuario: idAdulto }
      });

      if (error) {
        console.warn('evaluar-zona devolvió error:', error?.message || error);
        return 'error';
      }

      const accion = data?.accion;
      return accion === 'primera' || accion === 'actualizacion' || accion === 'volvio'
        ? 'enviada'
        : 'sin_aviso';
    } catch (e) {
      console.warn('No se pudo evaluar la zona en el servidor:', e);
      return 'error';
    }
  }

  private estadoPrevio(idAdulto: string): 'dentro' | 'fuera' | null {
    try {
      const v = localStorage.getItem(CLAVE_ESTADO + idAdulto);
      return v === 'dentro' || v === 'fuera' ? v : null;
    } catch {
      return null;
    }
  }

  private guardarEstadoPrevio(idAdulto: string, estado: 'dentro' | 'fuera'): void {
    try {
      localStorage.setItem(CLAVE_ESTADO + idAdulto, estado);
    } catch { /* sin persistencia */ }
  }

  private async enviarAlertaSalida(
    idAdulto: string,
    latitud: number,
    longitud: number,
    estado: EstadoZonaSegura
  ): Promise<boolean> {
    try {
      const cuidadores = await this.sosService.obtenerCuidadores();
      if (!cuidadores || !cuidadores.length) return false;

      const nombre = (await this.nombreUsuarioActual()) || 'El adulto mayor';
      const zona = estado.zonaCercana;

      const cuerpo = zona
        ? `${nombre} salió de la zona segura "${zona.nombre || zona.direccion_texto || 'sin nombre'}" ` +
          `(a ${Math.round(estado.distancia)} m del centro).`
        : `${nombre} está fuera de todas las zonas seguras.`;

      const mensajeMaps = `https://maps.google.com/?q=${latitud},${longitud}`;

      let enviados = 0;
      for (const cuidador of cuidadores) {
        try {
          const ok = await this.pushService.enviarPushAUsuario(
            cuidador.id,
            'Fuera de zona segura',
            `${cuerpo} Ubicación: ${mensajeMaps}`,
            {
              tipo: 'zona_segura',
              canal: 'zona-alertas',
              latitud: latitud.toString(),
              longitud: longitud.toString(),
              zona: zona?.nombre || ''
            }
          );
          if (ok) enviados++;
        } catch (e) {
          console.error('Error enviando push de zona segura:', e);
        }
      }

      return enviados > 0;
    } catch (e) {
      console.error('Error en alerta de salida de zona segura:', e);
      return false;
    }
  }

  // =====================================================
  // CONTROL DE AVISOS (NO SPAM)
  // =====================================================

  puedeAlertar(idAdulto: string): boolean {
    try {
      const ultima = localStorage.getItem(CLAVE_ALERTA + idAdulto);
      if (!ultima) return true;
      return Date.now() - new Date(ultima).getTime() > ESPERA_ALERTA_MS;
    } catch {
      return true;
    }
  }

  registrarAlerta(idAdulto: string) {
    try {
      localStorage.setItem(CLAVE_ALERTA + idAdulto, new Date().toISOString());
    } catch { /* sin persistencia */ }
  }

  limpiarAlerta(idAdulto: string) {
    try {
      localStorage.removeItem(CLAVE_ALERTA + idAdulto);
    } catch { /* sin persistencia */ }
  }
}

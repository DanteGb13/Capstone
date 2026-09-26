import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { SupabaseService } from '../../supabase/supabase';
import { UbicacionForeground } from '../ubicacion-foreground/ubicacion-foreground';

export interface UbicacionInfo {
  latitud: number;
  longitud: number;
  precision?: number;
  fecha: string;
  direccionTexto?: string;
  enLinea: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class Gps {

  private supabase = this.supabaseService.getClient();

  constructor(
    private supabaseService: SupabaseService
  ) { }


  // =====================================================
  // OBTENER UBICACIÓN ACTUAL DEL DISPOSITIVO
  // =====================================================

  async obtenerUbicacionActualDispositivo(): Promise<{ latitud: number; longitud: number; precision: number }> {
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000
      });

      return {
        latitud: position.coords.latitude,
        longitud: position.coords.longitude,
        precision: position.coords.accuracy || 10
      };
    } catch (error) {
      // Fallback a API de navegador
      return new Promise((resolve) => {
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              resolve({
                latitud: pos.coords.latitude,
                longitud: pos.coords.longitude,
                precision: pos.coords.accuracy || 10
              });
            },
            (err) => {
              console.warn('Geolocation error fallback:', err);
              // Fallback por defecto (Santiago, Chile)
              resolve({
                latitud: -33.4489,
                longitud: -70.6693,
                precision: 25
              });
            },
            { enableHighAccuracy: true, timeout: 10000 }
          );
        } else {
          resolve({
            latitud: -33.4489,
            longitud: -70.6693,
            precision: 25
          });
        }
      });
    }
  }


  // =====================================================
  // REPORTAR Y GUARDAR UBICACIÓN DEL ADULTO MAYOR EN BD
  // =====================================================

  async reportarUbicacionAdulto(idUsuario: string): Promise<UbicacionInfo> {
    const coords = await this.obtenerUbicacionActualDispositivo();
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

    // 4. Reverse geocoding
    try {
      const dir = await this.obtenerDireccionTexto(coords.latitud, coords.longitud);
      info.direccionTexto = dir;
      localStorage.setItem(`gps_ubicacion_${idUsuario}`, JSON.stringify(info));
    } catch (e) {
      // ignore
    }

    return info;
  }


  // =====================================================
  // OBTENER UBICACIÓN DE UN ADULTO MAYOR (PARA EL CUIDADOR)
  // =====================================================

  async obtenerUbicacionAdulto(idUsuario: string, direccionFallback?: any): Promise<UbicacionInfo> {
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
          const dirTexto = await this.obtenerDireccionTexto(lat, lng);
          const info: UbicacionInfo = {
            latitud: lat,
            longitud: lng,
            precision: 15,
            fecha: ubicacionBD.fecha || new Date().toISOString(),
            direccionTexto: dirTexto,
            enLinea: true
          };

          localStorage.setItem(`gps_ubicacion_${idUsuario}`, JSON.stringify(info));
          return info;
        }
      } else if (ubError) {
        console.warn('Nota: Consulta a tabla ubicacion:', ubError.message);
      }
    } catch (err) {
      console.warn('Error consultando tabla ubicacion en Supabase:', err);
    }

    // 2. Si no hay registro en BD, verificar cache en localStorage
    const cached = localStorage.getItem(`gps_ubicacion_${idUsuario}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.latitud && parsed.longitud) {
          if (!parsed.direccionTexto) {
            parsed.direccionTexto = await this.obtenerDireccionTexto(parsed.latitud, parsed.longitud);
          }
          return parsed;
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
        const info: UbicacionInfo = {
          latitud: geocoded.latitud,
          longitud: geocoded.longitud,
          precision: 20,
          fecha: new Date().toISOString(),
          direccionTexto: dirQuery,
          enLinea: true
        };
        localStorage.setItem(`gps_ubicacion_${idUsuario}`, JSON.stringify(info));
        return info;
      }
    }

    // 4. Fallback del dispositivo
    const devicePos = await this.obtenerUbicacionActualDispositivo();
    const info: UbicacionInfo = {
      latitud: devicePos.latitud,
      longitud: devicePos.longitud,
      precision: devicePos.precision,
      fecha: new Date().toISOString(),
      direccionTexto: 'Ubicación reportada por GPS',
      enLinea: true
    };

    try {
      info.direccionTexto = await this.obtenerDireccionTexto(devicePos.latitud, devicePos.longitud);
    } catch (e) {
      // ignore
    }

    localStorage.setItem(`gps_ubicacion_${idUsuario}`, JSON.stringify(info));
    return info;
  }


  // =====================================================
  // REVERSE GEOCODING (COORDENADAS -> DIRECCIÓN TEXTO)
  // =====================================================

  async obtenerDireccionTexto(lat: number, lng: number): Promise<string> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'es'
          }
        }
      );

      if (!response.ok) return 'Ubicación identificada';

      const data = await response.json();
      if (data && data.display_name) {
        const road = data.address?.road || data.address?.pedestrian || '';
        const houseNumber = data.address?.house_number || '';
        const suburb = data.address?.suburb || data.address?.neighbourhood || data.address?.city_district || '';
        const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || '';

        if (road && city) {
          return `${road} ${houseNumber ? houseNumber + ', ' : ''}${suburb ? suburb + ', ' : ''}${city}`.trim();
        }

        return data.display_name.split(',').slice(0, 3).join(', ');
      }
    } catch (error) {
      console.warn('Error reverse geocoding:', error);
    }

    return 'Ubicación identificada';
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

  async verificarPermisosUbicacion(): Promise<{
    ubicacionForeground: boolean;
    ubicacionBackground: boolean;
    notificaciones: boolean;
    todosConcedidos: boolean;
  }> {
    try {
      return await UbicacionForeground.verificarPermisos();
    } catch (error) {
      return {
        ubicacionForeground: false,
        ubicacionBackground: false,
        notificaciones: false,
        todosConcedidos: false
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
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { PuntoRuta } from '../osrm/osrm';
import { haversineMetros } from '../../geo/geo';

export interface PuntoDesplazamiento {
  latitud: number;
  longitud: number;
  fecha: string;
  precisionMetros?: number;
  orden: number;
}

export interface Desplazamiento {
  id: string;
  id_usuario: string;
  fecha_inicio: string;
  fecha_fin?: string;
  distancia_metros: number;
  duracion_segundos: number;
  ruta_geojson?: any;
  activo: boolean;
  puntos?: PuntoDesplazamiento[];
}

@Injectable({
  providedIn: 'root'
})
export class HistorialDesplazamiento {

  private supabaseService = inject(SupabaseService);

  private supabase = this.supabaseService.getClient();


  // =====================================================
  // INICIAR UN NUEVO DESPLAZAMIENTO
  // =====================================================

  async iniciarDesplazamiento(idUsuario: string, puntoInicial: PuntoRuta): Promise<Desplazamiento | null> {
    try {
      const ahora = new Date().toISOString();

      const { data, error } = await this.supabase
        .from('historial_desplazamiento')
        .insert({
          id_usuario: idUsuario,
          fecha_inicio: ahora,
          activo: true
        })
        .select('id')
        .maybeSingle();

      if (error || !data?.id) {
        console.warn('Error creando desplazamiento:', error?.message);
        return null;
      }

      await this.agregarPunto(data.id, puntoInicial);

      return {
        id: data.id,
        id_usuario: idUsuario,
        fecha_inicio: ahora,
        distancia_metros: 0,
        duracion_segundos: 0,
        activo: true,
        puntos: []
      };
    } catch (error) {
      console.error('Error iniciando desplazamiento:', error);
      return null;
    }
  }


  // =====================================================
  // AGREGAR UN PUNTO AL DESPLAZAMIENTO ACTIVO
  // =====================================================

  async agregarPunto(
    idDesplazamiento: string,
    punto: PuntoRuta,
    precision?: number,
    orden?: number
  ): Promise<boolean> {
    try {
      let numeroOrden = orden;

      if (numeroOrden == null) {
        const { count } = await this.supabase
          .from('historial_punto')
          .select('id', { count: 'exact', head: true })
          .eq('id_desplazamiento', idDesplazamiento);

        numeroOrden = (count || 0) + 1;
      }

      const { error } = await this.supabase
        .from('historial_punto')
        .insert({
          id_desplazamiento: idDesplazamiento,
          latitud: punto.latitud,
          longitud: punto.longitud,
          fecha: new Date().toISOString(),
          precision_metros: precision || null,
          orden: numeroOrden
        });

      if (error) {
        console.warn('Error insertando punto:', error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error insertando punto:', error);
      return false;
    }
  }


  // =====================================================
  // FINALIZAR DESPLAZAMIENTO
  // =====================================================

  async finalizarDesplazamiento(idDesplazamiento: string): Promise<Desplazamiento | null> {
    try {
      const fila = await this.obtenerDesplazamiento(idDesplazamiento);

      if (!fila) return null;

      const puntos = fila.puntos || [];
      const fin = Date.now();
      const inicio = Date.parse(fila.fecha_inicio);

      const datos: any = {
        fecha_fin: new Date(fin).toISOString(),
        activo: false
      };

      if (Number.isFinite(inicio)) {
        datos.duracion_segundos = Math.max(Math.round((fin - inicio) / 1000), 0);
      }

      if (puntos.length >= 2) {
        datos.distancia_metros = this.distanciaRecorrida(puntos);
        datos.ruta_geojson = {
          type: 'LineString',
          coordinates: puntos.map((p) => [p.longitud, p.latitud])
        };
      }

      await this.supabase
        .from('historial_desplazamiento')
        .update(datos)
        .eq('id', idDesplazamiento);

      return await this.obtenerDesplazamiento(idDesplazamiento);
    } catch (error) {
      console.error('Error finalizando desplazamiento:', error);
      return null;
    }
  }


  private distanciaRecorrida(puntos: PuntoDesplazamiento[]): number {
    let total = 0;

    for (let i = 1; i < puntos.length; i++) {
      const anterior = puntos[i - 1];
      const actual = puntos[i];

      const tsAnterior = Date.parse(anterior.fecha);
      const tsActual = Date.parse(actual.fecha);

      const huecoSegundos =
        Number.isFinite(tsAnterior) && Number.isFinite(tsActual)
          ? Math.max((tsActual - tsAnterior) / 1000, 1)
          : 1;

      const tramo = haversineMetros(
        anterior.latitud,
        anterior.longitud,
        actual.latitud,
        actual.longitud
      );

      total += Math.min(tramo, 30 * huecoSegundos);
    }

    return Math.round(total);
  }


  // =====================================================
  // OBTENER DESPLAZAMIENTO POR ID (CON PUNTOS)
  // =====================================================

  async obtenerDesplazamiento(id: string): Promise<Desplazamiento | null> {
    try {
      const { data, error } = await this.supabase
        .from('historial_desplazamiento')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      const puntos = await this.obtenerPuntos(id);

      return {
        ...data,
        puntos
      };
    } catch (error) {
      console.error('Error obteniendo desplazamiento:', error);
      return null;
    }
  }


  // =====================================================
  // OBTENER HISTORIAL DE DESPLAZAMIENTOS DE UN USUARIO
  // =====================================================

  async obtenerHistorial(idUsuario: string, limite: number = 50, offset: number = 0): Promise<Desplazamiento[]> {
    try {
      const { data, error } = await this.supabase
        .from('historial_desplazamiento')
        .select('*')
        .eq('id_usuario', idUsuario)
        .order('fecha_inicio', { ascending: false })
        .range(offset, offset + limite - 1);

      if (error || !data) {
        console.warn('Error obteniendo historial:', error?.message);
        return [];
      }

      return data.map(d => ({
        ...d,
        puntos: []
      }));
    } catch (error) {
      console.error('Error obteniendo historial:', error);
      return [];
    }
  }


  // =====================================================
  // OBTENER DESPLAZAMIENTO ACTIVO DE UN USUARIO
  // =====================================================

  async obtenerDesplazamientoActivo(idUsuario: string): Promise<Desplazamiento | null> {
    try {
      const { data, error } = await this.supabase
        .from('historial_desplazamiento')
        .select('*')
        .eq('id_usuario', idUsuario)
        .eq('activo', true)
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      const puntos = await this.obtenerPuntos(data.id);

      return {
        ...data,
        puntos
      };
    } catch (error) {
      console.error('Error obteniendo desplazamiento activo:', error);
      return null;
    }
  }


  // =====================================================
  // OBTENER PUNTOS DE UN DESPLAZAMIENTO
  // =====================================================

  private async obtenerPuntos(idDesplazamiento: string): Promise<PuntoDesplazamiento[]> {
    try {
      const { data, error } = await this.supabase
        .from('historial_punto')
        .select('*')
        .eq('id_desplazamiento', idDesplazamiento)
        .order('orden', { ascending: true });

      if (error || !data) {
        return [];
      }

      return data.map(p => ({
        latitud: p.latitud,
        longitud: p.longitud,
        fecha: p.fecha,
        precisionMetros: p.precision_metros,
        orden: p.orden
      }));
    } catch (error) {
      console.error('Error obteniendo puntos:', error);
      return [];
    }
  }


  // =====================================================
  // ELIMINAR DESPLAZAMIENTO
  // =====================================================

  async eliminarDesplazamiento(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('historial_desplazamiento')
        .delete()
        .eq('id', id);

      return !error;
    } catch (error) {
      console.error('Error eliminando desplazamiento:', error);
      return false;
    }
  }


  // =====================================================
  // ELIMINAR HISTORIAL COMPLETO DE UN USUARIO
  // =====================================================

  async eliminarHistorialCompleto(idUsuario: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('historial_desplazamiento')
        .delete()
        .eq('id_usuario', idUsuario);

      return !error;
    } catch (error) {
      console.error('Error eliminando historial:', error);
      return false;
    }
  }


  // =====================================================
  // OBTENER ESTADÍSTICAS DEL HISTORIAL
  // =====================================================

  async obtenerEstadisticas(idUsuario: string): Promise<{
    totalDesplazamientos: number;
    distanciaTotalMetros: number;
    tiempoTotalSegundos: number;
  }> {
    try {
      const { data, error } = await this.supabase
        .from('historial_desplazamiento')
        .select('distancia_metros, duracion_segundos')
        .eq('id_usuario', idUsuario)
        .eq('activo', false);

      if (error || !data) {
        return { totalDesplazamientos: 0, distanciaTotalMetros: 0, tiempoTotalSegundos: 0 };
      }

      return {
        totalDesplazamientos: data.length,
        distanciaTotalMetros: data.reduce((sum, d) => sum + (d.distancia_metros || 0), 0),
        tiempoTotalSegundos: data.reduce((sum, d) => sum + (d.duracion_segundos || 0), 0)
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      return { totalDesplazamientos: 0, distanciaTotalMetros: 0, tiempoTotalSegundos: 0 };
    }
  }
}

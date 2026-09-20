import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { Osrm, PuntoRuta } from '../osrm/osrm';

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

  private supabase = this.supabaseService.getClient();

  constructor(
    private supabaseService: SupabaseService,
    private osrmService: Osrm
  ) { }


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

  async agregarPunto(idDesplazamiento: string, punto: PuntoRuta, precision?: number): Promise<boolean> {
    try {
      const { count } = await this.supabase
        .from('historial_punto')
        .select('id', { count: 'exact', head: true })
        .eq('id_desplazamiento', idDesplazamiento);

      const orden = (count || 0) + 1;

      const { error } = await this.supabase
        .from('historial_punto')
        .insert({
          id_desplazamiento: idDesplazamiento,
          latitud: punto.latitud,
          longitud: punto.longitud,
          fecha: new Date().toISOString(),
          precision_metros: precision || null,
          orden
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
  // FINALIZAR DESPLAZAMIENTO (calcular ruta con OSRM)
  // =====================================================

  async finalizarDesplazamiento(idDesplazamiento: string): Promise<Desplazamiento | null> {
    try {
      const puntos = await this.obtenerPuntos(idDesplazamiento);

      if (puntos.length < 2) {
        await this.supabase
          .from('historial_desplazamiento')
          .update({
            fecha_fin: new Date().toISOString(),
            activo: false
          })
          .eq('id', idDesplazamiento);

        return await this.obtenerDesplazamiento(idDesplazamiento);
      }

      const rutaPuntos: PuntoRuta[] = puntos.map(p => ({
        latitud: p.latitud,
        longitud: p.longitud
      }));

      const rutaCalculada = await this.osrmService.reconstruirRuta(rutaPuntos);

      const updateData: any = {
        fecha_fin: new Date().toISOString(),
        activo: false
      };

      if (rutaCalculada) {
        updateData.distancia_metros = rutaCalculada.distanciaMetros;
        updateData.duracion_segundos = rutaCalculada.duracionSegundos;
        updateData.ruta_geojson = rutaCalculada.geometria;
      }

      await this.supabase
        .from('historial_desplazamiento')
        .update(updateData)
        .eq('id', idDesplazamiento);

      return await this.obtenerDesplazamiento(idDesplazamiento);
    } catch (error) {
      console.error('Error finalizando desplazamiento:', error);
      return null;
    }
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

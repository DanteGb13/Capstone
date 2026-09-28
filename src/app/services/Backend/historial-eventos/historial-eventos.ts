import { Injectable, inject } from '@angular/core';

import { SupabaseService } from '../../supabase/supabase';


export type TipoEventoHistorial =
  | 'sos'
  | 'desplazamiento'
  | 'zona'
  | 'recordatorio'
  | 'salud'
  | 'manual'
  | 'llamada'
  | 'nota'
  | 'ubicacion';


export interface EventoHistorialFila {
  id: string;
  id_usuario: string;
  tipo: TipoEventoHistorial;
  titulo: string;
  detalle: string | null;
  fecha: string;
  id_origen: string | null;
}


export interface EventoManualEntrada {
  id_usuario: string;
  tipo?: Extract<TipoEventoHistorial, 'manual' | 'llamada' | 'nota' | 'ubicacion'>;
  titulo: string;
  detalle?: string | null;
  fecha?: string;
  id_origen?: string | null;
}


@Injectable({
  providedIn: 'root'
})
export class HistorialEventos {

  private supabaseService = inject(SupabaseService);

  private supabase = this.supabaseService.getClient();


  // =====================================================
  // LEER EL HISTORIAL DE UN ADULTO MAYOR
  // =====================================================

  /**
   * Lee la vista `historial_eventos`, que une desplazamientos, SOS, alertas
   * de zona, recordatorios, solicitudes de salud y eventos manuales.
   *
   * Las RLS de la vista devuelven sólo los eventos de los adultos vinculados
   * al cuidador que consulta (o los propios, si consulta el adulto mayor).
   */
  async obtenerEventos(
    idUsuario: string,
    limite: number = 200,
    offset: number = 0
  ): Promise<EventoHistorialFila[]> {
    if (!idUsuario) return [];

    try {
      const { data, error } = await this.supabase
        .from('historial_eventos')
        .select('id, id_usuario, tipo, titulo, detalle, fecha, id_origen')
        .eq('id_usuario', idUsuario)
        .order('fecha', { ascending: false })
        .range(offset, offset + limite - 1);

      if (error) {
        console.warn('Error obteniendo el historial:', error.message);
        return [];
      }

      return (data || []) as EventoHistorialFila[];
    } catch (error) {
      console.error('Error obteniendo el historial:', error);
      return [];
    }
  }


  // =====================================================
  // ESCRIBIR UN EVENTO MANUAL
  // =====================================================

  /**
   * Registra un evento que no tiene tabla propia (llamada hecha desde la
   * app, nota del cuidador, ubicación fijada).
   */
  async registrarEvento(
    evento: EventoManualEntrada
  ): Promise<EventoHistorialFila | null> {
    try {
      const { data, error } = await this.supabase
        .from('historial_evento')
        .insert({
          id_usuario: evento.id_usuario,
          id_origen: evento.id_origen || null,
          tipo: evento.tipo || 'manual',
          titulo: evento.titulo,
          detalle: evento.detalle || null,
          fecha: evento.fecha || new Date().toISOString()
        })
        .select('id, id_usuario, tipo, titulo, detalle, fecha, id_origen')
        .maybeSingle();

      if (error || !data) {
        console.warn('Error registrando el evento:', error?.message);
        return null;
      }

      return data as EventoHistorialFila;
    } catch (error) {
      console.error('Error registrando el evento:', error);
      return null;
    }
  }

}

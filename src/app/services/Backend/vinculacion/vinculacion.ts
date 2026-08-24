import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';



@Injectable({
  providedIn: 'root'
})

export class Vinculacion {
        constructor(
            private supabaseService: SupabaseService
        ) { }
    
        // =====================================================
      // CLIENTE SUPABASE
      // =====================================================
    
      private get supabase() {
        return this.supabaseService.getClient();
      }
    
    
      // =====================================================
      // ADULTO MAYOR
      // GENERAR CÓDIGO DE VINCULACIÓN
      // =====================================================
    
      async generarCodigo() {
    
        const {
          data: { user },
          error: userError
        } = await this.supabase.auth.getUser();
    
        if (userError) {
          throw userError;
        }
    
        if (!user) {
          throw new Error('Usuario no autenticado');
        }
    
    
        // Generar código aleatorio
    
        const caracteres =
          'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    
        let codigo = 'SC-';
    
        for (let i = 0; i < 6; i++) {
    
          codigo += caracteres.charAt(
            Math.floor(
              Math.random() * caracteres.length
            )
          );
    
        }
    
    
        // Desactivar códigos anteriores
    
        const { error: updateError } =
          await this.supabase
            .from('codigo_vinculacion')
            .update({
              activo: false
            })
            .eq('id_usuario', user.id);
    
        if (updateError) {
          throw updateError;
        }
    
    
        // Crear nuevo código
    
        const fechaExpiracion =
          new Date(
            Date.now() + 15 * 60 * 1000
          ).toISOString();
    
    
        const {
          data,
          error
        } = await this.supabase
          .from('codigo_vinculacion')
          .insert({
            id_usuario: user.id,
            codigo: codigo,
            fecha_expiracion: fechaExpiracion,
            activo: true
          })
          .select()
          .single();
    
    
        if (error) {
          throw error;
        }
    
    
        return data;
      }
    
    
      // =====================================================
      // BUSCAR CÓDIGO
      // =====================================================
    
      async buscarCodigo(codigo: string) {
    
        const {
          data,
          error
        } = await this.supabase
          .from('codigo_vinculacion')
          .select(`
            id,
            id_usuario,
            codigo,
            fecha_expiracion,
            activo,
            usuario:id_usuario (
              id,
              nombre,
              apellidopa,
              apellidoma
            )
          `)
          .eq('codigo', codigo)
          .eq('activo', true)
          .maybeSingle();
    
    
        if (error) {
          throw error;
        }
    
    
        if (!data) {
          throw new Error(
            'Código inválido o expirado.'
          );
        }
    
    
        // Comprobar expiración
    
        if (
          data.fecha_expiracion &&
          new Date(data.fecha_expiracion) < new Date()
        ) {
    
          throw new Error(
            'El código ha expirado.'
          );
    
        }
    
    
        return data;
      }
    
    
      // =====================================================
      // OBTENER ID DEL CUIDADOR
      // =====================================================
    
      async obtenerCuidadorActual() {
    
        const {
          data: { user },
          error: userError
        } = await this.supabase.auth.getUser();
    
        if (userError) {
          throw userError;
        }
    
        if (!user) {
          throw new Error(
            'Usuario no autenticado'
          );
        }
    
    
        const {
          data,
          error
        } = await this.supabase
          .from('cuidador')
          .select('id')
          .eq('id_usuario', user.id)
          .maybeSingle();
    
    
        if (error) {
          throw error;
        }
    
    
        if (!data) {
          throw new Error(
            'La cuenta no está registrada como cuidador.'
          );
        }
    
    
        return data.id;
      }
    
    
      // =====================================================
      // CREAR SOLICITUD DE VINCULACIÓN
      // =====================================================
    
      async solicitarVinculacion(
        idUsuario: string
      ) {
    
        const idCuidador =
          await this.obtenerCuidadorActual();
    
    
        const {
          data,
          error
        } = await this.supabase
          .from('solicitud_vinculacion')
          .insert({
            id_cuidador: idCuidador,
            id_usuario: idUsuario
          })
          .select()
          .single();
    
    
        if (error) {
          throw error;
        }
    
    
        return data;
      }
    
    
      // =====================================================
      // OBTENER SOLICITUDES DEL ADULTO MAYOR
      // =====================================================
    
      async obtenerSolicitudes() {
    
        const {
          data: { user },
          error: userError
        } = await this.supabase.auth.getUser();
    
    
        if (userError) {
          throw userError;
        }
    
    
        if (!user) {
          throw new Error(
            'Usuario no autenticado'
          );
        }
    
    
        const {
          data,
          error
        } = await this.supabase
          .from('solicitud_vinculacion')
          .select(`
            *,
            cuidador:id_cuidador (
              id,
              id_usuario
            )
          `)
          .eq('id_usuario', user.id)
          .eq('estado', 'pendiente');
    
    
        if (error) {
          throw error;
        }
    
    
        return data ?? [];
      }
    
    
      // =====================================================
      // ACEPTAR SOLICITUD
      // =====================================================
    
      async aceptarSolicitud(
        idSolicitud: string
      ) {
    
        const {
          error
        } = await this.supabase.rpc(
          'aceptar_solicitud_vinculacion',
          {
            p_solicitud_id: idSolicitud
          }
        );
    
    
        if (error) {
          throw error;
        }
    
    
        return true;
      }
    
    
      // =====================================================
      // RECHAZAR SOLICITUD
      // =====================================================
    
      async rechazarSolicitud(
        idSolicitud: string
      ) {
    
        const {
          error
        } = await this.supabase
          .from('solicitud_vinculacion')
          .update({
            estado: 'rechazada',
            fecha_respuesta: new Date().toISOString()
          })
          .eq('id', idSolicitud);
    
    
        if (error) {
          throw error;
        }
    
    
        return true;
    }
    

}
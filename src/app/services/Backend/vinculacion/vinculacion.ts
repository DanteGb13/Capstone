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
    
        if (userError || !user) {
          throw new Error('Usuario no autenticado');
        }
    
        let solicitudes: any[] = [];
    
        const { data, error } = await this.supabase
          .from('solicitud_vinculacion')
          .select(`
            *,
            cuidador:id_cuidador (
              id,
              id_usuario,
              usuario:id_usuario (
                id,
                nombre,
                apellidopa,
                apellidoma,
                telefono
              )
            )
          `)
          .eq('id_usuario', user.id)
          .eq('estado', 'pendiente');
    
        if (error) {
          // Fallback simple si la relación anidada falla
          const { data: rawData, error: rawError } = await this.supabase
            .from('solicitud_vinculacion')
            .select('*')
            .eq('id_usuario', user.id)
            .eq('estado', 'pendiente');
    
          if (rawError) throw rawError;
          solicitudes = rawData ?? [];
        } else {
          solicitudes = data ?? [];
        }
    
        // Enriquecer datos de cuidador si faltan
        for (const sol of solicitudes) {
          if (!sol.cuidador?.usuario && sol.id_cuidador) {
            const { data: cuidadorData } = await this.supabase
              .from('cuidador')
              .select('id, id_usuario')
              .eq('id', sol.id_cuidador)
              .maybeSingle();
    
            if (cuidadorData?.id_usuario) {
              const { data: usuarioData } = await this.supabase
                .from('usuario')
                .select('id, nombre, apellidopa, apellidoma, telefono')
                .eq('id', cuidadorData.id_usuario)
                .maybeSingle();
    
              sol.cuidador = {
                ...cuidadorData,
                usuario: usuarioData
              };
            }
          }
        }
    
        return solicitudes;
      }
    
    
      // =====================================================
      // OBTENER CUIDADORES VINCULADOS (PARA EL ADULTO MAYOR)
      // =====================================================
    
      async obtenerCuidadoresVinculados() {
    
        const {
          data: { user },
          error: userError
        } = await this.supabase.auth.getUser();
    
        if (userError || !user) {
          return [];
        }
    
        const cuidadoresMap = new Map<string, any>();
    
        // 1. Consultar solicitudes aceptadas
        const { data: solicitudes } = await this.supabase
          .from('solicitud_vinculacion')
          .select('id, id_cuidador, id_usuario, estado, fecha_respuesta')
          .eq('id_usuario', user.id)
          .eq('estado', 'aceptada');
    
        if (solicitudes && solicitudes.length > 0) {
          for (const s of solicitudes) {
            if (s.id_cuidador) {
              cuidadoresMap.set(s.id_cuidador, {
                id: s.id,
                id_cuidador: s.id_cuidador,
                id_usuario: s.id_usuario,
                estado: s.estado,
                fecha_respuesta: s.fecha_respuesta
              });
            }
          }
        }
    
        // 2. Consultar tabla cuidador_usuario
        try {
          const { data: cuData } = await this.supabase
            .from('cuidador_usuario')
            .select('id, id_cuidador, id_usuario')
            .eq('id_usuario', user.id);
    
          if (cuData && cuData.length > 0) {
            for (const cu of cuData) {
              if (cu.id_cuidador && !cuidadoresMap.has(cu.id_cuidador)) {
                cuidadoresMap.set(cu.id_cuidador, {
                  id: cu.id,
                  id_cuidador: cu.id_cuidador,
                  id_usuario: cu.id_usuario,
                  estado: 'aceptada'
                });
              }
            }
          }
        } catch (e) {
          // ignore
        }
    
        const lista = Array.from(cuidadoresMap.values());
    
        // 3. Enriquecer datos completos del cuidador desde public.cuidador y public.usuario
        for (const item of lista) {
          if (item.id_cuidador) {
            const { data: cuidadorRow } = await this.supabase
              .from('cuidador')
              .select('id, id_usuario')
              .eq('id', item.id_cuidador)
              .maybeSingle();
    
            const idUsuarioCuidador = cuidadorRow?.id_usuario;
    
            if (idUsuarioCuidador) {
              const { data: usuarioData } = await this.supabase
                .from('usuario')
                .select('id, nombre, apellidopa, apellidoma, telefono, correo, rut')
                .eq('id', idUsuarioCuidador)
                .maybeSingle();
    
              item.cuidador = {
                id: item.id_cuidador,
                id_usuario: idUsuarioCuidador,
                usuario: usuarioData
              };
            }
          }
        }
    
        return lista;
      }
    
    
      // =====================================================
      // OBTENER ADULTOS A CARGO (PARA EL CUIDADOR)
      // =====================================================
    
      async obtenerAdultosACargo() {
    
        const idCuidador =
          await this.obtenerCuidadorActual();
    
        if (!idCuidador) {
          return [];
        }
    
        const adultosMap = new Map<string, any>();
    
        // 1. Consultar solicitudes aceptadas
        const { data: solicitudes } = await this.supabase
          .from('solicitud_vinculacion')
          .select('id, id_usuario, id_cuidador, estado, fecha_solicitud, fecha_respuesta')
          .eq('id_cuidador', idCuidador)
          .eq('estado', 'aceptada');
    
        if (solicitudes && solicitudes.length > 0) {
          for (const s of solicitudes) {
            if (s.id_usuario) {
              adultosMap.set(s.id_usuario, {
                id: s.id,
                id_usuario: s.id_usuario,
                id_cuidador: s.id_cuidador,
                estado: s.estado,
                fecha_solicitud: s.fecha_solicitud,
                fecha_respuesta: s.fecha_respuesta
              });
            }
          }
        }
    
        // 2. Consultar tabla cuidador_usuario
        try {
          const { data: cuData } = await this.supabase
            .from('cuidador_usuario')
            .select('id, id_cuidador, id_usuario')
            .eq('id_cuidador', idCuidador);
    
          if (cuData && cuData.length > 0) {
            for (const cu of cuData) {
              if (cu.id_usuario && !adultosMap.has(cu.id_usuario)) {
                adultosMap.set(cu.id_usuario, {
                  id: cu.id,
                  id_usuario: cu.id_usuario,
                  id_cuidador: cu.id_cuidador,
                  estado: 'aceptada'
                });
              }
            }
          }
        } catch (e) {
          // ignore
        }
    
        const lista = Array.from(adultosMap.values());
    
        // 3. Enriquecer datos completos del adulto mayor desde public.usuario y public.direccion
        for (const item of lista) {
          if (item.id_usuario) {
            const { data: usuarioData } = await this.supabase
              .from('usuario')
              .select(`
                id,
                nombre,
                apellidopa,
                apellidoma,
                telefono,
                correo,
                rut,
                fecha_nacimiento,
                id_ubicación,
                direccion:id_direccion (
                  id,
                  region,
                  comuna,
                  calle,
                  numero
                )
              `)
              .eq('id', item.id_usuario)
              .maybeSingle();
    
            if (usuarioData) {
              item.adulto_mayor = usuarioData;
            }
          }
        }
    
        return lista;
      }
    
    
      // =====================================================
      // ACEPTAR SOLICITUD
      // =====================================================
    
      async aceptarSolicitud(
        idSolicitud: string
      ) {
    
        // Obtener datos de la solicitud
        const { data: solData } = await this.supabase
          .from('solicitud_vinculacion')
          .select('id, id_cuidador, id_usuario')
          .eq('id', idSolicitud)
          .maybeSingle();
    
        // Intentar RPC
        try {
          await this.supabase.rpc(
            'aceptar_solicitud_vinculacion',
            {
              p_solicitud_id: idSolicitud
            }
          );
        } catch (e) {
          // fallback
        }
    
        // Asegurar actualización de estado en solicitud_vinculacion
        await this.supabase
          .from('solicitud_vinculacion')
          .update({
            estado: 'aceptada',
            fecha_respuesta: new Date().toISOString()
          })
          .eq('id', idSolicitud);
    
        // Registrar en tabla cuidador_usuario si no existe
        if (solData?.id_cuidador && solData?.id_usuario) {
          try {
            await this.supabase
              .from('cuidador_usuario')
              .insert({
                id_cuidador: solData.id_cuidador,
                id_usuario: solData.id_usuario
              });
          } catch (err) {
            // ignore duplicate
          }
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
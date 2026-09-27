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

        // Igual que en el lado del cuidador: manda cuidador_usuario. Una
        // solicitud aceptada sin fila en cuidador_usuario es residuo de una
        // desvinculación y no debe seguir apareciendo en la lista.
        const { data: solicitudes } = await this.supabase
          .from('solicitud_vinculacion')
          .select('id, id_cuidador, id_usuario, estado, fecha_respuesta')
          .eq('id_usuario', user.id)
          .eq('estado', 'aceptada');

        let filasVinculo: any[] = [];
        try {
          const { data: cuData } = await this.supabase
            .from('cuidador_usuario')
            .select('id, id_cuidador, id_usuario')
            .eq('id_usuario', user.id);

          filasVinculo = cuData || [];

          if (filasVinculo.length > 0) {
            for (const cu of filasVinculo) {
              if (cu.id_cuidador) {
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

        const solicitudesHuerfanas = (solicitudes || []).filter(
          s => !s.id_cuidador || !filasVinculo.some(cu => cu.id_cuidador === s.id_cuidador)
        );

        if (solicitudesHuerfanas.length > 0) {
          console.warn(
            'Cuidadores con solicitud aceptada pero sin vínculo (omitidos):',
            solicitudesHuerfanas.length
          );
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

        // 1+2. Consultar solicitudes y cuidador_usuario en PARALELO
        const [solRes, cuRes] = await Promise.all([
          this.supabase
            .from('solicitud_vinculacion')
            .select('id, id_usuario, id_cuidador, estado, fecha_solicitud, fecha_respuesta')
            .eq('id_cuidador', idCuidador)
            .eq('estado', 'aceptada'),
          this.supabase
            .from('cuidador_usuario')
            .select('id, id_cuidador, id_usuario')
            .eq('id_cuidador', idCuidador)
        ]);

        // La fuente de verdad del vínculo es cuidador_usuario: es la tabla que
        // usan las políticas de acceso del resto de la app (zonas seguras,
        // contactos de emergencia, etc.). Las solicitudes aceptadas que no
        // tienen fila en cuidador_usuario son residuo de una desvinculación
        // (el caregiver no tiene permiso para actualizarlas) y no se listan.
        const solicitudes = solRes.data;
        const solicitudesHuerfanas = (solicitudes || []).filter(
          s => !s.id_usuario || !(cuRes.data || []).some(cu => cu.id_usuario === s.id_usuario)
        );

        if (solicitudesHuerfanas.length > 0) {
          console.warn(
            'Solicitudes aceptadas sin vínculo en cuidador_usuario (omitidas):',
            solicitudesHuerfanas.length
          );
        }

        const cuData = cuRes.data;
        if (cuData && cuData.length > 0) {
          for (const cu of cuData) {
            if (cu.id_usuario) {
              adultosMap.set(cu.id_usuario, {
                id: cu.id,
                id_usuario: cu.id_usuario,
                id_cuidador: cu.id_cuidador,
                estado: 'aceptada'
              });
            }
          }
        }

        const lista = Array.from(adultosMap.values());

        if (lista.length === 0) {
          return lista;
        }

        // 3. Obtener TODOS los usuarios en UNA sola consulta (batch)
        const idsUsuarios = lista.map(item => item.id_usuario).filter(Boolean);

        const { data: usuariosData } = await this.supabase
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
            ultimo_visto,
            direccion:id_direccion (
              id,
              region,
              comuna,
              calle,
              numero
            )
          `)
          .in('id', idsUsuarios);

        // Asignar datos a cada item
        const usuariosMap = new Map<string, any>();
        if (usuariosData) {
          for (const u of usuariosData as any[]) {
            usuariosMap.set(u.id as string, u);
          }
        }

        const completa: any[] = [];

        for (const item of lista) {
          const u = usuariosMap.get(item.id_usuario);
          if (u) {
            item.adulto_mayor = u;
            completa.push(item);
          }
        }

        // Si el vínculo quedó huérfano (la persona ya no se cuida o su fila de
        // usuario ya no es visible) la tarjeta se renderizaría sin nombre ni datos:
        // un "fragmento" de alguien que ya fue eliminado. Se descarta de la lista.
        if (Array.isArray(usuariosData)) {
          if (completa.length !== lista.length) {
            console.warn(
              'Vínculos ignorados por no tener datos de usuario:',
              lista.length - completa.length
            );
          }
          return completa;
        }

        // La consulta falló: se devuelve la lista sin filtrar para no vaciar el menú.
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


      // =====================================================
      // DESVINCULAR (ELIMINAR VINCULACIÓN)
      // =====================================================

      async desvincular(
        idCuidador: string,
        idUsuario: string
      ): Promise<boolean> {

        if (!idCuidador || !idUsuario) {
          throw new Error('Faltan datos para desvincular.');
        }

        let ultimoError = '';

        // El vínculo real es la fila de cuidador_usuario (es la tabla que usan
        // las políticas de acceso del resto de la app). Se borra y se verifica.
        // El estado de la solicitud es solo informativo: hoy el cuidador no
        // tiene permiso de UPDATE sobre solicitud_vinculacion, así que su
        // fallo no debe impedimento desvincular.
        for (let intento = 0; intento < 2; intento++) {

          const { error: errorCU } = await this.supabase
            .from('cuidador_usuario')
            .delete()
            .eq('id_cuidador', idCuidador)
            .eq('id_usuario', idUsuario);

          if (errorCU) {
            ultimoError = errorCU.message;
            continue;
          }

          await this.supabase
            .from('solicitud_vinculacion')
            .update({
              estado: 'rechazada',
              fecha_respuesta: new Date().toISOString()
            })
            .eq('id_cuidador', idCuidador)
            .eq('id_usuario', idUsuario)
            .eq('estado', 'aceptada');

          // La confirmación se consulta justo después de escribir, por lo que
          // puede todavía devolver datos antiguos. Se reintenta antes de asumir
          // que el borrado falló.
          for (const espera of [0, 500, 1500]) {

            if (espera > 0) {
              await new Promise(resolver => setTimeout(resolver, espera));
            }

            const restantes = await this.contarVinculosRestantes(idCuidador, idUsuario);

            if (restantes === 0) {
              return true;
            }
          }

          ultimoError = 'Quedó un registro del vínculo sin eliminar.';
        }

        throw new Error(
          'No se pudo completar la desvinculación. ' +
          (ultimoError || 'Verifica tu conexión y permisos.')
        );
      }

      private async contarVinculosRestantes(
        idCuidador: string,
        idUsuario: string
      ): Promise<number> {

        const cuRes = await this.supabase
          .from('cuidador_usuario')
          .select('id')
          .eq('id_cuidador', idCuidador)
          .eq('id_usuario', idUsuario);

        if (cuRes.error) {
          throw new Error(cuRes.error.message);
        }

        return cuRes.data?.length ?? 0;
      }

    }
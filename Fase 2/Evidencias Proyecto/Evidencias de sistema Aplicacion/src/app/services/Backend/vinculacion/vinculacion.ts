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
    
        /**
         * `getSession()` y no `getUser()`.
         *
         * `getUser()` NO es local: va al servidor de autenticación a validar el
         * token, y ahí se ejecutan cinco consultas (users, sessions,
         * identities, mfa_factors y mfa_amr_claims). Este método está en el
         * camino del sondeo del panel del cuidador, así que se llamaba en cada
         * pasada, y en la base de este proyecto se contaron unas 40.000
         * invocaciones de `getUser()` en 43 días.
         *
         * `getSession()` lee la sesión que el cliente ya tiene en memoria: en el
         * caso normal no genera ningún viaje de red, y sigue siendo la fuente
         * correcta tras un cambio de cuenta porque siempre refleja la sesión
         * activa, sin necesidad de caché ni invalidación.
         *
         * No baja la seguridad: el id es el del propio llamador en ambos casos,
         * y todas las consultas de este servicio siguen gobernadas por la RLS.
         */
        const {
          data: { session },
          error: sessionError
        } = await this.supabase.auth.getSession();
    
        if (sessionError) {
          throw sessionError;
        }
    
        const user = session?.user;
    
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
    
        // Enriquecer datos de cuidador si faltan.
        //
        // ANTES: un bucle que hacía 2 consultas POR CADA solicitud (cuidador y
        // luego usuario). Con 3 solicitudes pendientes eran 6 viajes a la base,
        // y esto corre en cada sondeo del panel, o sea cada 30 segundos.
        //
        // AHORA: se juntan todos los ids y se resuelven con dos consultas en
        // total, sin importar cuántas solicitudes haya. Un panel abierto todo
        // el día pasa de ~1700 consultas/día a 2 por sondeo.
        const idsCuidadorFaltantes = [
          ...new Set(
            solicitudes
              .filter((s: any) => !s.cuidador?.usuario && s.id_cuidador)
              .map((s: any) => s.id_cuidador)
          )
        ] as string[];

        if (idsCuidadorFaltantes.length > 0) {
          const mapaCuidador = await this.cuidadoresPorId(idsCuidadorFaltantes);
          const idsUsuario = [...new Set(
            [...mapaCuidador.values()].map((c) => c.id_usuario).filter(Boolean)
          )] as string[];

          const mapaUsuario = await this.usuariosPorId(idsUsuario);

          for (const sol of solicitudes as any[]) {
            if (sol.cuidador?.usuario || !sol.id_cuidador) continue;

            const cuidador = mapaCuidador.get(sol.id_cuidador);
            if (!cuidador?.id_usuario) continue;

            sol.cuidador = {
              ...cuidador,
              usuario: mapaUsuario.get(cuidador.id_usuario) ?? null
            };
          }
        }

        return solicitudes;
      }

    /**
     * Varios cuidadores en UNA consulta.
     *
     * Existe para eliminar los bucles N+1 de esta pantalla. Antes se consultaba
     * un cuidador por solicitud, y cada consulta es un viaje de red más un
     * registro de log en Supabase.
     */
    private async cuidadoresPorId(ids: string[]): Promise<Map<string, any>> {
      const mapa = new Map<string, any>();
      if (ids.length === 0) return mapa;

      try {
        const { data, error } = await this.supabase
          .from('cuidador')
          .select('id, id_usuario')
          .in('id', ids);

        if (error) throw error;
        for (const c of (data ?? []) as any[]) mapa.set(c.id, c);
      } catch (e) {
        console.warn('No se pudieron leer los cuidadores:', e);
      }

      return mapa;
    }

    /** Varios usuarios en UNA consulta (mismo motivo que `cuidadoresPorId`). */
    private async usuariosPorId(
      ids: string[],
      columnas = 'id, nombre, apellidopa, apellidoma, telefono'
    ): Promise<Map<string, any>> {
      const mapa = new Map<string, any>();
      if (ids.length === 0) return mapa;

      try {
        const { data, error } = await this.supabase
          .from('usuario')
          .select(columnas)
          .in('id', ids);

        if (error) throw error;
        for (const u of (data ?? []) as any[]) mapa.set(u.id, u);
      } catch (e) {
        console.warn('No se pudieron leer los usuarios:', e);
      }

      return mapa;
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

        // 3. Enriquecer datos completos del cuidador.
        //
        // Igual que en obtenerSolicitudes: antes esto consultaba cuidador y
        // usuario uno por uno dentro de un bucle (2 viajes por cada cuidador,
        // en cada sondeo del panel). Ahora son 2 consultas en total.
        if (lista.length > 0) {
          const idsCuidador = [
            ...new Set(lista.map((i: any) => i.id_cuidador).filter(Boolean))
          ] as string[];

          const mapaCuidador = await this.cuidadoresPorId(idsCuidador);
          const idsUsuario = [...new Set(
            [...mapaCuidador.values()].map((c) => c.id_usuario).filter(Boolean)
          )] as string[];

          const mapaUsuario = await this.usuariosPorId(
            idsUsuario,
            'id, nombre, apellidopa, apellidoma, telefono, correo, rut'
          );

          for (const item of lista as any[]) {
            if (!item.id_cuidador) continue;

            const filaCuidador = mapaCuidador.get(item.id_cuidador);
            const idUsuarioCuidador = filaCuidador?.id_usuario;
            if (!idUsuarioCuidador) continue;

            item.cuidador = {
              id: item.id_cuidador,
              id_usuario: idUsuarioCuidador,
              usuario: mapaUsuario.get(idUsuarioCuidador) ?? null
            };
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
        const { error: errorRpc } = await this.supabase.rpc(
          'aceptar_solicitud_vinculacion',
          {
            p_solicitud_id: idSolicitud
          }
        );

        // Esto antes iba dentro de un try/catch "vacío". El problema es que
        // supabase-js NO lanza excepción cuando Postgres rechaza la
        // operación: devuelve { data: null, error }. El catch nunca se
        // activaba y el error se perdía, así que la app creía que había
        // aceptado algo que en realidad no había pasado.
        if (errorRpc) {
          console.warn('La RPC aceptar_solicitud_vinculacion falló:', errorRpc.message);
        }


        // Asegurar actualización de estado en solicitud_vinculacion
        const { error: errorEstado } = await this.supabase
          .from('solicitud_vinculacion')
          .update({
            estado: 'aceptada',
            fecha_respuesta: new Date().toISOString()
          })
          .eq('id', idSolicitud);

        if (errorEstado) {
          console.warn('No se pudo marcar la solicitud como aceptada:', errorEstado.message);
        }


        /*
         * Registrar en `cuidador_usuario`, que es la tabla que de verdad
         * importa: es la que consultan las políticas RLS del resto de la app.
         *
         * Hace falta confirmar que la fila quedó, no sólo que el insert no
         * devolvió error. Sin esa relectura, una vinculación "aceptada" sin
         * vínculo real pasaba el filtro de `obtenerAdultosACargo()` en la
         * base y desaparecía recién al listar, sin explicación para nadie.
         */
        if (solData?.id_cuidador && solData?.id_usuario) {
          const vinculado = await this.asegurarVinculo(
            solData.id_cuidador,
            solData.id_usuario
          );

          if (!vinculado) {
            throw new Error(
              'No se pudo registrar el vínculo. Revisa los permisos de la base de datos.'
            );
          }
        }

        return true;
      }


      /**
       * Deja el vínculo en `cuidador_usuario` y confirma que quedó ahí.
       *
       * Idempotente: si la fila ya existe no inserta otra vez, así que
       * reintentar una aceptación no duplica el vínculo.
       */
      private async asegurarVinculo(
        idCuidador: string,
        idUsuario: string
      ): Promise<boolean> {

        if ((await this.contarVinculos(idCuidador, idUsuario)) > 0) {
          return true;
        }

        const { error } = await this.supabase
          .from('cuidador_usuario')
          .insert({
            id_cuidador: idCuidador,
            id_usuario: idUsuario
          });

        if (error) {
          console.warn('No se pudo insertar el vínculo:', error.message);
          return false;
        }

        // Relectura de confirmación: es lo único que demuestra que la
        // escritura quedó y no sólo que no devolvió error.
        return (await this.contarVinculos(idCuidador, idUsuario)) > 0;
      }


      /**
       * Cuántas filas de vínculo hay entre este cuidador y este adulto.
       *
       * Lanza si la consulta falla a propósito. La otra versión, que devolvía
       * cero, hacía que un error de red se confundiera con "no queda ningún
       * vínculo" y `desvincular()` le informaba al usuario que había
       * desvinculado con éxito cuando en realidad no había pasado nada.
       */
      private async contarVinculos(
        idCuidador: string,
        idUsuario: string
      ): Promise<number> {

        const { data, error } = await this.supabase
          .from('cuidador_usuario')
          .select('id')
          .eq('id_cuidador', idCuidador)
          .eq('id_usuario', idUsuario);

        if (error) {
          throw new Error(error.message);
        }

        return data?.length ?? 0;
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

        /*
         * Borra el vínculo Y cierra la solicitud en una sola operación.
         *
         * Antes se hacían dos escrituras desde el cliente: primero el DELETE
         * en `cuidador_usuario` y después un UPDATE en `solicitud_vinculacion`
         * que el cuidador no tiene permiso de hacer. Ese segundo paso fallaba
         * en silencio y dejaba el residuo que después rompía los listados:
         * una solicitud "aceptada" sin vínculo, que `obtenerAdultosACargo()`
         * omitía y que hacía que el adulto mayor dejara de ver a su cuidador.
         *
         * La función `desvincular_vinculo` se ejecuta con permisos del dueño
         * y deja el par de escrituras consistente.
         */
        const { error: errorRpc } = await this.supabase.rpc('desvincular_vinculo', {
          p_id_usuario: idUsuario
        });

        if (errorRpc) {
          ultimoError = errorRpc.message;

          // Reintento con el borrado directo, por si la función no llegara a
          // estar creada todavía en la base.
          const { error: errorCU } = await this.supabase
            .from('cuidador_usuario')
            .delete()
            .eq('id_cuidador', idCuidador)
            .eq('id_usuario', idUsuario);

          if (errorCU) {
            throw new Error(errorCU.message);
          }
        }

        // La confirmación se consulta justo después de escribir, por lo que
        // puede todavía devolver datos antiguos. Se reintenta antes de asumir
        // que el borrado falló.
        for (const espera of [0, 500, 1500]) {

          if (espera > 0) {
            await new Promise(resolver => setTimeout(resolver, espera));
          }

          const restantes = await this.contarVinculos(idCuidador, idUsuario);

          if (restantes === 0) {
            return true;
          }
        }

        ultimoError = 'Quedó un registro del vínculo sin eliminar.';
        throw new Error(
          'No se pudo completar la desvinculación. ' +
          (ultimoError || 'Verifica tu conexión y permisos.')
        );
      }

    }

import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { NavegacionRolService } from '../../navegacion-rol/navegacion-rol';
import { PushNotificationService } from '../../Backend/push-notification/push-notification';
import { PerfilCacheService } from '../../perfil-cache/perfil-cache.service';

@Injectable({
  providedIn: 'root'
})
export class Login {

  constructor(
    private supabaseService: SupabaseService,
    private navRol: NavegacionRolService,
    private pushService: PushNotificationService,
    private perfilCache: PerfilCacheService
  ) {}


  // ==========================================
  // LOGIN CON CORREO Y CONTRASEÑA
  // ==========================================

  async iniciarSesion(
    correo: string,
    contrasena: string
  ) {

    const supabase =
      this.supabaseService.getClient();

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email: correo,
        password: contrasena
      });

    if (error) {
      throw error;
    }

    const usuarioId = data.user?.id;
    if (!usuarioId) {
      throw new Error('No se pudo identificar la cuenta.');
    }

    const { data: perfil, error: perfilError } = await supabase
      .from('usuario')
      .select('estado')
      .eq('id', usuarioId)
      .maybeSingle();

    if (perfilError) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('No se pudo verificar el estado de la cuenta.');
    }

    if (perfil?.estado === false) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Esta cuenta está desactivada.');
    }

    return data;
  }


  // ==========================================
  // GOOGLE PARA REGISTRO
  // ==========================================

  async iniciarSesionConGoogle(
    tipoCuenta: 'Usuario' | 'Familiar'
  ) {

    const supabase =
      this.supabaseService.getClient();

    // Guardar temporalmente el tipo de cuenta
    localStorage.setItem(
      'tipo_cuenta_google',
      tipoCuenta
    );

    const { data, error } =
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo:
            this.supabaseService.googleRedirectUrl()
        }
      });

    if (error) {
      throw error;
    }

    return data;
  }


  // ==========================================
  // GOOGLE PARA LOGIN
  // ==========================================

  async iniciarSesionGoogle() {

    const supabase =
      this.supabaseService.getClient();

    const { data, error } =
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo:
            this.supabaseService.googleRedirectUrl()
        }
      });

    if (error) {
      throw error;
    }

    return data;
  }


  // ==========================================
  // COMPLETAR REGISTRO GOOGLE
  // ==========================================

  async completarRegistroGoogle(
    tipoCuenta: 'Usuario' | 'Familiar'
  ) {

    const supabase =
      this.supabaseService.getClient();


    // ==========================================
    // OBTENER USUARIO AUTENTICADO
    // ==========================================

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error(
        'No se encontró el usuario autenticado.'
      );
    }


    // ==========================================
    // BUSCAR ROL
    // ==========================================

    const {
      data: rol,
      error: rolError
    } = await supabase
      .from('rol')
      .select('id, nombre')
      .eq('nombre', tipoCuenta)
      .maybeSingle();

    if (rolError) {
      throw new Error(
        `Error buscando el rol ${tipoCuenta}: ${rolError.message}`
      );
    }

    if (!rol) {
      throw new Error(
        `No existe el rol "${tipoCuenta}" en la tabla rol.`
      );
    }


    // ==========================================
    // VERIFICAR Y ACTUALIZAR/CREAR USUARIO
    // ==========================================

    const { data: usuarioExistente } = await supabase
      .from('usuario')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (usuarioExistente) {
      const { error: usuarioError } = await supabase
        .from('usuario')
        .update({
          id_rol: rol.id,
          estado: true
        })
        .eq('id', user.id);

      if (usuarioError) {
        throw new Error(`No se pudo actualizar el usuario: ${usuarioError.message}`);
      }
    } else {
      const nombreUsuario =
        user.user_metadata?.['full_name'] ||
        user.user_metadata?.['name'] ||
        user.email?.split('@')[0] ||
        'Usuario';

      const { error: usuarioInsertError } = await supabase
        .from('usuario')
        .insert({
          id: user.id,
          id_rol: rol.id,
          correo: user.email,
          nombre: nombreUsuario,
          estado: true
        });

      if (usuarioInsertError) {
        throw new Error(`No se pudo crear el usuario en la tabla: ${usuarioInsertError.message}`);
      }
    }


    // ==========================================
    // SI ES FAMILIAR → CREAR CUIDADOR
    // ==========================================

    if (tipoCuenta === 'Familiar') {

      const {
        data: cuidadorExistente,
        error: cuidadorBusquedaError
      } = await supabase
        .from('cuidador')
        .select('id, id_usuario')
        .eq('id_usuario', user.id)
        .maybeSingle();

      if (cuidadorBusquedaError) {
        throw new Error(
          `No se pudo consultar el cuidador: ${cuidadorBusquedaError.message}`
        );
      }

      if (!cuidadorExistente) {
        const {
          error: cuidadorError
        } = await supabase
          .from('cuidador')
          .insert({
            id_usuario: user.id
          })
          .select()
          .single();

        if (cuidadorError) {
          throw new Error(
            `No se pudo crear el cuidador: ${cuidadorError.message}`
          );
        }
      }
    }

    // Limpiar selección temporal
    localStorage.removeItem(
      'tipo_cuenta_google'
    );

    return user;
  }


  // ==========================================
  // CERRAR SESIÓN
  // ==========================================

  async cerrarSesion() {

    const supabase =
      this.supabaseService.getClient();

    // El token del dispositivo se suelta antes de cerrar sesión: si no, la
    // cuenta queda suscrita a las alertas en este celular.
    //
    // Va en su propio try a propósito: si la limpieza falla por falta de red,
    // igual hay que cerrar sesión. Dejarla pegada por un error de red es
    // justamente lo que hace que después sigan llegando avisos de la cuenta
    // anterior.
    try {
      await this.pushService.eliminarToken();
    } catch (e) {
      console.warn('No se pudo liberar el token de esta cuenta:', e);
    }

    // Los datos en caché son de la cuenta que sale: si no se borran, el
    // siguiente usuario de este teléfono vería su nombre y su foto.
    this.perfilCache.limpiar();

    // scope: 'local' y no el 'global' que viene por defecto. El default revoca
    // el refresh token de TODOS los dispositivos de la cuenta, así que cerrar
    // sesión en la web expulsaba del celular. Cerrar sesión es salir de este
    // dispositivo; salir de todos lados debería ser una acción aparte.
    const { error } =
      await supabase.auth.signOut({ scope: 'local' });

    this.navRol.limpiarCache();

    if (error) {
      throw error;
    }

  }


  // ==========================================
  // OBTENER USUARIO AUTENTICADO
  // ==========================================

  async obtenerUsuarioActual() {

    const supabase =
      this.supabaseService.getClient();

    const {
      data,
      error
    } = await supabase.auth.getUser();

    if (error) {
      throw error;
    }

    return data.user;
  }


  async obtenerRolUsuario() {

    const supabase =
      this.supabaseService.getClient();

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error(
        'No hay un usuario autenticado.'
      );
    }

    const {
      data: usuario,
      error: usuarioError
    } = await supabase
      .from('usuario')
      .select(`
        id,
        id_rol,
        rol (
          id,
          nombre
        )
      `)
      .eq('id', user.id)
      .maybeSingle();

    if (usuarioError) {
      throw usuarioError;
    }

    if (!usuario) {
      const metaRol = user.user_metadata?.['tipo_cuenta'];
      if (metaRol) {
        return metaRol;
      }
      throw new Error(
        'No se encontró el usuario en la base de datos.'
      );
    }

    const rolData = usuario.rol as any;

    if (!rolData) {
      const metaRol = user.user_metadata?.['tipo_cuenta'];
      if (metaRol) {
        return metaRol;
      }
      throw new Error(
        'El usuario no tiene un rol asignado.'
      );
    }

    const nombreRol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData.nombre;

    if (!nombreRol) {
      throw new Error('No se pudo determinar el nombre del rol.');
    }

    return nombreRol;
  }

}
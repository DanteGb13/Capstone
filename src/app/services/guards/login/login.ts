import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';

@Injectable({
  providedIn: 'root'
})
export class Login {

  constructor(
    private supabaseService: SupabaseService
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

    console.log(
      'Registrando con Google como:',
      tipoCuenta
    );

    const { data, error } =
      await supabase.auth.signInWithOAuth({

        provider: 'google',

        options: {

          redirectTo:
            `${window.location.origin}/login`

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
            `${window.location.origin}/login`

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

      console.error(
        'Error obteniendo usuario:',
        userError
      );

      throw userError;
    }

    if (!user) {

      throw new Error(
        'No se encontró el usuario autenticado.'
      );

    }


    console.log(
      'Usuario Google:',
      user.id,
      user.email
    );


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

      console.error(
        'Error buscando rol:',
        rolError
      );

      throw new Error(
        `Error buscando el rol ${tipoCuenta}: ${rolError.message}`
      );

    }


    if (!rol) {

      throw new Error(
        `No existe el rol "${tipoCuenta}" en la tabla rol.`
      );

    }


    console.log(
      'Rol encontrado:',
      rol.id,
      rol.nombre
    );


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
          id_rol: rol.id
        })
        .eq('id', user.id);

      if (usuarioError) {
        console.error('Error actualizando usuario:', usuarioError);
        throw new Error(`No se pudo actualizar el usuario: ${usuarioError.message}`);
      }
    } else {
      const { error: usuarioInsertError } = await supabase
        .from('usuario')
        .insert({
          id: user.id,
          id_rol: rol.id,
          correo: user.email,
          nombre_completo: user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || user.email || ''
        });

      if (usuarioInsertError) {
        console.error('Error insertando usuario:', usuarioInsertError);
        throw new Error(`No se pudo crear el usuario en la tabla: ${usuarioInsertError.message}`);
      }
    }


    // ==========================================
    // SI ES FAMILIAR → CREAR CUIDADOR
    // ==========================================

    if (tipoCuenta === 'Familiar') {


      // ------------------------------------------
      // Buscar si ya existe cuidador
      // ------------------------------------------

      const {
        data: cuidadorExistente,
        error: cuidadorBusquedaError
      } = await supabase
        .from('cuidador')
        .select('id, id_usuario')
        .eq('id_usuario', user.id)
        .maybeSingle();


      if (cuidadorBusquedaError) {

        console.error(
          'Error buscando cuidador:',
          cuidadorBusquedaError
        );

        throw new Error(
          `No se pudo consultar el cuidador: ${cuidadorBusquedaError.message}`
        );

      }


      // ------------------------------------------
      // Crear cuidador
      // ------------------------------------------

      if (!cuidadorExistente) {

        const {
          data: nuevoCuidador,
          error: cuidadorError
        } = await supabase
          .from('cuidador')
          .insert({

            id_usuario: user.id

          })
          .select()
          .single();


        if (cuidadorError) {

          console.error(
            'Error creando cuidador:',
            cuidadorError
          );

          throw new Error(
            `No se pudo crear el cuidador: ${cuidadorError.message}`
          );

        }


        console.log(
          'Cuidador creado:',
          nuevoCuidador
        );

      } else {

        console.log(
          'El cuidador ya existe:',
          cuidadorExistente
        );

      }

    }


    // ==========================================
    // LIMPIAR SELECCIÓN
    // ==========================================

    localStorage.removeItem(
      'tipo_cuenta_google'
    );


    console.log(
      `Registro completado como ${tipoCuenta}`
    );


    return user;
  }


  // ==========================================
  // CERRAR SESIÓN
  // ==========================================

  async cerrarSesion() {

    const supabase =
      this.supabaseService.getClient();

    const { error } =
      await supabase.auth.signOut();

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
      // Si aún no está en la tabla usuario pero viene de registro con metadata
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

    console.log(
      'Rol del usuario:',
      nombreRol
    );


    return nombreRol;
  }

}
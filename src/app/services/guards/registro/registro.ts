import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';



@Injectable({
  providedIn: 'root'
})
export class registro {

  constructor(
    private supabaseService: SupabaseService
  ) {}

  async registrarUsuario(datos: {
    nombreCompleto: string;
    telefono: string;
    correo: string;
    contrasena: string;
    tipoCuenta: 'Usuario' | 'Familiar';
  }) {

    const supabase =
      this.supabaseService.getClient();

    // Guardar datos temporales para usarlos en el paso siguiente
    localStorage.setItem('datos_registro_temp', JSON.stringify({
      nombreCompleto: datos.nombreCompleto,
      telefono: datos.telefono,
      correo: datos.correo,
      tipoCuenta: datos.tipoCuenta
    }));

    const { data, error } =
      await supabase.auth.signUp({

        email: datos.correo,

        password: datos.contrasena,

        options: {

          data: {

            nombre_completo:
              datos.nombreCompleto,

            telefono:
              datos.telefono,

            tipo_cuenta:
              datos.tipoCuenta

          }

        }

      });

    if (error) {
      throw error;
    }

    return data;
  }



  async registrarConGoogle(
    tipoCuenta: 'Usuario' | 'Familiar'
  ) {

    const supabase =
      this.supabaseService.getClient();

    // Guardar el tipo seleccionado
    localStorage.setItem(
      'tipo_cuenta_google',
      tipoCuenta
    );

    console.log(
      'Tipo de cuenta seleccionado:',
      tipoCuenta
    );

    const { data, error } =
      await supabase.auth.signInWithOAuth({

        provider: 'google',

        options: {

          // volver al login para terminar el registro
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
  // COMPLETAR PERFIL (PASO SIGUIENTE)
  // ==========================================

  async completarPerfilUsuario(datos: {
    rut: string;
    fechaNacimiento: string;
    nombre: string;
    apellidopa: string;
    apellidoma: string;
    telefono: string;
    region: string;
    comuna: string;
    calle: string;
    numero: string;
    tipoCuenta?: 'Usuario' | 'Familiar';
  }) {
    const supabase = this.supabaseService.getClient();

    // 1. Obtener usuario autenticado
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('No hay una sesión activa para completar el perfil.');
    }

    // 2. Determinar tipo de cuenta (desde parámetro, metadata o localStorage)
    const datosTemp = this.obtenerDatosRegistroTemporal();
    const tipoCuenta: 'Usuario' | 'Familiar' =
      datos.tipoCuenta ||
      datosTemp?.tipoCuenta ||
      (user.user_metadata?.['tipo_cuenta'] as 'Usuario' | 'Familiar') ||
      'Usuario';

    // 3. Insertar dirección
    const { data: direccionCreada, error: dirError } = await supabase
      .from('direccion')
      .insert({
        region: datos.region,
        comuna: datos.comuna,
        calle: datos.calle,
        numero: datos.numero
      })
      .select('id')
      .single();

    if (dirError) {
      console.error('Error creando dirección:', dirError);
      throw new Error(`Error al guardar dirección: ${dirError.message}`);
    }

    // 4. Buscar rol en la tabla rol
    const { data: rol, error: rolError } = await supabase
      .from('rol')
      .select('id, nombre')
      .eq('nombre', tipoCuenta)
      .maybeSingle();

    if (rolError || !rol) {
      console.error('Error buscando rol:', rolError);
      throw new Error(`Error buscando el rol ${tipoCuenta}`);
    }

    // 5. Guardar o actualizar en la tabla usuario
    const { data: usuarioExistente } = await supabase
      .from('usuario')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    const datosUsuario = {
      id: user.id,
      nombre: datos.nombre,
      apellidopa: datos.apellidopa,
      apellidoma: datos.apellidoma,
      telefono: datos.telefono || user.user_metadata?.['telefono'] || '',
      rut: datos.rut,
      correo: user.email || datosTemp?.correo || '',
      id_rol: rol.id,
      estado: true,
      id_direccion: direccionCreada.id,
      fecha_nacimiento: datos.fechaNacimiento
    };

    if (usuarioExistente) {
      const { error: updateError } = await supabase
        .from('usuario')
        .update(datosUsuario)
        .eq('id', user.id);

      if (updateError) {
        console.error('Error actualizando usuario:', updateError);
        throw new Error(`No se pudo actualizar el perfil: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await supabase
        .from('usuario')
        .insert(datosUsuario);

      if (insertError) {
        console.error('Error insertando usuario:', insertError);
        throw new Error(`No se pudo crear el perfil: ${insertError.message}`);
      }
    }

    // 6. Si es Familiar, registrar en tabla cuidador
    if (tipoCuenta === 'Familiar') {
      const { data: cuidadorExistente } = await supabase
        .from('cuidador')
        .select('id')
        .eq('id_usuario', user.id)
        .maybeSingle();

      if (!cuidadorExistente) {
        const { error: cuidadorError } = await supabase
          .from('cuidador')
          .insert({
            id_usuario: user.id
          });

        if (cuidadorError) {
          console.error('Error creando cuidador:', cuidadorError);
        }
      }
    }

    // 7. Limpiar temporales
    localStorage.removeItem('datos_registro_temp');

    return {
      user,
      tipoCuenta
    };
  }

  obtenerDatosRegistroTemporal(): {
    nombreCompleto?: string;
    telefono?: string;
    correo?: string;
    tipoCuenta?: 'Usuario' | 'Familiar';
  } | null {
    const raw = localStorage.getItem('datos_registro_temp');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

}
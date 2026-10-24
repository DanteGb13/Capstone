import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { mensajeErrorApp } from '../../utils/mensaje-error';



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

    // Con la confirmación de correo activada, Supabase NO devuelve error cuando
    // el correo ya existe: devuelve un usuario con la lista `identities` vacía.
    // Sin revisar esto, la app avanzaba al paso 2 como si el registro hubiera
    // salido bien y al final fallaba sin explicar nada.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('Ese correo ya está registrado. Usa otro correo o inicia sesión.');
    }

    return data;
  }



  async registrarConGoogle() {

    const supabase =
      this.supabaseService.getClient();

    // El tipo de cuenta se elige después en la pantalla 'elegir-tipo',
    // por lo que NO se guarda 'tipo_cuenta_google' aquí.

    const { data, error } =
      await supabase.auth.signInWithOAuth({

        provider: 'google',

        options: {

          // volver al login para terminar el registro
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
      throw new Error(mensajeErrorApp(dirError, 'No se pudo guardar la dirección. Inténtalo de nuevo.'));
    }

    // 4. Buscar rol en la tabla rol
    const { data: rol, error: rolError } = await supabase
      .from('rol')
      .select('id, nombre')
      .eq('nombre', tipoCuenta)
      .maybeSingle();

    if (rolError || !rol) {
      console.error('Error buscando rol:', rolError);
      throw new Error('No se pudo encontrar tu tipo de cuenta. Inténtalo de nuevo.');
    }

    // 5. Guardar o actualizar en la tabla usuario
    const { data: usuarioExistente } = await supabase
      .from('usuario')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    // Chequeo previo: si el RUT ya pertenece a OTRA cuenta, se avisa antes
    // de llegar a la base. Así el mensaje siempre nombra el dato correcto,
    // sin depender del nombre del constraint que devuelva Postgres.
    const { data: rutEnUso } = await supabase
      .from('usuario')
      .select('id')
      .eq('rut', datos.rut)
      .neq('id', user.id)
      .maybeSingle();

    if (rutEnUso) {
      throw new Error('Este RUT ya está en uso por otra cuenta.');
    }

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
        // Aquí aparece el "duplicate key ... usuario_rut_key" cuando el RUT
        // ya existe: mensajeErrorApp lo traduce a "Este RUT ya está en uso."
        throw new Error(mensajeErrorApp(updateError, 'No se pudo actualizar el perfil. Inténtalo de nuevo.'));
      }
    } else {
      const { error: insertError } = await supabase
        .from('usuario')
        .insert(datosUsuario);

      if (insertError) {
        console.error('Error insertando usuario:', insertError);
        throw new Error(mensajeErrorApp(insertError, 'No se pudo crear el perfil. Inténtalo de nuevo.'));
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
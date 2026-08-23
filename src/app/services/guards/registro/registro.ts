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

          // IMPORTANTE:
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

}
import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';

@Injectable({
    providedIn: 'root'
})

export class CuidadoresService {

    nombreUsuario: string = '';
    
    constructor(
        private supabaseService: SupabaseService
    ) { }


    async cargarUsuarioNombre() {

        const supabase = this.supabaseService.getClient();


        // Obtener usuario autenticado
        const { data: userData, error: userError } =
            await supabase.auth.getUser();


        if (userError) {

            console.log(userError);
            return '';

        }


        if (userData.user) {


            const { data, error } = await supabase
                .from('usuario')
                .select('nombre')
                .eq('id', userData.user.id)
                .single();



            if (error) {

                console.log(error);
                return '';

            }


            if (data) {

                return data.nombre;

            }

        }


        return '';

    }

    async cargarUsuario() {

        const supabase = this.supabaseService.getClient();


        // Obtener usuario autenticado
        const { data: userData, error: userError } =
            await supabase.auth.getUser();


        if (userError) {

            console.log(userError);
            return null;

        }


        if (userData.user) {


            const { data, error } = await supabase
                .from('usuario')
                .select('*')
                .eq('id', userData.user.id)
                .single();



            if (error) {

                console.log(error);
                return null;

            }


            if (data) {

                return data;

            }

        }


        return null;

    }

}
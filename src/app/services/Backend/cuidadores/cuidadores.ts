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
            // Hacemos el select trayendo también los campos de la tabla 'direccion'
            const { data, error } = await supabase
                .from('usuario')
                .select(`
                    *,
                    direccion (
                        id,
                        region,
                        comuna,
                        calle,
                        numero
                    ),
                    rol (
                        id,
                        nombre
                    )
                `)
                .eq('id', userData.user.id)
                .single();

            if (error) {
                console.log(error);
                return null;
            }

            if (data) {
                // Supabase a veces retorna las relaciones de 1 a 1 como un arreglo. 
                // Esto asegura que 'usuario.direccion' sea un objeto plano.
                if (Array.isArray(data.direccion)) {
                    data.direccion = data.direccion[0] || {};
                }
                
                // Si el usuario no tiene dirección asignada aún, inicializamos un objeto vacío
                if (!data.direccion) {
                    data.direccion = {};
                }

                return data;
            }
        }

        return null;
    }
}
import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * El ÚNICO cliente de Supabase del proyecto.
 *
 * Vive en `core/` a propósito: es lo que comparten la app móvil y la web, y
 * nada de los dos lo posee. Tenerlo adentro de `services/` (la app) haría
 * que cualquier cosa de la web importara un archivo de la app.
 *
 * ---------------------------------------------------------------
 * ¿Por qué no un cliente por plataforma?
 * ---------------------------------------------------------------
 * Porque dos clientes con la misma URL y llave comparten el mismo
 * `localStorage` (`sb-<ref>-auth-token`), pero cada uno tiene su copia de la
 * sesión en memoria y su propio `onAuthStateChange`. Cuando uno renueva el
 * token y lo escribe, el otro sigue con la copia vieja: los dos se pelean por
 * el mismo refresh token.
 *
 * Esa carrera ya es una de las causas conocidas del bug que cierra las
 * sesiones del celular sin que nadie toque nada. Abrir un segundo cliente la
 * multiplicaría en vez de arreglarla.
 *
 * Un solo cliente también significa que entrar desde la web y entrar desde la
 * app ven el mismo estado de sesión, en vez de dos versiones que se pisan.
 */
let cliente: SupabaseClient | null = null;

/**
 * Devuelve el cliente, creándolo a la primera llamada.
 *
 * `flowType: 'pkce'` es el mismo modo que siempre usó la app; si se cambia
 * acá, se cambia para las dos plataformas.
 */
export function clienteSupabase(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        flowType: 'pkce',
      },
    });
  }

  return cliente;
}

/**
 * El mismo cliente, pero inyectable.
 *
 * Existe para que los servicios puedan recibirlo por constructor: los tests
 * de este proyecto se apoyan en `TestBed` y el sistema de pruebas de Angular
 * no permite sustituir módulos con `vi.mock` cuando el import es relativo.
 * Con esto se reemplaza el provider en la prueba y ya.
 *
 * No cambia el garantizado de arriba: por más que se inyecte, siempre
 * devuelve la MISMA instancia.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseClientProvider {
  get(): SupabaseClient {
    return clienteSupabase();
  }
}

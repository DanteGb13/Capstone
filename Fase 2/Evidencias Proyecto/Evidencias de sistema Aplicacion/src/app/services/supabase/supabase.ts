import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SiempreCerca } from '../alarmas/siempre-cerca';


@Injectable({
  providedIn: 'root'
})
export class SupabaseService {

  private supabase: SupabaseClient;

  /**
   * Resultado del retorno OAuth en móvil (deep link). Permite a las páginas
   * reaccionar aunque el evento SIGNED_IN se disparara antes de suscribirse.
   */
  public oauthResult$ = new BehaviorSubject<{ ok: boolean; error?: string } | null>(null);

  constructor() {
    const isNative = Capacitor.isNativePlatform();

    this.supabase = createClient(
      environment.supabaseUrl,
      environment.supabaseKey,
      {
        auth: {
          // Forzamos PKCE. Si el proyecto en Supabase está en modo implícito,
          // el token llegará en el fragmento y lo manejamos igual abajo.
          flowType: 'pkce'
        }
      }
    );

    // En móvil (Capacitor) capturamos el retorno del navegador OAuth
    // (deep link). Soportamos ambos flujos:
    //  - PKCE: ?code=...&sb_flow_id=... -> exchangeCodeForSession
    //  - Implícito: #access_token=...&refresh_token=... -> setSession
    if (isNative) {
      App.addListener('appUrlOpen', async ({ url }) => {
        try {
          const parsed = new URL(url);
          const code = parsed.searchParams.get('code');
          const error = parsed.searchParams.get('error');
          const errorDescription = parsed.searchParams.get('error_description');

          if (error) {
            const mensaje = errorDescription || error;
            this.oauthResult$.next({ ok: false, error: mensaje });
            return;
          }

          // --- Flujo PKCE ---
          if (code) {
            const flowId = parsed.searchParams.get('sb_flow_id');
            try {
              await this.supabase.auth.exchangeCodeForSession(
                code,
                flowId ? { flowId } : undefined
              );
            } catch (e1: any) {
              console.warn('[OAuth] exchange con flowId falló, reintentando sin flowId:', e1?.message);
              // Reintentar sin flowId por si el verifier no está ligado a él
              await this.supabase.auth.exchangeCodeForSession(code);
            }
            this.oauthResult$.next({ ok: true });
            return;
          }

          // --- Flujo implícito (token en el fragmento) ---
          const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
          if (hash) {
            const frag = new URLSearchParams(hash);
            const accessToken = frag.get('access_token');
            const refreshToken = frag.get('refresh_token');
            const fragError = frag.get('error');

            if (fragError) {
              this.oauthResult$.next({
                ok: false,
                error: frag.get('error_description') || fragError
              });
              return;
            }

            if (accessToken && refreshToken) {
              await this.supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
              });
              this.oauthResult$.next({ ok: true });
              return;
            }
          }

          this.oauthResult$.next({
            ok: false,
            error: 'Retorno de OAuth sin código ni token reconocible.'
          });
        } catch (e: any) {
          const mensaje = e?.message || String(e);
          console.error('[OAuth] Falló el intercambio de código:', mensaje, 'URL recibida:', url);
          this.oauthResult$.next({ ok: false, error: mensaje });
        }
      });
    }

    // Segundo plano (sólo móvil): el servicio nativo necesita la sesión para
    // evaluar las zonas seguras con la app cerrada. Guardamos el token al
    // cambiar la sesión y, al volver a la app, traemos el token si el servicio
    // lo refrescó él mismo mientras la app estaba cerrada.
    if (isNative) {
      this.sincronizarSesionNativa();

      this.supabase.auth.onAuthStateChange((_evento, sesion) => {
        this.guardarSesionNativa(sesion);
      });

      App.addListener('resume', () => {
        this.sincronizarSesionNativa();
      });
    }
  }

  /**
   * Pasa la sesión al plugin nativo para que el servicio en segundo plano
   * (evaluación de zonas) pueda validar el JWT con la app cerrada.
   *
   * NADA de lo de aquí se loguea, ni siquiera un "ok". En compilación de
   * depuración, el puente de Capacitor escribe los `methodData` de cada llamada
   * nativa en `logcat`, así que un solo `console.log` de esta llamada basta para
   * volcar el access token, el refresh token y el id de usuario en texto plano:
   * con eso, cualquiera con `adb logcat` sobre un dispositivo con depuración USB
   * puede suplantar la cuenta. El token llega igual al plugin (hace falta para
   * el servicio en segundo plano); lo que no debe es quedar registrado.
   */
  private guardarSesionNativa(sesion: Session | null): void {
    if (!Capacitor.isNativePlatform()) return;

    try {
      SiempreCerca.guardarSesionBackend({
        url: environment.supabaseUrl,
        anonKey: environment.supabaseKey,
        accessToken: sesion?.access_token || '',
        refreshToken: sesion?.refresh_token || '',
        userId: sesion?.user?.id || '',
        expiresAt: (sesion?.expires_at || 0) * 1000
      }).catch(() => {});
    } catch { /* sin plugin nativo */ }
  }

  private async sincronizarSesionNativa(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const nativa = await SiempreCerca.obtenerSesionBackend();
      const { data } = await this.supabase.auth.getSession();
      const local = data?.session ?? null;

      if (!nativa?.accessToken) {
        this.guardarSesionNativa(local);
        return;
      }

      const expiraNativa = Math.floor((nativa.expiresAt || 0) / 1000);
      const expiraLocal = local?.expires_at || 0;
      const nativaEsMasReciente = expiraNativa > expiraLocal + 120;

      // Nunca adoptamos un token nativo ya vencido: al refrescarlo con un
      // refresh_token que Supabase ya no reconoce, la sesión se destruye y la
      // app expulsa al usuario al login. Si está vencido, que cada lado
      // renueve su propio token.
      const nativaVigente = (nativa.expiresAt || 0) > Date.now() + 60_000;

      if (nativa.refreshToken && nativaVigente && (nativaEsMasReciente || !local)) {
        // El servicio refrescó el token con la app cerrada: lo adoptamos aquí.
        // Sin log: son credenciales, y el puente de Capacitor vuelca los
        // `methodData` de esta llamada en `logcat` al compilar en depuración.
        await this.supabase.auth.setSession({
          access_token: nativa.accessToken,
          refresh_token: nativa.refreshToken
        });
        return;
      }

      this.guardarSesionNativa(local);
    } catch { /* sin sesión utilizable */ }
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  /**
   * URL de retorno para el flujo de Google OAuth.
   * - Web: la misma origin (login).
   * - Móvil (Capacitor): deep link con el scheme de la app (appId en capacitor.config.ts).
   *   Debe estar autorizado como URI de redirección en Google Cloud Console.
   */
  googleRedirectUrl(): string {
    if (Capacitor.isNativePlatform()) {
      return 'io.ionic.starter://login';
    }
    return `${window.location.origin}/login`;
  }
}
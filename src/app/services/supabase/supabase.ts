import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';


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
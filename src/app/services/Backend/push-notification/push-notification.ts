import { Injectable, NgZone } from '@angular/core';
import { PushNotifications, Token, PushNotification } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../../supabase/supabase';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { NavegacionRolService } from '../../navegacion-rol/navegacion-rol';

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {

  private tokenFCM: string | null = null;
  private isNative = Capacitor.isNativePlatform();

  private _ultimoError = '';

  get ultimoError(): string {
    return this._ultimoError;
  }

  // CAMBIAR A true CUANDO FIREBASE ESTÉ CONFIGURADO
  private pushHabilitado = true;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router,
    private ngZone: NgZone,
    private alertCtrl: AlertController,
    private navRol: NavegacionRolService
  ) {}

  async inicializar(): Promise<void> {
    if (!this.isNative || !this.pushHabilitado) return;

    if (!Capacitor.isPluginAvailable('PushNotifications')) {
      console.warn('Plugin PushNotifications no disponible');
      return;
    }

    let permiso;
    try {
      const permisoResult = await Promise.race([
        PushNotifications.requestPermissions(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      permiso = permisoResult;
    } catch (e) {
      console.warn('Error/timeout pidiendo permiso push:', e);
      return;
    }

    if (permiso.receive !== 'granted') {
      console.warn('Permiso de push notifications no concedido');
      return;
    }

    try {
      await Promise.race([
        PushNotifications.register(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
    } catch (e) {
      console.warn('Error/timeout en PushNotifications.register:', e);
      return;
    }

    PushNotifications.addListener('registration', (token: Token) => {
      this.tokenFCM = token.value;
      console.log('Token FCM:', token.value);
      this.guardarToken(token.value);
    });

    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('Error de registro push:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotification) => {
      console.log('Notificación recibida:', notification);
      this.mostrarAlerta(notification);
      this.publicarEnBarra(notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('Acción en notificación:', action);
      this.ngZone.run(async () => {
        await this.navRol.irAPanelPrincipal();
      });
    });
  }

  async solicitarPermisoNotificaciones(): Promise<boolean> {
    if (!this.isNative || !this.pushHabilitado) return true;

    try {
      const permiso = await PushNotifications.requestPermissions();
      return permiso.receive === 'granted';
    } catch {
      return false;
    }
  }

  async verificarPermisoNotificaciones(): Promise<boolean> {
    if (!this.isNative || !this.pushHabilitado) return true;

    try {
      const permiso = await PushNotifications.checkPermissions();
      return permiso.receive === 'granted';
    } catch {
      return false;
    }
  }

  private async guardarToken(token: string): Promise<void> {
    try {
      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      const { error } = await client
        .from('push_tokens')
        .upsert(
          {
            id_usuario: user.id,
            token: token,
            plataforma: 'android',
            updated_at: new Date().toISOString()
          },
          { onConflict: 'id_usuario,token' }
        );

      if (error) {
        console.error('Error guardando token:', error);
        return;
      }

      console.log('Token guardado para el usuario:', user.id);
    } catch (e) {
      console.error('Error guardando token:', e);
    }
  }

  async eliminarToken(): Promise<void> {
    if (!this.tokenFCM) return;

    try {
      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      await client
        .from('push_tokens')
        .delete()
        .eq('id_usuario', user.id)
        .eq('token', this.tokenFCM);

      this.tokenFCM = null;
    } catch (e) {
      console.error('Error eliminando token:', e);
    }
  }

  async enviarPushAUsuario(
    idUsuarioDestino: string,
    titulo: string,
    cuerpo: string,
    data?: any
  ): Promise<boolean> {
    if (!this.pushHabilitado) return false;

    this._ultimoError = '';

    try {
      const client = this.supabaseService.getClient();

      const { data: tokens, error } = await client
        .from('push_tokens')
        .select('token')
        .eq('id_usuario', idUsuarioDestino);

      if (error || !tokens || tokens.length === 0) {
        this._ultimoError = 'No se encontraron tokens de notificación para el destinatario.';
        console.warn(this._ultimoError, idUsuarioDestino);
        return false;
      }

      let enviadosOk = 0;
      const errores: string[] = [];

      for (const t of tokens) {
        try {
          const r = await this.enviarPushFirebase(t.token, titulo, cuerpo, data);
          if (r.ok) {
            enviadosOk++;
          } else {
            if (r.error) errores.push(r.error);
            // Token inválido/caducado → limpiarlo para que no falle siempre
            if (r.tokenInvalido) {
              await client
                .from('push_tokens')
                .delete()
                .eq('id_usuario', idUsuarioDestino)
                .eq('token', t.token);
              console.warn('Token obsoleto eliminado para el usuario:', idUsuarioDestino);
            }
          }
        } catch (e: any) {
          errores.push(e?.message || 'Error desconocido');
        }
      }

      if (enviadosOk === 0) {
        this._ultimoError = errores.join(' | ') || 'El envío falló sin detalles.';
        console.error('Push fallido:', this._ultimoError);
        return false;
      }

      return true;
    } catch (e: any) {
      this._ultimoError = e?.message || 'Error enviando push';
      console.error('Error enviando push:', e);
      return false;
    }
  }

  private esTokenInvalido(mensaje: string): boolean {
    return (
      mensaje.toLowerCase().includes('unregistered') ||
      mensaje.toLowerCase().includes('invalid argument') ||
      mensaje.toLowerCase().includes('not a valid')
    );
  }

  private async enviarPushFirebase(
    token: string,
    titulo: string,
    cuerpo: string,
    data?: any
  ): Promise<{ ok: boolean; error?: string; tokenInvalido?: boolean }> {
    const client = this.supabaseService.getClient();
    const { error } = await client.functions.invoke('enviar-push', {
      body: {
        token,
        titulo,
        cuerpo,
        data: data || {}
      }
    });

    if (error) {
      const mensaje = `Edge Function: ${error.message}`;
      console.error('Error en Edge Function push:', error);
      return { ok: false, error: mensaje, tokenInvalido: this.esTokenInvalido(error.message || '') };
    }

    return { ok: true };
  }

  private async mostrarAlerta(notification: PushNotification): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: notification.title || 'Alerta',
      message: notification.body || '',
      buttons: ['OK']
    });
    await alert.present();
  }

  private async publicarEnBarra(notification: PushNotification): Promise<void> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
      await LocalNotifications.schedule({
        notifications: [{
          title: notification.title || 'Alerta SOS',
          body: notification.body || 'Emergencia detectada',
          id: Date.now() % 2147483647,
          channelId: 'sos-alertas'
        }]
      });
      console.log('Notificación publicada en barra');
    } catch (e) {
      console.warn('Error publicando en barra:', e);
    }
  }

  getToken(): string | null {
    return this.tokenFCM;
  }
}

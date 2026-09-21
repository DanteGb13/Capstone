import { Injectable, NgZone } from '@angular/core';
import { PushNotifications, Token, PushNotification } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../../supabase/supabase';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {

  private tokenFCM: string | null = null;
  private isNative = Capacitor.isNativePlatform();

  // CAMBIAR A true CUANDO FIREBASE ESTÉ CONFIGURADO
  private pushHabilitado = true;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router,
    private ngZone: NgZone,
    private alertCtrl: AlertController
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
      this.ngZone.run(() => {
        this.router.navigate(['/adulto-mayor']);
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

      // Si es adulto mayor, también guardar token para sus cuidadores vinculados
      // (para que el SOS pueda enviar push al cuidador desde el mismo celular)
      const { data: vinculos } = await client
        .from('cuidador_usuario')
        .select('cuidador(id_usuario)')
        .eq('id_usuario', user.id);

      if (vinculos) {
        for (const v of vinculos) {
          const cuidadorUserId = (v as any).cuidador?.id_usuario;
          if (cuidadorUserId && cuidadorUserId !== user.id) {
            await client
              .from('push_tokens')
              .upsert(
                {
                  id_usuario: cuidadorUserId,
                  token: token,
                  plataforma: 'android',
                  updated_at: new Date().toISOString()
                },
                { onConflict: 'id_usuario,token' }
              );
          }
        }
      }
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

    try {
      const client = this.supabaseService.getClient();

      const { data: tokens, error } = await client
        .from('push_tokens')
        .select('token')
        .eq('id_usuario', idUsuarioDestino);

      if (error || !tokens || tokens.length === 0) {
        console.warn('No se encontraron tokens para el usuario:', idUsuarioDestino);
        return false;
      }

      for (const t of tokens) {
        await this.enviarPushFirebase(t.token, titulo, cuerpo, data);
      }

      return true;
    } catch (e) {
      console.error('Error enviando push:', e);
      return false;
    }
  }

  private async enviarPushFirebase(
    token: string,
    titulo: string,
    cuerpo: string,
    data?: any
  ): Promise<void> {
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
      console.error('Error en Edge Function push:', error);
    }
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
      await LocalNotifications.schedule({
        notifications: [{
          title: notification.title || 'Alerta SOS',
          body: notification.body || 'Emergencia detectada',
          id: Date.now() % 2147483647,
          channelId: 'sos-alertas'
        }]
      });
    } catch (e) {
      console.warn('Error publicando en barra:', e);
    }
  }

  getToken(): string | null {
    return this.tokenFCM;
  }
}

import { Injectable, NgZone } from '@angular/core';
import { PushNotifications, Token, PushNotification } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../../supabase/supabase';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { NavegacionRolService } from '../../navegacion-rol/navegacion-rol';
import { SiempreCerca } from '../../alarmas/siempre-cerca';

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {

  private tokenFCM: string | null = null;
  private isNative = Capacitor.isNativePlatform();

  /** Clave local para recuperar el token aunque la app se haya reiniciado. */
  private static readonly CLAVE_TOKEN_LOCAL = 'push_token_fcm';

  /** Grupo de acciones de la notificación SOS en la barra. */
  private static readonly ACCION_SOS = 'sos-confirmar';

  private listenersRegistrados = false;

  /** Ya se registró el botón "Confirmar" de las notificaciones locales. */
  private accionSosRegistrada = false;

  /** Sesiones SOS que este cuidador YA|attendance: no se vuelven a avisar. */
  private sosAtendidos = new Set<string>();

  /** Ya hay un diálogo de alerta abierto: no se apilan ventanas. */
  private alertaVisible = false;

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

    // Canales de alerta listos (SOS / zona segura) antes de registrar el token
    SiempreCerca.crearCanalSOS().catch(() => {});

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

    // registrarListeners() se resguarda solo: sin esto, entrar al panel
    // después de cerrar sesión volvía a saltar el registro del token y la
    // cuenta nueva nunca quedaba en push_tokens.
    this.registrarListeners();

    try {
      await Promise.race([
        PushNotifications.register(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
    } catch (e) {
      console.warn('Error/timeout en PushNotifications.register:', e);
      return;
    }

    // Al cambiar de cuenta el token del dispositivo es el mismo: hay que
    // volver a asociarlo a la sesión actual para que la cuenta anterior
    // deje de recibir alertas aquí.
    const tokenPrevio = this.tokenGuardado();
    if (tokenPrevio) {
      this.guardarToken(tokenPrevio);
    }
  }

  /**
   * Escucha las notificaciones desde el arranque de la app.
   * Si el SOS se toca con la app cerrada, el gestor de notificaciones se
   * registra aquí: sin esto el toque no confirmaba y el aviso seguía sonando.
   * No pide permisos ni registra el token, eso sigue en inicializar().
   */
  escucharDesdeArranque(): void {
    if (!this.isNative || !this.pushHabilitado) return;
    if (!Capacitor.isPluginAvailable('PushNotifications')) return;

    try {
      this.registrarListeners();
    } catch (e) {
      console.warn('No se pudo escuchar las notificaciones al arrancar:', e);
    }
  }

  private registrarListeners(): void {
    if (this.listenersRegistrados) return;
    this.listenersRegistrados = true;

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
      const datos: any = (notification as any).data || {};
      const idSos = datos.tipo === 'sos' ? (datos.id_sos || '') : '';

      // Si el cuidador YA confirmó esta sesión, el aviso repetido del adulto
      // sólo refresca la notificación: no vuelve a sonar ni a abrir diálogos.
      if (idSos && this.sosAtendidos.has(idSos)) {
        void this.publicarEnBarra(notification);
        return;
      }

      this.vibrarPorTipo(notification);
      this.mostrarAlerta(notification);
      this.publicarEnBarra(notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('Acción en notificación:', action);
      const datos: any = (action as any)?.notification?.data || {};
      this.ngZone.run(async () => {
        // Tocar la alerta SOS cuenta como "contesté": se deja de reenviar
        if (datos.tipo === 'sos' && datos.id_sos) {
          await this.confirmarSos(datos.id_sos);
          // La ubicación se abre en Google Maps en vez de quedar como texto
          this.abrirMapaSos(datos);
          await this.navRol.irAPanelPrincipal();
          return;
        }
        // Un aviso de zona segura (salida o emergencia de viaje) también
        // abre la ubicación en Google Maps al tocarlo.
        if (datos.tipo === 'zona_segura' && (datos.latitud || datos.longitud)) {
          this.abrirMapaSos(datos);
          await this.navRol.irAPanelPrincipal();
          return;
        }
        await this.navRol.irAPanelPrincipal();
      });
    });

    // Tocar la notificación de la barra publicada por esta misma app
    // también confirma el SOS (si no, el aviso seguía sonando para siempre).
    if (Capacitor.isPluginAvailable('LocalNotifications')) {
      LocalNotifications.addListener('localNotificationActionPerformed', (accion: any) => {
        const datos = accion?.notification?.extra || {};
        if (datos?.tipo === 'sos' && datos?.id_sos) {
          this.ngZone.run(async () => {
            await this.confirmarSos(datos.id_sos);
            this.abrirMapaSos(datos);
            await this.navRol.irAPanelPrincipal();
          });
        } else if (datos?.tipo === 'zona_segura') {
          this.ngZone.run(async () => {
            this.abrirMapaSos(datos);
            await this.navRol.irAPanelPrincipal();
          });
        }
      });
    }
  }

  /**
   * Vibración intensa al recibir una alerta (app abierta):
   *  - SOS: 3 pulsos largos a amplitud máxima (~8 s).
   *  - Primera salida de zona: 3 pulsos de 1,5 s (~5 s).
   *  - Actualización de estado: un pulso corto.
   */
  private vibrarPorTipo(notification: PushNotification): void {
    if (!this.isNative) return;

    const datos: any = (notification as any).data || {};
    const tipo = datos.tipo || '';
    const canal = datos.canal || '';

    let duracionMs = 500;
    let veces = 1;
    let amplitud = 200;

    if (tipo === 'sos' || canal === 'sos-alertas') {
      duracionMs = 2500;
      veces = 3;
      amplitud = 255;
    } else if (canal === 'zona-alertas' || (tipo === 'zona_segura' && canal !== 'zona-estado')) {
      duracionMs = 1500;
      veces = 3;
      amplitud = 255;
    } else if (canal === 'zona-estado') {
      duracionMs = 400;
      veces = 1;
      amplitud = 150;
    }

    SiempreCerca.vibrar({ duracionMs, veces, amplitud, descansoMs: 300 }).catch(() => {});
  }

  /**
   * Marca la sesión SOS como confirmada para que el adulto deje de
   * reenviar avisos (el aviso se reenvía hasta que alguien contesta).
   *
   * Primero corta el sonido en este dispositivo y luego lo deja registrado
   * en la base: aunque la red falle, este teléfono no vuelve a sonar.
   */
  private async confirmarSos(idSos: string, intentos = 2): Promise<void> {
    if (!idSos) return;

    this.sosAtendidos.add(idSos);
    await this.cerrarNotificacionSos(idSos);

    try {
      const client = this.supabaseService.getClient();

      for (let intento = 1; intento <= intentos; intento++) {
        const { data: { user } } = await client.auth.getUser();

        // Al abrir desde la notificación con la app cerrada la sesión tarda
        // un instante en restaurarse: sin este reintento el SOS seguía sonando.
        if (!user) {
          if (intento < intentos) {
            await new Promise((resolver) => setTimeout(resolver, 1500));
            continue;
          }
          console.warn('No se pudo confirmar la alerta SOS: no hay sesión iniciada');
          return;
        }

        const { error, data } = await client
          .from('sos_alerta')
          .update({
            confirmada_por: user.id,
            confirmada_en: new Date().toISOString()
          })
          .eq('id', idSos)
          .is('confirmada_por', null)
          .select('id');

        if (!error) {
          if (!data || data.length === 0) {
            console.log('La alerta SOS ya estaba confirmada por otro cuidador');
          }
          return;
        }

        console.warn(`No se pudo confirmar la alerta SOS (intento ${intento}/${intentos}):`, error.message);

        if (intento < intentos) {
          await new Promise((resolver) => setTimeout(resolver, 1200));
        }
      }
    } catch (e) {
      console.warn('No se pudo confirmar la alerta SOS:', e);
    }
  }

  /** Quita el aviso de la barra: así el sonido se detiene de inmediato. */
  private async cerrarNotificacionSos(idSos: string): Promise<void> {
    if (!this.isNative || !Capacitor.isPluginAvailable('LocalNotifications')) return;

    try {
      await LocalNotifications.cancel({
        notifications: [{ id: this.idNotificacionSos(idSos) }]
      });
    } catch (e) {
      console.warn('No se pudo quitar la notificación SOS:', e);
    }
  }

  /** ID numérico estable por sesión SOS: el aviso repetido reemplaza al anterior. */
  private idNotificacionSos(idSos: string): number {
    let hash = 0;
    for (let i = 0; i < idSos.length; i++) {
      hash = ((hash << 5) - hash) + idSos.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 2000000 + 1000;
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
      this.guardarTokenLocal(token);

      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      // push_registrar_token deja el token a nombre de la sesión actual: borra
      // la fila que hubiera dejado otra cuenta en este mismo dispositivo.
      const { error } = await client.rpc('push_registrar_token', {
        p_token: token,
        p_plataforma: 'android'
      });

      if (error) {
        console.warn('No se pudo usar push_registrar_token, se hace upsert directo:', error.message);
        await this.guardarTokenPorUpsert(token, user.id);
        return;
      }

      console.log('Token guardado para el usuario:', user.id);
    } catch (e) {
      console.error('Error guardando token:', e);
    }
  }

  /** Respaldo para cuando la RPC todavía no está desplegada en Supabase. */
  private async guardarTokenPorUpsert(token: string, idUsuario: string): Promise<void> {
    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('push_tokens')
      .upsert(
        {
          id_usuario: idUsuario,
          token: token,
          plataforma: 'android',
          updated_at: new Date().toISOString()
        },
        { onConflict: 'id_usuario,token' }
      );

    if (error) {
      console.error('Error guardando token:', error);
    }
  }

  /**
   * Quita el token de este dispositivo para que ninguna cuenta siga recibiendo
   * notificaciones aquí. Debe ejecutarse ANTES de cerrar sesión: la RPC exige
   * que el token venga del dispositivo, no del usuario, así que funciona
   * aunque la fila haya quedado de una cuenta anterior.
   */
  async eliminarToken(): Promise<void> {
    const token = this.tokenGuardado();
    this.tokenFCM = null;
    localStorage.removeItem(PushNotificationService.CLAVE_TOKEN_LOCAL);

    if (!token) return;

    try {
      const client = this.supabaseService.getClient();
      const { error } = await client.rpc('push_eliminar_token', { p_token: token });

      if (error) {
        console.warn('No se pudo usar push_eliminar_token, se borra la fila directamente:', error.message);
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;
        await client.from('push_tokens').delete().eq('id_usuario', user.id).eq('token', token);
      }
    } catch (e) {
      console.error('Error eliminando token:', e);
    }
  }

  /** Token del dispositivo vigente en memoria o en el respaldo local. */
  private tokenGuardado(): string | null {
    if (this.tokenFCM) return this.tokenFCM;

    const local = localStorage.getItem(PushNotificationService.CLAVE_TOKEN_LOCAL);
    if (local) {
      this.tokenFCM = local;
      return local;
    }

    return null;
  }

  private guardarTokenLocal(token: string): void {
    try {
      localStorage.setItem(PushNotificationService.CLAVE_TOKEN_LOCAL, token);
    } catch {
      // sin almacenamiento local el token sigue disponible en memoria
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
    const m = (mensaje || '').toLowerCase();
    return (
      m.includes('unregistered') ||
      m.includes('notregistered') ||
      m.includes('invalid argument') ||
      m.includes('invalid_argument') ||
      m.includes('not a valid')
    );
  }

  /**
   * El motivo real de FCM viene en el cuerpo de la respuesta; el mensaje de
   * supabase-js es siempre "Edge Function returned a non-2xx status code".
   */
  private async detallesDeError(error: any, respuesta: any): Promise<string> {
    const fuente = error?.context || respuesta;
    try {
      if (fuente && typeof fuente.text === 'function') {
        const texto = await fuente.text();
        if (texto) {
          try {
            const json = JSON.parse(texto);
            if (json?.details) return String(json.details);
          } catch { /* cuerpo sin JSON */ }
          return texto;
        }
      }
    } catch { /* cuerpo ya leído o inaccesible */ }

    return `Edge Function: ${error?.message || 'sin detalle'}`;
  }

  private async enviarPushFirebase(
    token: string,
    titulo: string,
    cuerpo: string,
    data?: any
  ): Promise<{ ok: boolean; error?: string; tokenInvalido?: boolean }> {
    const client = this.supabaseService.getClient();

    try {
      const { error, response } = await client.functions.invoke('enviar-push', {
        body: {
          token,
          titulo,
          cuerpo,
          data: data || {}
        }
      });

      if (error) {
        const detalles = await this.detallesDeError(error, response);
        console.error('Error en Edge Function push:', detalles);
        return { ok: false, error: detalles, tokenInvalido: this.esTokenInvalido(detalles) };
      }

      return { ok: true };
    } catch (e: any) {
      const detalles = e?.message || 'Error desconocido enviando push';
      console.error('Error enviando push:', e);
      return { ok: false, error: detalles, tokenInvalido: this.esTokenInvalido(detalles) };
    }
  }

  /**
   * Abre la ubicación del adulto en Google Maps (app o navegador).
   * El aviso sólo trae las coordenadas: así no queda pegado como texto.
   */
  private abrirMapaSos(datos: any): void {
    const lat = parseFloat(datos?.latitud);
    const lng = parseFloat(datos?.longitud);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    try {
      window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_system');
    } catch (e) {
      console.warn('No se pudo abrir la ubicación en Google Maps:', e);
    }
  }

  private async mostrarAlerta(notification: PushNotification): Promise<void> {
    const datos: any = (notification as any).data || {};
    const idSos = datos.tipo === 'sos' ? (datos.id_sos || '') : '';

    // Nunca se apilan ventanas encima de otra
    if (this.alertaVisible) return;
    this.alertaVisible = true;

    try {
      const alert = idSos
        ? await this.alertCtrl.create({
            header: notification.title || 'Alerta SOS',
            message:
              `${notification.body || ''}\n\n` +
              'Confirma para dejar de sonar y abrir la ubicación en Google Maps.',
            buttons: [
              {
                text: 'Confirmar',
                handler: () => {
                  void this.confirmarSos(idSos);
                  this.abrirMapaSos(datos);
                  void this.navRol.irAPanelPrincipal();
                }
              }
            ]
          })
        : await this.alertCtrl.create({
            header: notification.title || 'Alerta',
            message: notification.body || '',
            buttons: ['OK']
          });

      await alert.present();
    } catch (e) {
      console.warn('No se pudo mostrar la alerta:', e);
    } finally {
      this.alertaVisible = false;
    }
  }

  private async publicarEnBarra(notification: PushNotification): Promise<void> {
    try {
      const { LocalNotifications: LN } = await import('@capacitor/local-notifications');
      const perm = await LN.checkPermissions();
      if (perm.display !== 'granted') {
        await LN.requestPermissions();
      }

      const datos: any = (notification as any).data || {};
      const canal = this.canalDeDatos(datos);
      const idSos = datos.tipo === 'sos' ? (datos.id_sos || '') : '';

      // Sesión ya confirmada: no se vuelve a publicar nada
      if (idSos && this.sosAtendidos.has(idSos)) return;

      // En la barra sólo aparece el botón de confirmar
      if (idSos && !this.accionSosRegistrada) {
        try {
          await LN.registerActionTypes({
            types: [{
              id: PushNotificationService.ACCION_SOS,
              actions: [{ id: 'confirmar', title: 'Confirmar' }]
            }]
          });
          this.accionSosRegistrada = true;
        } catch (e) {
          console.warn('No se pudo registrar el botón Confirmar:', e);
        }
      }

      const aviso = {
        title: notification.title || 'Alerta SOS',
        body: notification.body || 'Emergencia detectada',
        // ID estable por sesión: el aviso repetido del adulto REEMPLAZA al
        // anterior en vez de apilarse (y sonar así una y otra vez).
        id: idSos
          ? this.idNotificacionSos(idSos)
          : Math.floor(Date.now() % 2000000000),
        channelId: canal,
        autoCancel: true,
        extra: { ...datos },
        actionTypeId: idSos && this.accionSosRegistrada
          ? PushNotificationService.ACCION_SOS
          : undefined
      };

      try {
        await LN.schedule({ notifications: [aviso] });
      } catch (e) {
        // Equipos que no aceptan la acción: se publica igual, sin el botón
        await LN.schedule({ notifications: [{ ...aviso, actionTypeId: undefined }] });
        console.warn('Notificación SOS publicada sin botón de acción:', e);
      }
      console.log('Notificación publicada en barra');
    } catch (e) {
      console.warn('Error publicando en barra:', e);
    }
  }

  /** Canal de Android que corresponde según los datos del push. */
  private canalDeDatos(datos: any): string {
    if (typeof datos?.canal === 'string' && datos.canal) return datos.canal;
    if (datos?.tipo === 'zona_segura') return 'zona-alertas';
    return 'sos-alertas';
  }

  getToken(): string | null {
    return this.tokenFCM;
  }
}

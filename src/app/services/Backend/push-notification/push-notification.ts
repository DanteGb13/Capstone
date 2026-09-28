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

  /**
   * Cuenta a la que se asocia HOY este token del dispositivo.
   *
   * Es la pieza que detecta el cambio de sesión: el token FCM pertenece al
   * TELÉFONO, no a la persona. Si la cuenta dueña guardada es distinta de la
   * sesión actual, hay que liberar el token antes de asociarlo a la nueva, o la
   * cuenta anterior sigue recibiendo alertas en este teléfono.
   */
  private static readonly CLAVE_TOKEN_DUENIO = 'push_token_duenio';

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
    //
    // Además, `register()` vuelve a pedir el token a FCM en cada arranque y el
    // evento `registration` se dispara siempre (mire el plugin: llama a
    // FirebaseMessaging.getToken() y emite el token sea cual sea), así que
    // guardar lo que ya tenemos cubre el caso en que el evento tarde.
    const tokenPrevio = this.tokenGuardado();
    if (tokenPrevio) {
      void this.asegurarTokenRegistrado(tokenPrevio);
    }
  }

  /**
   * Deja el token registrado en la base y, si no queda, reintenta.
   *
   * Esto es lo que hace que el teléfono se repare solo. El caso real que se
   * corrigió: `enviar-push` borra la fila cuando FCM marca el token como
   * caducado, y si la app no puede volver a insertar (la RLS no lo permite),
   * el teléfono se queda para siempre sin push: ni SOS, ni zona segura, ni
   * "estoy en casa". Con este reintento, la siguiente vez que se abre la app
   * la fila vuelve a existir.
   */
  private async asegurarTokenRegistrado(token: string): Promise<void> {
    const intentos = 3;

    for (let intento = 1; intento <= intentos; intento++) {
      try {
        await this.guardarToken(token);
        if (this.tokenRegistrado) return;
      } catch (e) {
        console.warn(`[PUSH] intento ${intento}/${intentos} falló:`, e);
      }

      if (intento < intentos) {
        await new Promise((resolver) => setTimeout(resolver, 2000 * intento));
      }
    }

    console.error(
      `[PUSH] El token NO quedó registrado tras ${intentos} intentos. ` +
        'Este teléfono no recibirá alertas. Revisá que la Edge Function ' +
        '"sincronizar-token" esté desplegada.'
    );
  }

  /** Lo deja en true la última verificación del token, para saber si hay que reintentar. */
  private tokenRegistrado = false;

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
      // El token FCM NO se loguea: es una credencial. Con él cualquiera puede
      // mandar notificaciones a este teléfono. `adb logcat` lo muestra entero.
      console.log('Token FCM recibido (no se muestra por seguridad)');
      // Pasa por asegurarTokenRegistrado (y no guardarToken directo) para que
      // reintente si la fila no queda: así el teléfono se repara solo.
      void this.asegurarTokenRegistrado(token.value);
    });

    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('Error de registro push:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotification) => {
      console.log('Notificación recibida:', notification);
      const datos: any = (notification as any).data || {};
      const idSos = datos.tipo === 'sos' ? (datos.id_sos || '') : '';

      // Si el aviso NO es para la sesión que hay abierta en este teléfono, se
      // ignora por completo. Es la barrera que impide que suene una alerta de
      // la cuenta que estuvo antes, aunque la fila del token siga en la base.
      void this.esDeLaSesionActual(datos).then((mio) => {
        if (!mio) {
          console.warn('Notificación descartada: no pertenece a la sesión actual');
          return;
        }

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
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('Acción en notificación:', action);
      const datos: any = (action as any)?.notification?.data || {};

      void this.esDeLaSesionActual(datos).then((mio) => {
        if (!mio) {
          console.warn('Acción de notificación descartada: no pertenece a la sesión actual');
          return;
        }

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
    });

    // Tocar la notificación de la barra publicada por esta misma app
    // también confirma el SOS (si no, el aviso seguía sonando para siempre).
    if (Capacitor.isPluginAvailable('LocalNotifications')) {
      LocalNotifications.addListener('localNotificationActionPerformed', (accion: any) => {
        const datos = accion?.notification?.extra || {};

        void this.esDeLaSesionActual(datos).then((mio) => {
          if (!mio) return;

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
    // Guarda el respaldo local de inmediato: si algo falla más abajo, al menos
    // el token queda en el teléfono y se puede intentar de nuevo al abrir.
    this.guardarTokenLocal(token);

    try {
      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      // RUTA PRINCIPAL: la Edge Function `sincronizar-token`.
      //
      // Se usa de entrada y no el insert directo porque la RLS de push_tokens
      // no deja que la app escriba: por eso la fila se perdía y el teléfono
      // quedaba sin ningún push para siempre. Con service_role siempre anda.
      const sincronizado = await this.sincronizarTokenEnServidor(token, user.id);

      if (!sincronizado) {
        // Respaldo: insert directo. Sirve sólo si este usuario tiene permiso
        // de INSERT en la tabla, pero no cuesta nada intentarlo.
        console.warn(
          '[PUSH] no se pudo usar sincronizar-token, se intenta insert directo'
        );
        await this.guardarTokenPorUpsert(token, user.id);
      }

      this.duenioDelToken(user.id);

      await this.verificarTokenEnBase(client, user.id, token);
    } catch (e) {
      console.error('Error guardando token:', e);
    }
  }

  /**
   * Pide a la Edge Function que registre el token y lo suelte de las demás
   * cuentas. Devuelve false si no se pudo (función no desplegada, sin red…).
   */
  private async sincronizarTokenEnServidor(
    token: string,
    idUsuario: string
  ): Promise<boolean> {
    try {
      const { data, error } = await this.supabaseService.getClient().functions.invoke(
        'sincronizar-token',
        { body: { token, plataforma: 'android' } }
      );

      if (error) {
        const detalle = await this.detallesDeError(error, (error as any).response);
        console.warn('[PUSH] sincronizar-token falló:', detalle);
        return false;
      }

      const filas = (data as any)?.filas ?? 0;
      console.log('[PUSH] token sincronizado con el servidor, filas:', filas);
      return true;
    } catch (e) {
      console.warn('[PUSH] no se pudo sincronizar el token:', e);
      return false;
    }
  }

  /**
   * Comprueba que la fila del token realmente quedó en `push_tokens`.
   *
   * Sin esto, un fallo al guardar el token era invisible: la app no mostraba
   * ningún error y el empujón simplemente nunca llegaba. Con esta línea, el
   * logcat responde sí o sí si el teléfono quedó registrado.
   *
   * En logcat la línea a buscar es `[PUSH] token en la base: SI/NO`.
   */
  private async verificarTokenEnBase(
    client: ReturnType<SupabaseService['getClient']>,
    idUsuario: string,
    token: string
  ): Promise<void> {
    try {
      const { data, error } = await client
        .from('push_tokens')
        .select('id_usuario')
        .eq('id_usuario', idUsuario)
        .eq('token', token)
        .limit(1);

      if (error) {
        console.warn('[PUSH] no se pudo verificar el token:', error.message);
        return;
      }

      const guardado = !!(data && data.length > 0);
      this.tokenRegistrado = guardado;
      console.log(`[PUSH] token en la base: ${guardado ? 'SI' : 'NO'}`);

      if (!guardado) {
        console.error(
          '[PUSH] ESTE TELÉFONO NO RECIBIRÁ ALERTAS. El token no quedó en ' +
            'push_tokens. Revisá que la Edge Function "sincronizar-token" esté ' +
            'desplegada.'
        );
      }
    } catch (e) {
      console.warn('[PUSH] falló la verificación del token:', e);
    }
  }

  /**
   * Quita este token de las filas de OTRAS cuentas.
   *
   * La RLS no deja que un usuario borre filas ajenas de `push_tokens`, así que
   * la limpieza se pide a la Edge Function `sincronizar-token`, que sí usa
   * service_role (mismo patrón que `enviar-push` ya usa para descartar tokens
   * caducados).
   *
   * Es una mejora, nunca un requisito: si la función no está desplegada, la app
   * avisa por log y sigue. El filtro de notificaciones por sesión (más abajo)
   * impide que se muestren avisos de otra cuenta aunque la fila quede ahí.
   */
  private async liberarDeOtrasCuentas(token: string, idUsuarioActual: string): Promise<void> {
    const duenio = this.duenioDelToken();

    // Si el token ya era de esta misma cuenta, no hay nada que liberar.
    if (duenio === idUsuarioActual) return;

    try {
      const { error } = await this.supabaseService.getClient().functions.invoke(
        'sincronizar-token',
        { body: { token, plataforma: 'android' } }
      );

      if (error) {
        const detalles = await this.detallesDeError(error, (error as any).response);
        console.warn(
          'No se pudo liberar el token de otras cuentas (¿desplegaste sincronizar-token?):',
          detalles
        );
        return;
      }

      if (duenio) {
        console.log(`Token liberado de la cuenta anterior (${duenio.slice(0, 8)})`);
      }
    } catch (e) {
      console.warn('No se pudo liberar el token de otras cuentas:', e);
    }
  }

  /** Cuenta a la que se asocia hoy este token, guardada en el teléfono. */
  private duenioDelToken(id?: string): string | null {
    try {
      if (id) {
        localStorage.setItem(PushNotificationService.CLAVE_TOKEN_DUENIO, id);
        return id;
      }
      return localStorage.getItem(PushNotificationService.CLAVE_TOKEN_DUENIO);
    } catch {
      return null;
    }
  }

  /**
   * Descarta las notificaciones que no son para la sesión actual.
   *
   * Última línea de defensa: aunque la fila del token haya quedado en la base
   * para otra cuenta (Edge Function sin desplegar, cierre de sesión sin red…),
   * el aviso se ignora en vez de sonar. En una alerta de seguridad no se
   * muestra nada de otra persona.
   *
   * Al abrir la app desde la notificación la sesión tarda un instante en
   * restaurarse, así que si todavía no hay sesión se espera breve antes de
   * decidir. Sin esa espera, el SOS de una cuenta LEGÍTIMA se descartaría
   * justo en el momento en que la persona lo está tocando para confirmar.
   */
  private async esDeLaSesionActual(datos: any): Promise<boolean> {
    const destinatario = datos?.id_usuario_destino ?? datos?.id_destino;
    if (!destinatario) {
      // Sin destinatario explícito no hay forma de comprobar: se deja pasar
      // (es el caso de un push sin metadatos, que la app ya asumía propio).
      return true;
    }

    // Espera acotada a que la sesión se restaure (ocurre al abrir desde la
    // notificación, con la app cerrada).
    for (let intento = 0; intento < 5; intento++) {
      try {
        const { data } = await this.supabaseService.getClient().auth.getSession();
        const idActual = data?.session?.user?.id;

        if (idActual) {
          return idActual === destinatario;
        }
      } catch {
        // sigue sin poder leerse: se reintenta
      }

      if (intento < 4) {
        await new Promise((resolver) => setTimeout(resolver, 600));
      }
    }

    // Pasados ~3 s sigue sin haber sesión: se descarta. Ante la duda se
    // prefiere no hacer sonar una alerta que no se puede verificar.
    console.warn('Aviso descartado: la sesión no se pudo restaurar a tiempo');
    return false;
  }

  /**
   * Respaldo para cuando la RPC `push_registrar_token` todavía no está
   * desplegada en Supabase.
   *
   * ANTES usaba `upsert(..., { onConflict: 'id_usuario,token' })`, y eso es una
   * bomba de tiempo: `onConflict` necesita que exista un índice ÚNICO sobre esas
   * columnas. Si el índice no está (porque la migración no se corrió, o porque
   * falló al crearlo por filas duplicadas), Postgres responde
   * "no hay restricción única que coincida con ON CONFLICT" y el token NO se
   * guarda: el teléfono se queda sin ningún push, sin error visible en la app.
   *
   * Por eso ahora es delete + insert. Las dos operaciones las permite la RLS
   * (son filas propias) y funcionan exista o no el índice.
   */
  private async guardarTokenPorUpsert(token: string, idUsuario: string): Promise<void> {
    const client = this.supabaseService.getClient();

    try {
      // Se borra cualquier fila de ESTE usuario con ESTE token para no dejar
      // duplicados.
      const { error: errorBorrado } = await client
        .from('push_tokens')
        .delete()
        .eq('id_usuario', idUsuario)
        .eq('token', token);

      if (errorBorrado) {
        console.warn('No se pudo limpiar la fila previa del token:', errorBorrado.message);
      }

      const { error } = await client
        .from('push_tokens')
        .insert({
          id_usuario: idUsuario,
          token: token,
          plataforma: 'android',
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error guardando el token en push_tokens:', error.message);
        return;
      }

      console.log('Token registrado en push_tokens (respaldo):', idUsuario);
    } catch (e) {
      console.error('Error guardando token:', e);
    }
  }

  /**
   * Quita el token de este dispositivo para que ninguna cuenta siga recibiendo
   * notificaciones aquí.
   *
   * Son dos cosas distintas y antes se confundían:
   *  - la fila de la cuenta ACTUAL: se puede borrar con un delete normal, la
   *    RLS lo permite porque es su propia fila.
   *  - las filas de OTRAS cuentas con el mismo token: la RLS las bloquea, así
   *    que se delega en la Edge Function `sincronizar-token` (service_role).
   *
   * El fallback local de abajo intentaba borrar las filas ajenas con un delete
   * normal: la RLS le hacía nada en silencio, y la cuenta anterior quedaba
   * suscrita a las alertas en este teléfono.
   */
  async eliminarToken(): Promise<void> {
    const token = this.tokenGuardado();
    const idUsuario = await this.idUsuarioActual();
    this.tokenFCM = null;
    this.tokenRegistrado = false;

    try {
      localStorage.removeItem(PushNotificationService.CLAVE_TOKEN_LOCAL);
      localStorage.removeItem(PushNotificationService.CLAVE_TOKEN_DUENIO);
    } catch {
      // sin almacenamiento local el token sigue solo en memoria
    }

    if (!token) return;

    try {
      // 1. Se suelta de las demás cuentas primero: es lo que evita que la
      //    cuenta anterior siga recibiendo alertas aunque el cierre de sesión
      //    se corte aquí.
      await this.liberarDeOtrasCuentas(token, idUsuario ?? '');

      // 2. Se borra la fila propia (la RLS lo permite sin permisos especiales).
      const client = this.supabaseService.getClient();

      if (idUsuario) {
        await client.from('push_tokens').delete().eq('id_usuario', idUsuario).eq('token', token);
      }
    } catch (e) {
      console.error('Error eliminando el token propio:', e);
    }
  }

  /** Id de la sesión actual sin fallar si no hay sesión. */
  private async idUsuarioActual(): Promise<string | null> {
    try {
      const { data } = await this.supabaseService.getClient().auth.getSession();
      return data?.session?.user?.id ?? null;
    } catch {
      return null;
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

      // Se agrega el destinatario acá y no en cada punto de llamada: es la
      // única forma de garantizar que NINGÚN push salga sin él. El teléfono
      // receptor lo usa para descartar el aviso si no es de la cuenta que tiene
      // abierta la sesión.
      const datosConDestino = { ...(data || {}), id_usuario_destino: idUsuarioDestino };

      let enviadosOk = 0;
      const errores: string[] = [];

      for (const t of tokens) {
        try {
          const r = await this.enviarPushFirebase(t.token, titulo, cuerpo, datosConDestino);
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

  /**
   * Estado de todo el circuito de push, para mostrarlo en pantalla.
   *
   * Existe para no depender de leer logs: con esto se responde en la app si el
   * permiso está concedido, si se consiguió el token y si quedó guardado en
   * la base. Los tres "sí" son los que hacen que el SOS llegue.
   */
  async diagnostico(): Promise<DiagnosticoPush> {
    const resultado: DiagnosticoPush = {
      esNativo: this.isNative,
      pluginDisponible: false,
      permisoNotificaciones: 'desconocido',
      hayToken: false,
      tokenEnBase: false,
      mensaje: ''
    };

    if (!this.isNative) {
      resultado.mensaje = 'Sólo funciona en la app de Android.';
      return resultado;
    }

    try {
      resultado.pluginDisponible = Capacitor.isPluginAvailable('PushNotifications');
    } catch {
      // sigue en false
    }

    // 1. Permiso de notificaciones: sin esto NO hay push ni alertas en la barra.
    try {
      const { PushNotifications: PN } = await import('@capacitor/push-notifications');
      const permiso = await PN.checkPermissions();
      resultado.permisoNotificaciones = permiso.receive;
    } catch {
      // se deja desconocido
    }

    // 2. Token: se pide a FCM si aún no lo tenemos.
    let token = this.tokenGuardado();
    if (!token && resultado.pluginDisponible) {
      try {
        const { PushNotifications: PN } = await import('@capacitor/push-notifications');
        await PN.register();
        // El evento `registration` es asíncrono: se espera un poco a que llegue.
        token = await this.esperarToken(2500);
      } catch {
        // se deja sin token
      }
    }
    resultado.hayToken = !!token;

    // 3. ¿Está en la base? Eso es lo que revisa el emisor del push.
    if (token) {
      try {
        const cliente = this.supabaseService.getClient();
        const { data: sesion } = await cliente.auth.getSession();
        const idUsuario = sesion?.session?.user?.id;

        if (idUsuario) {
          const { data, error } = await cliente
            .from('push_tokens')
            .select('id_usuario')
            .eq('id_usuario', idUsuario)
            .eq('token', token)
            .limit(1);

          if (!error) resultado.tokenEnBase = !!(data && data.length > 0);
        }
      } catch {
        // se deja en false
      }
    }

    resultado.mensaje = this.resumenDiagnostico(resultado);
    return resultado;
  }

  /** Espera a que el evento `registration` traiga el token. */
  private async esperarToken(ms: number): Promise<string | null> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (this.tokenFCM) return this.tokenFCM;
      await new Promise((r) => setTimeout(r, 200));
    }
    return this.tokenGuardado();
  }

  private resumenDiagnostico(d: DiagnosticoPush): string {
    if (!d.pluginDisponible) return 'El plugin de push no está disponible en esta build.';
    if (d.permisoNotificaciones !== 'granted') {
      return 'Falta el permiso de notificaciones: sin él no llega ningún aviso.';
    }
    if (!d.hayToken) {
      return 'FCM no devolvió un token. Suele ser el google-services.json o falta de internet.';
    }
    if (!d.tokenEnBase) {
      return 'El token existe pero NO está guardado en push_tokens: nadie te puede avisar.';
    }
    return 'Todo listo: este teléfono recibe alertas.';
  }

  /** Reintenta el registro del token a pedido del usuario. */
  async reintentarRegistro(): Promise<boolean> {
    try {
      const { PushNotifications: PN } = await import('@capacitor/push-notifications');
      await PN.register();
      const token = await this.esperarToken(4000);
      if (!token) return false;
      await this.asegurarTokenRegistrado(token);
      return this.tokenRegistrado;
    } catch (e) {
      console.warn('No se pudo reintentar el registro:', e);
      return false;
    }
  }
}

export interface DiagnosticoPush {
  esNativo: boolean;
  pluginDisponible: boolean;
  permisoNotificaciones: string;
  hayToken: boolean;
  tokenEnBase: boolean;
  mensaje: string;
}

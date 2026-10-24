import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject } from 'rxjs';
import { UbicacionForeground } from '../Backend/ubicacion-foreground/ubicacion-foreground';
import { PermisosExtra } from '../Backend/permisos-extra/permisos-extra';
import { SiempreCerca, EstadoNotificaciones, EstadoPermisoAndroid } from '../alarmas/siempre-cerca';
/**
 * Estado real de un permiso.
 *
 * `denegado` y `bloqueado` se separan porque significan cosas distintas:
 *  - denegado  -> el usuario dijo que no por ahora. Se puede volver a preguntar.
 *  - bloqueado -> el usuario eligió "no volver a preguntar", o lo apagó en
 *                 Ajustes. Android NO vuelve a mostrar el diálogo, así que
 *                 seguir insistiendo no sirve: hay que mandarlo a Ajustes.
 *
 * Con un solo booleano no se puede distinguir, y por eso la app terminaba
 * preguntando permisos que el sistema ya no iba a mostrar.
 */
export type EstadoPermiso =
  | 'concedido'
  | 'denegado'
  | 'bloqueado'
  | 'no-aplica'
  | 'desconocido';

/** Cuándo se pide. Ver `PERMISOS_DEFINICION`. */
export type MomentoPermiso = 'inicial' | 'al-usar';

export interface PermisoInfo {
  id: string;
  nombre: string;
  descripcion: string;
  /** Para qué lo necesita la persona, en lenguaje simple (pantalla previa). */
  paraQue: string;
  /**
   * Explicación larga que se muestra desplegada dentro de la tarjeta de la
   * pantalla de permisos. Antes vivía metida en el HTML, repetido por cada
   * permiso; aquí es un dato más.
   */
  detalle: string;
  icono: string;
  momento: MomentoPermiso;
  /** Si está apagado y es crítico, el panel avisa. */
  critico: boolean;
  estado: EstadoPermiso;
  /** Matiz, por ejemplo "solo ubicación aproximada". */
  nota?: string;
  /** false = hay que ir a Ajustes, no sirve pedir de nuevo. */
  puedePedir: boolean;
}

interface DefinicionPermiso {
  id: string;
  nombre: string;
  descripcion: string;
  paraQue: string;
  detalle: string;
  icono: string;
  momento: MomentoPermiso;
  critico: boolean;
}

/** Resultado de leer un permiso: estado + si se puede volver a pedir. */
interface ResultadoPermiso {
  estado: EstadoPermiso;
  nota?: string;
  puedePedir: boolean;
}

const CLAVE_PREGUNTADOS = 'sc_permisos_preguntados';
const CLAVE_ONBOARDING = 'sc_permisos_onboarding_v1';

/**
 * Los permisos que se piden al entrar vs. los que se piden cuando se usan.
 *
 * Pedir los ocho de golpe al arrancar es lo que hace que la gente los niegue:
 * el usuario ve una lista larga, concede el que le suena y tapuja el resto, y
 * los denegados en los primeros minutos se quedan denegados. Por eso sólo
 * entran los que la app no puede hacer nada sin ellos.
 */
const PERMISOS_DEFINICION: DefinicionPermiso[] = [
  {
    id: 'notificaciones',
    nombre: 'Notificaciones',
    descripcion: 'Avisos y alertas de seguridad',
    paraQue:
      'Sin notificaciones no te podemos avisar si tu cuidador necesita ayuda, ' +
      'ni mostrarte recordatorios de medicinas a tiempo.',
    detalle: 'Permite recibir alertas de seguridad, recordatorios de medicinas y avisos importantes. Necesario para que aparezca el aviso del recordatorio en la barra de notificaciones.',
    icono: 'notifications-outline',
    momento: 'inicial',
    critico: true
  },
  {
    id: 'ubicacion',
    nombre: 'Ubicación',
    descripcion: 'Para saber dónde estás',
    paraQue:
      'Tu cuidador necesita ver dónde estás para poder llegar a ayudarte. ' +
      'Puedes elegir darle solo la ubicación aproximada.',
    detalle: 'Permite que la app acceda a tu ubicación actual para mostrarla en el mapa y rastrearla. Para el monitoreo continuo, en los ajustes de ubicación selecciona "Permitir todo el tiempo".',
    icono: 'location-outline',
    momento: 'inicial',
    critico: true
  },
  {
    id: 'ubicacion-fondo',
    nombre: 'Ubicación en segundo plano',
    descripcion: 'Seguir cuidándote con la app cerrada',
    paraQue:
      'Con la app cerrada, esta app sigue avisando a tu cuidador si sales de ' +
      'tu zona segura. Sin este permiso, solo funciona con la app abierta.',
    detalle: 'Con la app cerrada, esta app sigue avisando a tu cuidador si sales de tu zona segura. Actívalo en Ajustes del sistema eligiendo "Permitir todo el tiempo".',
    icono: 'navigate-outline',
    momento: 'inicial',
    critico: true
  },
  {
    id: 'bateria',
    nombre: 'Funcionar en segundo plano',
    descripcion: 'Que Android no detenga la app',
    paraQue:
      'Android apaga las apps que no usa para ahorrar batería. Si nos deja ' +
      'funcionar en segundo plano, los avisos de seguridad llegan siempre.',
    detalle: 'Permite que la app funcione en segundo plano sin que Android la cierre. Esencial para que las alarmas suenen con el teléfono en reposo.',
    icono: 'battery-charging-outline',
    momento: 'inicial',
    critico: true
  },
  {
    id: 'camara',
    nombre: 'Cámara',
    descripcion: 'Tomar fotos de perfil',
    paraQue: 'Para que tu cuidador sepa a quién está cuidando.',
    detalle: 'Permite tomar fotos para la foto de perfil del usuario.',
    icono: 'camera-outline',
    momento: 'al-usar',
    critico: false
  },
  {
    id: 'alarma-exacta',
    nombre: 'Alarma exacta',
    descripcion: 'Que los recordatorios suenen a la hora',
    paraQue:
      'Con el teléfono en reposo, Android retrasa los recordatorios. Con este ' +
      'permiso suenan justo a la hora en que los pusiste, que es lo que ' +
      'importa con la medicación.',
    detalle: 'Permite que el recordatorio suene exactamente a la hora marcada y no llegue con retraso por el modo reposo del teléfono.',
    icono: 'time-outline',
    momento: 'al-usar',
    critico: false
  },
  {
    id: 'fotos',
    nombre: 'Fotos y videos',
    descripcion: 'Elegir una de la galería',
    paraQue: 'Para elegir una foto de tu perfil o de un contacto.',
    detalle: 'Permite acceder a la galería para seleccionar fotos o videos ya existentes.',
    icono: 'images-outline',
    momento: 'al-usar',
    critico: false
  },
  {
    id: 'contactos',
    nombre: 'Contactos',
    descripcion: 'Agregar un contacto de emergencia',
    paraQue:
      'Para agregar a tus contactos como contacto de emergencia sin escribirlos ' +
      'a mano uno por uno.',
    detalle: 'Permite acceder a tu lista de contactos para seleccionar personas de emergencia, sin escribirlas a mano.',
    icono: 'people-outline',
    momento: 'al-usar',
    critico: false
  },
  {
    id: 'telefono',
    nombre: 'Teléfono',
    descripcion: 'Llamar en emergencia',
    paraQue: 'Para llamar al contacto de emergencia con un solo toque.',
    detalle: 'Permite realizar llamadas de emergencia directamente desde la app.',
    icono: 'call-outline',
    momento: 'al-usar',
    critico: false
  }
];

@Injectable({ providedIn: 'root' })
export class PermisosService {

  private isNative = Capacitor.isNativePlatform();

  /**
   * Estado actual, para que los paneles se actualicen solos.
   * Emite tras cada verificación o solicitud.
   */
  private readonly estado$ = new BehaviorSubject<PermisoInfo[]>([]);

  get cambios(): BehaviorSubject<PermisoInfo[]> {
    return this.estado$;
  }

  // =====================================================
  // LIBRO DE REGISTRO (qué se YA PREGUNTÓ)
  // =====================================================

  /**
   * Sólo se guarda QUÉ SE PREGUNTÓ, nunca si quedó concedido.
   *
   * Guardar "concedido" en local sería un error: si el usuario después apaga el
   * permiso en Ajustes del sistema, la app seguiría SayingPermitido y el SOS
   * dejaría de sonar sin avisar. El estado real siempre se lee del sistema.
   */
  private leerPreguntados(): Record<string, boolean> {
    try {
      const bruto = localStorage.getItem(CLAVE_PREGUNTADOS);
      return bruto ? JSON.parse(bruto) : {};
    } catch {
      return {};
    }
  }

  private marcarPreguntado(id: string): void {
    try {
      const actuales = this.leerPreguntados();
      actuales[id] = true;
      localStorage.setItem(CLAVE_PREGUNTADOS, JSON.stringify(actuales));
    } catch {
      // sin almacenamiento local: se vuelve a preguntar, no es grave
    }
  }

  yaPreguntado(id: string): boolean {
    return this.leerPreguntados()[id] === true;
  }

  /**
   * La pantalla de bienvenida de permisos ya se completó.
   *
   * Se guarda en localStorage y también en memoria. La copia en memoria es lo
   * que evita un bucle infinito: si el almacenamiento local fallara (modo
   * privado, cuota llena), el flag nunca se escribiría, el guard devolvería
   * "no completado" para siempre y la app rebotaría entre el panel y la
   * pantalla de permisos sin poder salir.
   */
  private onboardingHechoEnMemoria = false;

  onboardingCompletado(): boolean {
    if (this.onboardingHechoEnMemoria) return true;
    try {
      const hecho = localStorage.getItem(CLAVE_ONBOARDING) === '1';
      if (hecho) this.onboardingHechoEnMemoria = true;
      return hecho;
    } catch {
      // Sin almacenamiento: se decide con la copia en memoria, que para esta
      // sesión es suficiente.
      return this.onboardingHechoEnMemoria;
    }
  }

  marcarOnboardingCompletado(): void {
    this.onboardingHechoEnMemoria = true;
    try {
      localStorage.setItem(CLAVE_ONBOARDING, '1');
    } catch {
      // ver onboardingCompletado(): la copia en memoria alcanza
    }
  }

  // =====================================================
  // DEFINICIÓN
  // =====================================================

  definicion(id: string): DefinicionPermiso | undefined {
    return PERMISOS_DEFINICION.find((p) => p.id === id);
  }

  /** Sólo los que se piden al entrar a la app. */
  definicionesIniciales(): DefinicionPermiso[] {
    return PERMISOS_DEFINICION.filter((p) => p.momento === 'inicial');
  }

  definicionesAlUsar(): DefinicionPermiso[] {
    return PERMISOS_DEFINICION.filter((p) => p.momento === 'al-usar');
  }

  /**
   * Catálogo con el estado por defecto, sin tocar el sistema.
   * Sirve para pintar la pantalla antes de que responda la verificación real.
   */
  getPermisosPorDefecto(): PermisoInfo[] {
    return PERMISOS_DEFINICION.map((d) => ({
      ...d,
      estado: 'desconocido' as EstadoPermiso,
      puedePedir: true
    }));
  }

  // =====================================================
  // VERIFICACIÓN (fuente de verdad: el sistema)
  // =====================================================

  /**
   * Lee el estado REAL de todos los permisos. Se puede llamar cada vez que la
   * app vuelve al primer plano: el usuario (o Android) puede haber apagado
   * algo en Ajustes en cualquier momento.
   */
  async verificarTodos(): Promise<PermisoInfo[]> {
    if (!this.isNative) {
      // En el navegador sólo existe el permiso de notificaciones; el resto de
      // los plugins no están disponibles.
      const web = await this.verificarNotificacionesWeb();
      const lista: PermisoInfo[] = this.getPermisosPorDefecto().map((p) => {
        if (p.id !== 'notificaciones') {
          return { ...p, estado: 'no-aplica' as EstadoPermiso, puedePedir: false };
        }
        return { ...p, estado: (web ? 'concedido' : 'denegado') as EstadoPermiso, puedePedir: !web };
      });
      this.estado$.next(lista);
      return lista;
    }

    // Todas las lecturas en paralelo: son 5 viajes al sistema y encadenarlos
    // se notaba en la pantalla de permisos.
    const [ubicacion, notificaciones, extra, bateria, alarma] = await Promise.all([
      this.leerUbicacion(),
      this.leerNotificaciones(),
      this.leerExtra(),
      this.leerBateria(),
      this.leerAlarmaExacta()
    ]);

    // Se cruza con el estado nativo ANTES de armar la lista. No se puede hacer
    // dentro del .map() porque es síncrono y `combinar` es asíncrono: un await
    // ahí devolvería promesas y la lista quedaría llena de objetos vacíos.
    const [notif, tel, cont, camara, fotos] = await Promise.all([
      this.combinar('notificaciones', notificaciones),
      this.combinar('telefono', {
        estado: extra.telefono ? 'concedido' : 'denegado',
        puedePedir: !extra.telefono
      }),
      this.combinar('contactos', {
        estado: extra.contactos ? 'concedido' : 'denegado',
        puedePedir: !extra.contactos
      }),
      this.combinar('camara', { estado: 'desconocido', puedePedir: true }),
      this.combinar('fotos', { estado: 'desconocido', puedePedir: true })
    ]);

    // La cámara se lee una sola vez para los dos permisos que comparten diálogo.
    const camaraPlugin = await this.leerCamara();
    if (camaraPlugin.camara === 'concedido') camara.estado = 'concedido';
    else if (camaraPlugin.camara === 'denegado') camara.estado = 'denegado';
    camara.puedePedir = camaraPlugin.puedePedir;

    if (camaraPlugin.fotos === 'concedido') fotos.estado = 'concedido';
    else if (camaraPlugin.fotos === 'denegado') fotos.estado = 'denegado';
    fotos.puedePedir = camaraPlugin.puedePedir;

    const porId = new Map<string, ResultadoPermiso>([
      ['notificaciones', notif],
      ['telefono', tel],
      ['contactos', cont],
      ['camara', camara],
      ['fotos', fotos]
    ]);

    const lista: PermisoInfo[] = PERMISOS_DEFINICION.map((d) => {
      const extraInfo = porId.get(d.id);

      switch (d.id) {
        case 'notificaciones':
        case 'telefono':
        case 'contactos':
        case 'camara':
        case 'fotos':
          return { ...d, ...extraInfo! };
        case 'ubicacion':
          return { ...d, estado: ubicacion.estado, nota: ubicacion.nota, puedePedir: ubicacion.puedePedir };
        case 'ubicacion-fondo':
          return {
            ...d,
            estado: ubicacion.background.estado,
            nota: ubicacion.background.nota,
            puedePedir: ubicacion.background.puedePedir
          };
        case 'bateria':
          return { ...d, estado: bateria.estado, puedePedir: true };
        case 'alarma-exacta':
          return { ...d, estado: alarma.estado, nota: alarma.nota, puedePedir: alarma.puedePedir };
        default:
          return { ...d, estado: 'desconocido', puedePedir: true };
      }
    });

    this.estado$.next(lista);
    return lista;
  }

  // =====================================================
  // CHEQUEO NATIVO (¿se puede volver a pedir?)
  // =====================================================

  /**
   * Nombres de Android de cada permiso.
   *
   * Hacen falta porque los plugins de Capacitor sólo responden "concedido /
   * denegado" y no avisan cuándo el usuario ya eligió "no volver a preguntar".
   * En ese caso pedir el permiso no muestra nada, y la app queda con un
   * interruptor que nunca más se enciende, sin explicación.
   */
  private static readonly PERMISO_ANDROID: Record<string, string> = {
    'notificaciones': 'android.permission.POST_NOTIFICATIONS',
    'camara': 'android.permission.CAMERA',
    'fotos': 'android.permission.READ_MEDIA_IMAGES',
    'contactos': 'android.permission.READ_CONTACTS',
    'telefono': 'android.permission.READ_PHONE_STATE'
  };

  private async estadoNativo(id: string): Promise<EstadoPermisoAndroid | null> {
    const android = PermisosService.PERMISO_ANDROID[id];
    if (!android) return null;

    try {
      return await SiempreCerca.estadoPermiso(android);
    } catch (e) {
      console.warn(`No se pudo consultar el estado nativo de ${id}:`, e);
      return null;
    }
  }

  /** Deja constancia de que se mostró el diálogo de este permiso. */
  private async marcarPreguntadoNativo(id: string): Promise<void> {
    const android = PermisosService.PERMISO_ANDROID[id];
    if (!android) return;

    try {
      await SiempreCerca.marcarPermisoPreguntado(android);
    } catch {
      // sin plugin nativo: se sigue con el registro de la app
    }
  }

  /**
   * Cruza el estado del plugin con el nativo.
   *
   * El plugin sabe si el permiso está concedido (es el que pide el diálogo).
   * El nativo sabe si se puede volver a pedir. Se combinan para que ningún
   * permiso se reporte como "se puede pedir" cuando ya no es cierto.
   */
  private async combinar(id: string, resultado: ResultadoPermiso): Promise<ResultadoPermiso> {
    const nativo = await this.estadoNativo(id);
    if (!nativo) return resultado;

    if (nativo.concedido) {
      // Si quien llama ya sabe que algo falla APARTE del permiso (por ejemplo,
      // el canal de alertas apagado a mano en Ajustes), ese estado se conserva.
      // Tener el permiso concedido no significa que las alertas suenen, y
      // pisar ese dato hacía que la app volviera a informar "todo bien"
      // mientras el SOS salía en silencio.
      if (resultado.estado === 'bloqueado') return resultado;
      return { ...resultado, estado: 'concedido', puedePedir: false };
    }

    if (nativo.bloqueado) {
      return {
        estado: 'bloqueado',
        nota: 'Elegiste "no volver a preguntar", así que Android no vuelve a mostrar la ventana.',
        puedePedir: false
      };
    }

    return { ...resultado, estado: 'denegado', puedePedir: nativo.puedePedir };
  }

  // =====================================================
  // LECTORES POR PERMISOS
  // =====================================================

  private async leerUbicacion(): Promise<{
    estado: EstadoPermiso;
    nota?: string;
    puedePedir: boolean;
    background: ResultadoPermiso;
  }> {
    try {
      const r = await UbicacionForeground.verificarPermisos();

      let estado: EstadoPermiso = 'denegado';
      let nota: string | undefined;

      if (r.precisa) {
        estado = 'concedido';
      } else if (r.aproximada) {
        // No es un error: el usuario eligió aproximada a propósito. Se marca
        // concedido CON nota para que la interfaz pueda avisar igual.
        estado = 'concedido';
        nota = 'Ubicación aproximada: puede estar lejos de tu posición real.';
      } else if (!r.puedePedirForeground) {
        estado = 'bloqueado';
      }

      let background: ResultadoPermiso;
      if (!r.backgroundAplica) {
        background = { estado: 'no-aplica', puedePedir: false };
      } else if (r.ubicacionBackground) {
        background = { estado: 'concedido', puedePedir: false };
      } else if (estado === 'denegado' || estado === 'bloqueado') {
        // Primero hay que tener el de primer plano.
        background = {
          estado: 'denegado',
          nota: 'Primero activa la ubicación.',
          puedePedir: false
        };
      } else {
        background = {
          estado: r.puedePedirBackground ? 'denegado' : 'bloqueado',
          puedePedir: r.puedePedirBackground
        };
      }

      return { estado, nota, puedePedir: r.puedePedirForeground, background };
    } catch (e) {
      console.warn('No se pudo verificar la ubicación:', e);
      return {
        estado: 'desconocido',
        puedePedir: true,
        background: { estado: 'desconocido', puedePedir: true }
      };
    }
  }

  private async leerNotificaciones(): Promise<ResultadoPermiso> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permiso = await LocalNotifications.checkPermissions();

      if (permiso.display !== 'granted') {
        // Se consulta el estado nativo para saber si Android todavía mostraría
        // la ventana. Antes se respondía siempre "puede pedir", y si el usuario
        // ya la había bloqueado la solicitud no hacía nada: el interruptor se
        // quedaba apagado y sin explicación.
        return await this.combinar('notificaciones', { estado: 'denegado', puedePedir: true });
      }

      // El permiso puede estar bien y el canal apagado a mano en Ajustes.
      // Sin esta comprobación la app informaba "todo bien" mientras el SOS
      // sonaba en silencio.
      const canales = await SiempreCerca.verificarNotificaciones().catch(() => null);

      if (canales && !canales.alertaFunciona) {
        const apagados: string[] = [];
        if (!canales.sosActivo) apagados.push('Alertas SOS');
        if (!canales.zonaAlertaActivo) apagados.push('Fuera de zona segura');
        if (!canales.alarmaActivo) apagados.push('Recordatorios');
        return {
          estado: 'bloqueado',
          nota: `Tenés el permiso, pero apagaste a mano: ${apagados.join(', ')}.`,
          puedePedir: false
        };
      }

      return { estado: 'concedido', puedePedir: false };
    } catch (e) {
      console.warn('No se pudo verificar las notificaciones:', e);
      return { estado: 'desconocido', puedePedir: true };
    }
  }

  /** Estado de canales de notificación (para el banner de "no te avisa"). */
  async estadoNotificaciones(): Promise<EstadoNotificaciones | null> {
    try {
      return await SiempreCerca.verificarNotificaciones();
    } catch {
      return null;
    }
  }

  private async leerExtra(): Promise<{ telefono: boolean; contactos: boolean }> {
    try {
      return await PermisosExtra.verificarPermisos();
    } catch (e) {
      console.warn('No se pudieron verificar teléfono/contactos:', e);
      return { telefono: false, contactos: false };
    }
  }

  /**
   * Estado de la alarma exacta.
   *
   * Desde Android 13 el sistema ya no concede este permiso con un diálogo: o
   * la app está en la lista de excepciones (alarmas/calendario) o tiene que
   * abrirse Ajustes a mano. Por eso se informa del estado real y, si se puede
   * pedir, se pide; si no, se manda a Ajustes.
   */
  private async leerAlarmaExacta(): Promise<ResultadoPermiso> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const r = await LocalNotifications.checkExactNotificationSetting();

      if (r.exact_alarm === 'granted') {
        return { estado: 'concedido', puedePedir: false };
      }

      // changeExactNotificationSetting abre los ajustes del sistema, así que
      // desde acá no se puede "conceder": sólo se avisa.
      return {
        estado: 'denegado',
        nota: 'Android no lo concede con una ventana: hay que activarlo en Ajustes.',
        puedePedir: false
      };
    } catch (e) {
      console.warn('No se pudo verificar la alarma exacta:', e);
      return { estado: 'desconocido', puedePedir: false };
    }
  }

  private async leerBateria(): Promise<{ estado: EstadoPermiso }> {
    try {
      const r = await SiempreCerca.ignorandoBateria();
      return { estado: r.si ? 'concedido' : 'denegado' };
    } catch (e) {
      // Antes devolvía `concedido` en el catch, o sea que informaba "todo bien"
      // justo cuando no se podía comprobar. Ahora se informa desconocido.
      console.warn('No se pudo verificar la optimización de batería:', e);
      return { estado: 'desconocido' };
    }
  }

  private async leerCamara(): Promise<{
    camara: EstadoPermiso;
    fotos: EstadoPermiso;
    puedePedir: boolean;
  }> {
    try {
      const { Camera } = await import('@capacitor/camera');
      const r = await Camera.checkPermissions();

      const map = (v: string): EstadoPermiso => {
        if (v === 'granted') return 'concedido';
        if (v === 'denied') return 'denegado';
        // 'prompt' = todavía no se preguntó, 'limited' sólo en iOS.
        if (v === 'prompt') return 'denegado';
        return 'desconocido';
      };

      return {
        camara: map(r.camera),
        fotos: map(r.photos),
        puedePedir: r.camera === 'prompt' || r.camera === 'denied'
      };
    } catch (e) {
      console.warn('No se pudo verificar la cámara:', e);
      return { camara: 'desconocido', fotos: 'desconocido', puedePedir: true };
    }
  }

  private async verificarNotificacionesWeb(): Promise<boolean> {
    try {
      return 'Notification' in window && (Notification as any).permission === 'granted';
    } catch {
      return false;
    }
  }

  // =====================================================
  // SOLICITAR
  // =====================================================

  /**
   * Pide un permiso. Devuelve el estado resultante REAL (recién leído del
   * sistema), no lo que el usuario "dijo": si el sistema no mostró nada porque
   * ya estaba bloqueado, el resultado lo refleja.
   */
  async pedir(id: string): Promise<PermisoInfo | null> {
    if (!this.isNative) return null;

    this.marcarPreguntado(id);
    // El registro nativo es lo que permite después distinguir "el usuario lo
    // bloqueó para siempre" de "todavía no se le preguntó". Sin esta marca, un
    // permiso bloqueado se reportaría como pedirle de nuevo y no pasaría nada.
    await this.marcarPreguntadoNativo(id);

    try {
      await this.solicitar(id);
    } catch (e) {
      console.warn(`Error solicitando el permiso ${id}:`, e);
    }

    const lista = await this.verificarTodos();
    return lista.find((p) => p.id === id) ?? null;
  }

  private async solicitar(id: string): Promise<void> {
    switch (id) {
      case 'notificaciones': {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const permiso = await LocalNotifications.checkPermissions();
        if (permiso.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
        // Los canales se crean acá: hasta ahora se creaban 2 s después de
        // abrir el panel, así que una alerta muy temprana no tenía canal.
        await SiempreCerca.crearCanalSOS().catch(() => {});
        break;
      }

      case 'ubicacion': {
        // Se pide el permiso real (el plugin lo hace al no tener acceso) y
        // después se levanta el servicio de segundo plano.
        await UbicacionForeground.iniciar({ intervaloMs: 30000, distanciaMinimaM: 20 });
        break;
      }

      case 'ubicacion-fondo': {
        // Paso aparte y posterior: desde Android 11 el sistema ignora este
        // permiso si se pide junto con el de primer plano.
        const r = await UbicacionForeground.solicitarBackground();
        if (r.requiereForeground) {
          throw new Error('Primero hay que activar la ubicación.');
        }
        break;
      }

      case 'bateria':
        await SiempreCerca.pedirIgnorarOptimizacion();
        break;

      case 'camara': {
        const { Camera } = await import('@capacitor/camera');
        const r = await Camera.checkPermissions();
        if (r.camera !== 'granted') await Camera.requestPermissions();
        break;
      }

      case 'fotos': {
        const { Camera } = await import('@capacitor/camera');
        const r = await Camera.checkPermissions();
        if (r.photos !== 'granted') {
          await Camera.requestPermissions({ permissions: ['photos'] });
        }
        break;
      }

      case 'alarma-exacta': {
        // Desde Android 13 el sistema no concede este permiso con un diálogo:
        // se abre Ajustes directamente.
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const r = await LocalNotifications.checkExactNotificationSetting();
        if (r.exact_alarm !== 'granted') {
          await LocalNotifications.changeExactNotificationSetting();
        }
        break;
      }

      case 'contactos':
        await PermisosExtra.solicitarContactos();
        break;

      case 'telefono':
        await PermisosExtra.solicitarTelefono();
        break;

      default:
        break;
    }
  }

  // =====================================================
  // AYUDAS PARA LA INTERFAZ
  // =====================================================

  /** IDs de los permisos críticos que están apagados. */
  async criticosPendientes(): Promise<string[]> {
    const lista = await this.verificarTodos();
    return lista
      .filter((p) => p.critico && (p.estado === 'denegado' || p.estado === 'bloqueado'))
      .map((p) => p.id);
  }

  /**
   * Resume el estado en una frase corta para el banner del panel.
   * Con null significa que está todo en orden.
   */
  async resumenProblemas(): Promise<{ titulo: string; detalle: string; ids: string[] } | null> {
    const ids = await this.criticosPendientes();
    if (ids.length === 0) return null;

    const definiciones = ids
      .map((id) => this.definicion(id))
      .filter((d): d is DefinicionPermiso => !!d);

    if (definiciones.length === 1) {
      const d = definiciones[0];
      return {
        titulo: `Falta activar: ${d.nombre}`,
        detalle: d.paraQue,
        ids
      };
    }

    return {
      titulo: `Faltan ${definiciones.length} permisos importantes`,
      detalle: `Sin ellos la app no puede avisarte: ${definiciones.map((d) => d.nombre).join(', ')}.`,
      ids
    };
  }

  // =====================================================
  // AJUSTES DEL SISTEMA
  // =====================================================

  /**
   * Abre la ficha de la app en Ajustes del sistema.
   *
   * Devuelve true si de verdad se abrió: el llamador puede avisar si el
   * intento falló (algunos fabricantes bloquean intents hacia Ajustes).
   */
  async abrirAjustesApp(): Promise<boolean> {
    try {
      if (!this.isNative) return false;
      await UbicacionForeground.abrirAjustes();
      return true;
    } catch (e) {
      console.warn('No se pudo abrir Ajustes:', e);
      return false;
    }
  }

  /**
   * Abre los ajustes de notificaciones de la app (no los generales del sistema).
   * Es lo correcto cuando lo que está apagado es un canal: en los ajustes
   * generales no hay forma de llegar al canal.
   */
  async abrirAjustesNotificaciones(): Promise<boolean> {
    try {
      if (this.isNative) {
        await SiempreCerca.abrirAjustesNotificaciones();
        return true;
      }
      return await this.abrirAjustesApp();
    } catch (e) {
      console.warn('No se pudieron abrir los ajustes de notificaciones:', e);
      return false;
    }
  }

  /**
   * Por qué NO se pudo activar un permiso concreto.
   *
   * Notificaciones tiene TRES fallos distintos que se estaban tratando como
   * uno solo, y el mensaje genérico no decía cuál era:
   *   a) el permiso POST_NOTIFICATIONS está denegado (o bloqueado para siempre)
   *   b) el permiso está concedido pero Android tiene las notificaciones
   *      apagadas para toda la app
   *   c) el permiso está concedido y las notificaciones están prendidas, pero
   *      el canal "Alertas SOS" está apagado a mano
   *
   * Sólo (c) se arregla desde la app. (a) y (b) exigen ir a los ajustes del
   * sistema, y el sitio exacto de Ajustes es distinto en cada caso.
   */
  async motivoFallo(id: string): Promise<{ texto: string; ajustes: 'notificaciones' | 'app' | 'ninguno' }> {
    try {
      if (id === 'notificaciones') {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const permiso = await LocalNotifications.checkPermissions();

        if (permiso.display !== 'granted') {
          const nativo = await this.estadoNativo('notificaciones');
          if (nativo?.bloqueado) {
            return {
              texto: 'Elegiste "no volver a preguntar", así que Android ya no muestra la ventana. Hay que activarlo en Ajustes → Notificaciones.',
              ajustes: 'notificaciones'
            };
          }
          return { texto: 'El permiso de notificaciones está denegado.', ajustes: 'notificaciones' };
        }

        const canales = await SiempreCerca.verificarNotificaciones();

        if (!canales.habilitadas) {
          return {
            texto: 'El permiso está concedido, pero Android tiene las notificaciones APAGADAS para toda la app. Hay que prenderlas en Ajustes → Notificaciones.',
            ajustes: 'notificaciones'
          };
        }

        if (!canales.sosActivo) {
          return {
            texto: 'Las notificaciones están prendidas, pero el canal "Alertas SOS" está apagado. Hay que prenderlo en Ajustes → Notificaciones → Alertas SOS.',
            ajustes: 'notificaciones'
          };
        }

        return { texto: 'Las notificaciones están activas.', ajustes: 'ninguno' };
      }

      const nativo = await this.estadoNativo(id);
      if (nativo?.bloqueado) {
        return {
          texto: 'Android ya no muestra la ventana de este permiso: hay que activarlo en los ajustes del sistema.',
          ajustes: 'app'
        };
      }
    } catch (e) {
      console.warn('No se pudo determinar el motivo del fallo:', e);
    }

    return { texto: '', ajustes: 'ninguno' };
  }

  /**
   * Abre los ajustes adecuados según qué está fallando: los de notificaciones
   * si el problema es el permiso o un canal, si no los generales de la app.
   */
  async abrirAjustesPara(id: string): Promise<void> {
    if (id === 'notificaciones') {
      const motivo = await this.motivoFallo(id);
      if (motivo.ajustes === 'notificaciones') {
        await this.abrirAjustesNotificaciones();
        return;
      }
    }
    await this.abrirAjustesApp();
  }

  /**
   * Pantalla correcta para DESACTIVAR un permiso que está concedido.
   *
   * No es la misma que para activarlo: apagar notificaciones se hace en los
   * ajustes de notificaciones de la app (donde está el interruptor general y
   * los canales), mientras que el resto (ubicación, batería, cámara…) se
   * apagan desde la ficha de la app en Ajustes.
   *
   * Igual que `abrirAjustesApp`, devuelve true si se logró abrir.
   */
  async abrirAjustesParaApagar(id: string): Promise<boolean> {
    if (id === 'notificaciones') {
      return await this.abrirAjustesNotificaciones();
    }
    return await this.abrirAjustesApp();
  }

}

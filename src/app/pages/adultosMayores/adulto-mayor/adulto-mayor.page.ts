import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';

import {
  CuidadoresService
} from '../../../services/Backend/cuidadores/cuidadores';


import {
  Router
} from '@angular/router';

import {
  CommonModule
} from '@angular/common';

import {
  FormsModule
} from '@angular/forms';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonIcon,
  IonButton,
  IonModal,
  IonButtons,
  IonSpinner,
  IonRefresher,
  IonRefresherContent
} from '@ionic/angular';

import {
  addIcons
} from 'ionicons';

import * as icons from 'ionicons/icons';

import * as QRCode from 'qrcode';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { Gps } from '../../../services/Backend/gps/gps';
import { DesplazamientoTracker } from '../../../services/Backend/desplazamiento-tracker/desplazamiento-tracker';
import { ZonaSeguraService } from '../../../services/Backend/zona-segura/zona-segura';
import { AlarmasService, AlarmaRecordatorio } from '../../../services/alarmas/alarmas';
import { SOSService, ResultadoSOS } from '../../../services/Backend/sos/sos';
import { SiempreCerca } from '../../../services/alarmas/siempre-cerca';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { FooterComponent } from '../../../components/footer/footer.component';
import { AvisoPermisosComponent } from '../../../components/aviso-permisos/aviso-permisos.component';
import { SupabaseService } from '../../../services/supabase/supabase';
import { PushNotificationService } from '../../../services/Backend/push-notification/push-notification';
import { AlertController } from '@ionic/angular';
import { PerfilCacheService } from '../../../services/perfil-cache/perfil-cache.service';
import { PermisosService } from '../../../services/permisos/permisos.service';
import { RealtimeService } from '../../../services/realtime/realtime.service';
import { SaludSyncService } from '../../../services/Backend/salud/salud-sync';
import { Salud, type ResumenSalud } from '../../../services/Backend/salud/salud';


@Component({

  selector: 'app-adulto-mayor',

  templateUrl: './adulto-mayor.page.html',

  styleUrls: ['./adulto-mayor.page.scss'],

  imports: [

    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonIcon,

    IonButton,
    IonModal,
    IonButtons,
    IonSpinner,

    CommonModule,
    FormsModule,
    FooterComponent,
    AvisoPermisosComponent,
    IonRefresher,
    IonRefresherContent

  ]

})


export class AdultoMayorPage implements OnInit, OnDestroy {


  // =====================================================
  // POLLING SOLICITUDES
  // =====================================================

  private solicitudesInterval: any = null;

  /** Cuánto se espera entre sondeos cuando Realtime no está delivering. */
  private readonly INTERVALO_SONDEO_MS = 30000;

  /**
   * Con Realtime activo el sondeo pasa a 2 minutos: sigue estando como red de
   * seguridad (por si el WebSocket se cae en una zona sin datos), pero ya no es
   * el mecanismo principal.
   */
  private readonly INTERVALO_SONDEO_CON_REALTIME_MS = 120000;

  /** Vinculaciones que llegaron mientras la persona no estaba mirando. */
  private nuevasVinculaciones = 0;

  private soltarRealtime: (() => void) | null = null;

  // =====================================================
  // AVISO DE PERMISOS
  // =====================================================

  avisoPermisos: { titulo: string; detalle: string } | null = null;

  /**
   * Estado de la lectura de signos vitales.
   *
   * `saludDisponible` va aparte de `saludAutorizada` a propósito: en un
   * iPhone o en el navegador no hay Health Connect, y eso no es lo mismo que
   * "todavía no autorizaste". Si se mezclaran, la tarjeta pediría un permiso
   * que no existe en ninguna parte.
   *
   * `saludComprobando` sirve para lo mismo que las otras dos pero al revés:
   * mientras vale `true` todavía no se sabe nada, y la tarjeta tiene que
   * decir "Buscando tu reloj" en vez de "No se puede leer el reloj en este
   * teléfono". Sin esto, el primer pintado mentía durante los segundos que
   * tarda la comprobación.
   */
  saludComprobando = true;

  saludDisponible = false;

  saludAutorizada = false;

  /** Por qué no hay datos, en palabras que se puedan mostrar. */
  saludProblema: string | null = null;

  /**
   * Lo último leído de Health Connect, exista o no el permiso.
   *
   * Se guarda en el panel a propósito: sin él, un "sin datos" no distingue
   * entre un reloj que no manda nada y una app que no lo puede guardar, y
   * los dos se ven igual desde afuera.
   */
  saludResumen: ResumenSalud | null = null;

  /**
   * Tipos de dato que el usuario todavía no ha autorizado.
   *
   * Existe porque "autorizado" es engañoso: se puede haber aceptado los pasos
   * y rechazado el corazón. La app lo trataba como acceso completo, leía, no
   * encontraba nada y le echaba la culpa al reloj.
   */
  saludFaltan: string[] = [];

  avisoPermisosUrgente = false;

  avisoPermisosOculto = false;

  corrigiendoPermisos = false;

  /**
   * Vigilancia del aviso: el permiso puede APAGARSE con la pantalla ya
   * abierta (ajustes rápidos o Ajustes del sistema), y en ese caso el aviso
   * tiene que aparecer solo, sin que la persona salga y vuelva a entrar.
   */
  private timerPermisos: any = null;

  private escuchaAppPermisos: Promise<{ remove: () => Promise<void> }> | null = null;

  // =====================================================
  // ZONA SEGURA
  // =====================================================

  private zonaEstadoPrevio: boolean | null = null;

  /** Estado demostrativo del botón "Zona Segura" del panel del adulto:
   *  false = dentro de la zona (verde), true = fuera de la zona (rojo). */
  fueraDeZona: boolean = false;


  // =====================================================
  // USUARIO
  // =====================================================

  nombreUsuario: string = '';

  idUsuarioActual: string = '';

  fotoUrl: string | null = null;


  // =====================================================
  // VINCULACIÓN
  // =====================================================

  mostrarModal: boolean = false;

  codigo: string = '';

  qrCodeUrl: string = '';

  fechaExpiracion: Date | null = null;

  generando: boolean = false;


  // =====================================================
  // SOLICITUDES
  // =====================================================

  solicitudes: any[] = [];

  cargandoSolicitudes: boolean = false;


  // =====================================================
  // CUIDADORES VINCULADOS (PROTECCIÓN ACTIVA)
  // =====================================================

  cuidadoresVinculados: any[] = [];

  nombreCuidadorActivo: string = '';

  cuidadorFotoUrl: string | null = null;

  /**
   * Empieza en `true` a propósito: la tarjeta del cuidador ahora se dibuja
   * siempre, así que el primer pintado tiene que poder decir "Buscando..."
   * en vez de "Sin cuidador asignado", que sería mentira durante los
   * segundos que tarda la consulta.
   */
  cargandoCuidadores: boolean = true;


  // =====================================================
  // ALARMAS DE RECORDATORIOS
  // =====================================================

  alarmasSonando: AlarmaRecordatorio[] = [];

  private suscripcionAlarma?: { unsubscribe: () => void };

  private suscripcionSonando?: { unsubscribe: () => void };

  /** Revisa la tarjeta cada 5 s solo mientras esta pantalla esta a la vista. */
  private timerSonando: any = null;

  private destruido: boolean = false;


  // =====================================================
  // MENSAJES
  // =====================================================

  mensaje: string = '';

  mensajeError: string = '';


  // =====================================================
  // DESPLAZAMIENTOS (HISTORIAL)
  // =====================================================

  private trackerDesplazamiento = inject(DesplazamientoTracker);

  private desplazamientoRevisado = false;


  // =====================================================
  // CONSTRUCTOR
  // =====================================================

  constructor(

    private cuidadoresService: CuidadoresService,

    private vinculacionService: Vinculacion,

    private gpsService: Gps,

    private zonaSeguraService: ZonaSeguraService,

    private alarmasService: AlarmasService,

    private changeDetectorRef: ChangeDetectorRef,

    private router: Router,

    private sosService: SOSService,

    private supabaseService: SupabaseService,

    private pushService: PushNotificationService,

    private alertCtrl: AlertController,

    private perfilCache: PerfilCacheService,

    private permisosService: PermisosService,

    private realtimeService: RealtimeService,

    private saludSyncService: SaludSyncService,

    private saludService: Salud

  ) {

    // Carga todos los iconos Ionic

    addIcons(icons);

  }



  // =====================================================
  // INICIO
  // =====================================================

  async ngOnInit() {

    // 1. El nombre sale de la caché de inmediato (si no había, se pide una
    //    vez). Antes se llamaba dos veces a getUser(), que va a la red, y la
    //    pantalla quedaba vacía hasta que el servidor respondiera.
    void this.cargarPerfilRapido();

    // 2. Refrescar la vista YA con lo que haya para que no se vea vacía
    this.changeDetectorRef.detectChanges();


    // 3. Signos vitales: el adulto mayor no tiene que apretar nada. El
    //    servicio de ubicación ya está vivo y cada 15 minutos avisa por aquí
    //    para subir los datos del reloj a Supabase. Lo que sí necesita es una
    //    sola autorización, y por eso se pide al abrir el panel: después
    //    nunca más.
    //
    //    Arranca aquí y no después del `await` de abajo a propósito: la
    //    comprobación va contra el sistema (Health Connect), pero igual se
    //    encadenaba detrás de las consultas de red, y la tarjeta se quedaba
    //    esperando segundos. Ahora va en paralelo, así que la tarjeta queda
    //    desde el primer pintado.
    void this.iniciarSyncSalud();


    // 4. Cargar en paralelo sólo lo esencial del panel (solicitudes + cuidadores)
    await Promise.all([
      this.cargarSolicitudes(),
      this.cargarCuidadoresVinculados()
    ]);

    this.changeDetectorRef.detectChanges();


    // 5. Reportar ubicación en SEGUNDO PLANO (geolocalización + geocoding externo),
    //    sin bloquear la visualización del panel.
    this.reportarUbicacion();

    //    Servicio de ubicación: con la app cerrada el servicio sigue evaluando
    //    las zonas seguras y avisando a los cuidadores.
    this.iniciarMonitoreoSegundoPlano();


    // 6. Recordatorios: repone las alarmas programadas y escucha el toque
    //    en las notificaciones para abrir el panel de consolar con "Apagar".
    this.actualizarSonando();

    this.alarmasService.escucharTap('adulto-mayor', () => {
      this.actualizarSonando();
      this.router.navigate(['/recordatorios']);
    });

    // Al empezar a sonar una alarma aparece la tarjeta "Apagar alarma" al
    // instante, sin esperar a que la persona vuelva a esta pantalla.
    this.suscripcionSonando?.unsubscribe();
    this.suscripcionSonando = this.alarmasService.alarmaSonando$.subscribe(() => {
      this.actualizarSonando();
    });

    // Si la alarma se apaga desde la barra de notificaciones o desde
    // Recordatorios, la tarjeta de esta página desaparece al instante.
    this.suscripcionAlarma?.unsubscribe();
    this.suscripcionAlarma = this.alarmasService.alarmaApagada$.subscribe((idAlarma) => {
      this.alarmasSonando = this.alarmasSonando.filter((a) => a.id !== idAlarma);
      this.changeDetectorRef.detectChanges();
    });

    // Crear canal SOS + registrar push después de cargar la página (no bloquear)
    setTimeout(() => {
      if (Capacitor.isNativePlatform()) {
        SiempreCerca.crearCanalSOS().catch(() => {});
        this.pushService.inicializar().catch(() => {});
      }
    }, 2000);


    // 6. Vinculaciones en vivo + permiso + banner de permisos, en paralelo.
    this.activarRealtime();
    this.revisarPermisos();
    this.iniciarVigilanciaPermisos();

  }

  // =====================================================
  // PERFIL RÁPIDO
  // =====================================================

  /**
   * Pinta el nombre y la foto desde la caché, sin esperar a la red.
   * Es lo que hace que el saludo aparezca de inmediato al abrir la app.
   */
  private async cargarPerfilRapido(): Promise<void> {
    try {
      const perfil = await this.perfilCache.perfil();
      if (perfil) {
        this.nombreUsuario = perfil.nombre || perfil.nombreCompleto || '';
        this.idUsuarioActual = perfil.id;
        this.changeDetectorRef.detectChanges();

        const foto = await this.perfilCache.cargarFoto(perfil.id);
        if (foto) {
          this.fotoUrl = foto;
          this.changeDetectorRef.detectChanges();
        }
      }
    } catch (e) {
      console.warn('No se pudo cargar el perfil rápido:', e);
    }

    // Si la caché no tenía nada (primera vez), se pide a la base.
    if (!this.idUsuarioActual) {
      const usuario = await this.cuidadoresService.cargarUsuario();
      if (usuario) {
        this.nombreUsuario = usuario.nombre || '';
        this.idUsuarioActual = usuario.id || '';
        this.changeDetectorRef.detectChanges();
        await this.cargarFotoPerfil();
        this.changeDetectorRef.detectChanges();
      } else {
        this.nombreUsuario = await this.cuidadoresService.cargarUsuarioNombre();
      }
    }
  }

  // =====================================================
  // REALTIME DE VINCULACIONES
  // =====================================================

  /**
   * Escucha las vinculaciones en vivo.
   *
   * Antes sólo había un `setInterval(30s)`, así que una solicitud nueva podía
   * tardar hasta medio minuto en aparecer, y nada si la persona estaba en otra
   * pantalla. Con Realtime el cambio llega al instante.
   *
   * El sondeo NO se elimina: es la red de seguridad si la tabla no está en la
   * publicación de Realtime o si el WebSocket se cae.
   */
  private async activarRealtime(): Promise<void> {
    try {
      if (!this.idUsuarioActual) return;

      await this.realtimeService.suscribir(this.idUsuarioActual);

      this.soltarRealtime = this.realtimeService.escuchar((evento) => {
        // Sólo interesa lo que el adulto ve: las solicitudes que le llegan.
        // En un DELETE Postgres no manda la clave primaria salvo con
        // REPLICA IDENTITY FULL, así que el filtro de la suscripción puede no
        // dejar pasar el evento: por eso se refresca la lista completa en vez
        // de parchear un elemento.
        console.log('[Panel] cambio de vinculación:', evento.tabla, evento.operacion);
        this.nuevasVinculaciones++;
        void this.refrescarVinculaciones();
      });

      // Comprobación de salud: si en 6 s no llega nada, se avisa por log y el
      // sondeo queda como protagonista.
      await this.realtimeService.comprobar();
      if (!this.realtimeService.disponible) {
        console.warn(
          '[Panel] Realtime no disponible, se sigue con el sondeo de 30 s. Motivo:',
          this.realtimeService.motivo
        );
      }

      this.programarSondeo();
    } catch (e) {
      console.warn('No se pudo activar Realtime:', e);
      this.programarSondeo();
    }
  }

  /** Ajusta la frecuencia del sondeo según si Realtime está delivering. */
  private programarSondeo(): void {
    if (this.solicitudesInterval) {
      clearInterval(this.solicitudesInterval);
      this.solicitudesInterval = null;
    }

    const cada = this.realtimeService.disponible
      ? this.INTERVALO_SONDEO_CON_REALTIME_MS
      : this.INTERVALO_SONDEO_MS;

    this.solicitudesInterval = setInterval(async () => {

      await this.refrescarVinculaciones();

      // La ubicación se reporta con un ritmo propio, más lento que el sondeo.
      //
      // Motivo: el servicio nativo en primer plano YA reporta la posición cada
      // 30 s aunque la app no esté abierta. Si además el panel lo hace en cada
      // sondeo, se duplican las lecturas de GPS, las escrituras en la base y las
      // llamadas al servicio de geocodificación, sin ganar nada: el dato que
      // el panel necesita (¿sigo dentro de mi zona?) ya está en la base.
      void this.reportarUbicacionSiToca();

      this.actualizarSonando();

      this.changeDetectorRef.detectChanges();

    }, cada);
  }

  /**
   * Reporta la ubicación como máximo una vez cada `MINUTO_ENTRE_REPORTES`.
   *
   * Con la app abierta el intervalo de sondeo es de 30 s (o 120 s si Realtime
   * está funcionando), así que sin este tope cada tick disparaba una lectura
   * de GPS, una escritura y una llamada a un servicio externo de geocodificación.
   */
  private static readonly MINUTO_ENTRE_REPORTES = 120000;

  private ultimoReporte = 0;

  private async reportarUbicacionSiToca(): Promise<void> {
    const ahora = Date.now();
    if (ahora - this.ultimoReporte < AdultoMayorPage.MINUTO_ENTRE_REPORTES) return;

    this.ultimoReporte = ahora;
    await this.reportarUbicacion();
  }

  /** Refresca solicitudes + cuidadores, en paralelo. */
  private async refrescarVinculaciones(): Promise<void> {
    await Promise.all([
      this.cargarSolicitudes(),
      this.cargarCuidadoresVinculados()
    ]);
    this.changeDetectorRef.detectChanges();
  }

  /** Refresco manual (tirar hacia abajo). */
  async refrescar(event?: any): Promise<void> {
    this.nuevasVinculaciones = 0;
    // Un refresco a pedido sí reporta la ubicación sí o sí: la persona lo
    // está pidiendo, y el tope automático no aplica a una acción explícita.
    this.ultimoReporte = Date.now();
    await Promise.all([
      this.refrescarVinculaciones(),
      this.reportarUbicacion(),
      this.actualizarSonando()
    ]);
    this.changeDetectorRef.detectChanges();
    event?.target?.complete();
  }

  // =====================================================
  // PERMISOS
  // =====================================================

  /**
   * Revisa los permisos críticos al abrir el panel.
   *
   * Es importante hacerlo acá y no sólo en la pantalla de Ajustes: Android
   * resetea solo el permiso de notificaciones si el usuario descarta el
   * diálogo dos veces, y también por "app sin usar". Sin esta comprobación la
   * app creía que todo estaba bien mientras el SOS sonaba en silencio.
   */
  private async revisarPermisos(): Promise<void> {
    if (this.avisoPermisosOculto) return;

    try {
      const resumen = await this.permisosService.resumenProblemas();
      this.avisoPermisos = resumen;
      // Sin notificaciones el aviso es rojo: es el permiso del que depende el SOS.
      this.avisoPermisosUrgente = !!resumen?.ids.includes('notificaciones');
    } catch (e) {
      console.warn('No se pudieron revisar los permisos:', e);
    }
  }

  async corregirPermisos(): Promise<void> {
    this.corrigiendoPermisos = true;
    this.changeDetectorRef.detectChanges();

    try {
      // Se manda a la pantalla de permisos, no a Ajustes del sistema: desde ahí
      // se puede activar uno por uno con la explicación al lado.
      await this.router.navigate(['/permisos']);
    } finally {
      this.corrigiendoPermisos = false;
    }

    // Al volver de esa pantalla se vuelve a comprobar (ionViewWillEnter).
    this.avisoPermisosOculto = false;
  }

  /**
   * Mantiene el aviso vivo mientras la pantalla está visible.
   *
   * Además de revisar al entrar, se releen los permisos cada 10 s y cada vez
   * que la app vuelve al primer plano. Cubre los dos casos en los que un
   * permiso se apaga con el panel abierto: desde los ajustes rápidos (sin
   * salir de la app) y desde Ajustes del sistema (app en segundo plano, que
   * sólo dispara `appStateChange`, no `ionViewWillEnter`). La consulta es
   * local: va al sistema, no a la red.
   */
  private iniciarVigilanciaPermisos(): void {
    this.detenerVigilanciaPermisos();

    this.timerPermisos = setInterval(() => {
      void this.revisarPermisos();
    }, 10000);

    if (Capacitor.isNativePlatform()) {
      this.escuchaAppPermisos = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void this.revisarPermisos();
      });
    }
  }

  private detenerVigilanciaPermisos(): void {
    if (this.timerPermisos) {
      clearInterval(this.timerPermisos);
      this.timerPermisos = null;
    }
    const escucha = this.escuchaAppPermisos;
    this.escuchaAppPermisos = null;
    if (escucha) void escucha.then((h) => h.remove()).catch(() => {});
  }

  async ionViewWillEnter() {
    await this.cargarFotoPerfil();
    // Al volver a la pantalla puede haber cambiado algo en Ajustes.
    await this.revisarPermisos();
    // Y mientras siga visible, que siga mirando: un permiso puede apagarse
    // con el panel abierto y el aviso debe aparecer en ese momento.
    this.iniciarVigilanciaPermisos();
    // Al volver a la página, las alarmas que se apagaron en la barra de
    // notificaciones ya no deben seguir apareciendo.
    this.actualizarSonando();
    this.iniciarTimerSonando();
    // La tarjeta de signos vitales se relee también al volver. Antes sólo se
    // armaba en ngOnInit, así que si la app quedaba cargada en segundo plano
    // la tarjeta seguía diciendo "Esperando datos de tu reloj" aunque el
    // teléfono ya hubiera subido los pasos hace rato.
    this.refrescarTarjetaSalud();
    this.changeDetectorRef.detectChanges();
  }

  ionViewWillLeave() {
    this.detenerTimerSonando();
    this.detenerVigilanciaPermisos();
  }

  /**
   * La tarjeta depende de una alarma que suena sola, sin que la persona toque
   * nada. El evento del sistema a veces no llega (el teléfono lo ahorra cuando
   * la app esta en segundo plano), asi que ademas se revisa cada 5 s mientras
   * la pantalla esta visible. Es una consulta local, no golpea la red.
   */
  private iniciarTimerSonando() {
    this.detenerTimerSonando();
    this.timerSonando = setInterval(() => {
      if (!this.destruido) {
        this.actualizarSonando();
      }
    }, 5000);
  }

  private detenerTimerSonando() {
    if (this.timerSonando) {
      clearInterval(this.timerSonando);
      this.timerSonando = null;
    }
  }

  async reportarUbicacion() {
    if (!this.idUsuarioActual) {
      try {
        const user = await this.cuidadoresService.cargarUsuario();
        this.idUsuarioActual = user?.id || '';
      } catch (e) {
        return;
      }
    }
    if (this.idUsuarioActual) {
      if (!this.desplazamientoRevisado) {
        this.desplazamientoRevisado = true;
        this.trackerDesplazamiento.revisarArranque(this.idUsuarioActual);
      }

      try {
        const info = await this.gpsService.reportarUbicacionAdulto(this.idUsuarioActual);
        this.trackerDesplazamiento.procesar(
          this.idUsuarioActual,
          info.latitud,
          info.longitud,
          info.precision
        );
        this.verificarZonaSegura(info.latitud, info.longitud);
      } catch (e) {
        // ignore
      }
    }
  }

  // =====================================================
  // ZONA SEGURA: AVISA A LOS CUIDADORES SI SALIÓ DE ZONA
  // =====================================================

  /**
   * Mantiene vivo el servicio de ubicación (sólo si ya tiene permiso):
   * con la app cerrada, el servicio sigue revisando las zonas seguras y
   * avisa a los cuidadores (funciona aunque el panel no esté a la vista).
   */
  private async iniciarMonitoreoSegundoPlano() {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const permisos = await this.gpsService.verificarPermisosUbicacion();
      if (!permisos.ubicacionForeground) return;
      await this.gpsService.iniciarUbicacionForeground(30000, 20);
    } catch {
      // sin servicio en segundo plano: el chequeo con la app abierta sigue
    }
  }

  /**
   * Pide la autorización de Health Connect (sólo la primera vez) y deja
   * corriendo el envío automático.
   *
   * `disponibilidad()` y `tienePermisos()` van contra el sistema, así que se
   * preguntan una vez al abrir el panel y no en cada vuelta a la pantalla:
   * la tarjeta tiene que decir la verdad sin hacer la pantalla parpadear.
   */
  /**
   * Relee el resumen de salud sin pedir permisos ni abrir diálogos.
   *
   * Separado de `iniciarSyncSalud()` a propósito: al volver a la pantalla sólo
   * hace falta volver a leer y a publicar, no volver a preguntar por los
   * permisos. Si se mezclaran, cada vuelta al panel pediría autorización otra
   * vez.
   */
  private async refrescarTarjetaSalud(): Promise<void> {
    if (!this.saludDisponible || !this.saludAutorizada) return;

    try {
      await this.saludSyncService.sincronizar();
      this.saludResumen = this.saludSyncService.ultimoResumen;
      this.saludProblema = this.saludSyncService.ultimoProblema;
    } catch (e) {
      console.warn('No se pudo refrescar la tarjeta de salud:', e);
    }
  }

  private async iniciarSyncSalud(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      // En el navegador no hay Health Connect. La tarjeta se queda puesta
      // igual, diciendo que este teléfono no puede leer el reloj.
      this.saludComprobando = false;
      this.saludDisponible = false;
      this.saludAutorizada = false;
      this.saludProblema = 'Este teléfono no puede leer el reloj.';
      return;
    }

    await this.saludSyncService.iniciar();

    const disp = await this.saludService.disponibilidad();
    if (!disp.disponible) {
      this.saludDisponible = false;
      this.saludAutorizada = false;
      this.saludProblema = disp.motivo;
      this.saludComprobando = false;
      return;
    }

    this.saludDisponible = true;
    this.saludAutorizada = await this.saludService.tienePermisos();

    // Un reintento con datos frescos: el arranque puede haber caído antes de
    // que el reloj alcanzara a escribir en Health Connect.
    await this.saludSyncService.sincronizar(true);

    this.saludResumen = this.saludSyncService.ultimoResumen;
    this.saludProblema = this.saludAutorizada
      ? this.saludSyncService.ultimoProblema
      : 'Toca el reloj para autorizar el acceso a tus datos de salud.';

    await this.revisarPermisosFaltantes();

    // Se apaga al final, no antes: hasta que no termine la comprobación la
    // tarjeta dice "Buscando tu reloj..." en vez de afirmar que no hay reloj.
    this.saludComprobando = false;

    this.changeDetectorRef.detectChanges();
  }

  /**
   * Anota qué datos no están autorizados todavía.
   *
   * Con esto la tarjeta puede decir "faltan las pulsaciones" en vez de
   * mostrar un guion que no explica nada.
   */
  private async revisarPermisosFaltantes(): Promise<void> {
    if (!this.saludAutorizada) {
      this.saludFaltan = [];
      return;
    }

    try {
      const faltantes = await this.saludService.tiposSinPermiso();
      this.saludFaltan = faltantes.map((t) => this.saludService.traducirTipo(t));
    } catch {
      this.saludFaltan = [];
    }
  }

  /**
   * Segunda línea de la tarjeta de salud.
   *
   * Se muestra el primer dato que exista, no sólo los pasos. Antes miraba
   * únicamente `pasos` y `fc_media`, y con eso una persona que sólo tiene
   * calorías registradas veía "Esperando datos de tu reloj" aunque la app
   * estuviera recibiendo y publicando todo lo que el reloj manda.
   */
  get saludDetalle(): string {
    const r = this.saludResumen;

    // Todavía no se ha preguntado al sistema: no se afirma nada.
    if (this.saludComprobando) {
      return 'Buscando tu reloj...';
    }

    // El teléfono no puede leer Health Connect (iPhone, navegador, Android
    // viejo). Se dice claro para que la persona no ande buscando un reloj que
    // no va a aparecer nunca.
    if (!this.saludDisponible) {
      return 'Este teléfono no puede leer el reloj';
    }

    if (!this.saludAutorizada) {
      return 'Toca para conectar tu reloj';
    }

    // Un permiso sin autorizar se dice aunque haya datos de los demás: si no,
    // la tarjeta muestra pasos y un guion al lado, y parece un fallo del reloj
    // cuando en realidad nunca se le pidió acceso a esa cifra.
    if (this.saludFaltan.length > 0) {
      return `Falta autorizar: ${this.saludFaltan.join(', ')}`;
    }

    if (!r) {
      return 'Esperando datos de tu reloj';
    }

    const partes: string[] = [];

    if (r.pasos !== null) partes.push(`Hoy ${r.pasos.toLocaleString('es-CL')} pasos`);
    if (r.fc_media !== null) partes.push(`${r.fc_media} lpm`);
    if (r.spo2 !== null) partes.push(`SpO2 ${r.spo2}%`);
    if (r.calorias !== null && partes.length === 0) partes.push(`${r.calorias} kcal`);

    if (partes.length > 0) {
      return partes.join(' · ');
    }

    return 'Sincronizando con el reloj...';
  }

  /**
   * La tarjeta ofrece el diálogo de permisos si falta alguno.
   *
   * También cuando el teléfono no puede leer nada: en ese caso queda en gris
   * y sin segunda línea que prometa datos, pero sigue siendo el mismo lugar
   * donde el usuario espera ver su salud.
   */
  get saludInvitaAAutorizar(): boolean {
    return (
      !this.saludDisponible ||
      !this.saludAutorizada ||
      this.saludFaltan.length > 0
    );
  }

  /**
   * Icono de la tarjeta.
   *
   * `watch-outline` es el de "conecta tu reloj", así que no se usa cuando el
   * teléfono no puede leer Health Connect: ahí sugeriría un reloj que no va a
   * servir. En ese caso va el corazón, que es lo que la tarjeta representa.
   */
  get saludIcono(): string {
    if (!this.saludDisponible) return 'heart-outline';
    return this.saludInvitaAAutorizar ? 'watch-outline' : 'heart';
  }

  /** En rojo sólo si de verdad no hay forma de que lleguen datos. */
  get saludConProblema(): boolean {
    // Mientras se comprueba no se marca nada: todavía no se sabe.
    if (this.saludComprobando) return false;
    if (!this.saludDisponible) return true;
    return this.saludAutorizada && !this.saludResumen && !!this.saludProblema;
  }

  /**
   * Abre el diálogo de Health Connect.
   *
   * Va a mano en vez de llamar a `iniciarSyncSalud()` porque el diálogo sólo
   * puede aparecer como respuesta a un toque del usuario: si se disparara
   * desde una sincronización de fondo, Android lo rechazaría.
   */
  async autorizarSalud() {
    if (!this.saludDisponible) return;

    const res = await this.saludService.solicitarPermisos();
    this.saludAutorizada = res.autorizado;

    // Sin esto la primera subida tardaría 15 minutos: el permiso se acaba de
    // dar, no hay nada esperando en la cola todavía.
    await this.saludSyncService.sincronizar(true);
    this.saludResumen = this.saludSyncService.ultimoResumen;
    this.saludProblema = this.saludSyncService.ultimoProblema;

    await this.revisarPermisosFaltantes();

    this.changeDetectorRef.detectChanges();
  }

  /** Manda al usuario a los ajustes de Health Connect si el diálogo ya no sale. */
  async abrirAjustesSalud() {
    await this.saludService.abrirAjustes();
  }

  private async verificarZonaSegura(latitud: number, longitud: number) {
    if (!this.idUsuarioActual) return;

    try {
      const antesDentro = this.zonaEstadoPrevio;
      const estado = await this.zonaSeguraService.evaluarYNotificar(
        this.idUsuarioActual,
        latitud,
        longitud
      );

      if (!estado) return;

      this.zonaEstadoPrevio = estado.dentro;

      // El botón del panel sólo es indicador: cambia a "Fuera de zona" (rojo)
      // al salirse y vuelve a su color normal al entrar de nuevo.
      this.fueraDeZona = !estado.dentro;
      this.changeDetectorRef.detectChanges();

      if (!estado.dentro && antesDentro !== false && this.zonaSeguraService.puedeAlertar(this.idUsuarioActual)) {
        this.zonaSeguraService.registrarAlerta(this.idUsuarioActual);

        const zona = estado.zonaCercana;
        const alert = await this.alertCtrl.create({
          header: 'Fuera de zona segura',
          message: zona
            ? `Estás fuera de la zona segura "${zona.nombre || zona.direccion_texto || 'sin nombre'}", ` +
              `a ${Math.round(estado.distancia)} m del centro. Tu cuidador fue avisado.`
            : 'Estás fuera de todas las zonas seguras. Tu cuidador fue avisado.',
          buttons: ['OK']
        });
        await alert.present();
      }
    } catch (e) {
      console.warn('Error verificando zona segura:', e);
    }
  }


  // =====================================================
  // DESTRUCCIÓN
  // =====================================================

  ngOnDestroy() {
    this.destruido = true;

    if (this.solicitudesInterval) {

      clearInterval(this.solicitudesInterval);

    }

    // La suscripción de Realtime es compartida: se suelta la escucha de esta
    // pantalla, no el canal. El canal se cierra al cambiar de cuenta.
    this.soltarRealtime?.();
    this.suscripcionAlarma?.unsubscribe();
    // Igual que en Recordatorios: sin soltar estos, una alarma que suene
    // estando en otra pantalla actualiza esta página ya destruida. Se pasa el
    // nombre para no desregistrar el handler de app.component, que es la red de
    // seguridad de toda la app.
    this.alarmasService.desescuchar('adulto-mayor');
    this.suscripcionSonando?.unsubscribe();
    this.detenerTimerSonando();
    this.detenerVigilanciaPermisos();

  }


  // =====================================================
  // PERFIL
  // =====================================================

  async cargarFotoPerfil() {
    try {
      const supabase = this.supabaseService.getClient();
      const userId = this.idUsuarioActual;

      const { data } = await supabase.storage
        .from('fotos-perfil')
        .list(`${userId}/`, { limit: 1 });

      if (data && data.length > 0) {
        const { data: signedUrlData } = await supabase.storage
          .from('fotos-perfil')
          .createSignedUrl(`${userId}/${data[0].name}`, 3600);
        this.fotoUrl = signedUrlData?.signedUrl || null;
      } else {
        this.fotoUrl = null;
      }
    } catch (error) {
      this.fotoUrl = null;
    }
  }

  async cargarFotoCuidador(idUsuarioCuidador?: string) {
    if (!idUsuarioCuidador) {
      this.cuidadorFotoUrl = null;
      return;
    }
    try {
      const supabase = this.supabaseService.getClient();

      const { data } = await supabase.storage
        .from('fotos-perfil')
        .list(`${idUsuarioCuidador}/`, { limit: 1 });

      if (data && data.length > 0) {
        const { data: signedUrlData } = await supabase.storage
          .from('fotos-perfil')
          .createSignedUrl(`${idUsuarioCuidador}/${data[0].name}`, 3600);
        this.cuidadorFotoUrl = signedUrlData?.signedUrl || null;
      } else {
        this.cuidadorFotoUrl = null;
      }
    } catch (error) {
      this.cuidadorFotoUrl = null;
    }
  }

  abrirPerfil() {

    (document.activeElement as HTMLElement)?.blur();

    this.router.navigate([
      '/perfil'
    ]);

  }



  // =====================================================
  // INICIO
  // =====================================================

  irInicio() {

    console.log('Inicio');

  }

  irAjustes() {
    this.router.navigate(['/ajustes']);
  }



  // =====================================================
  // FAMILIA
  // =====================================================

  abrirFamilia() {

    console.log('Familia');

  }



  // =====================================================
  // SOS
  // =====================================================

  mostrarModalSOS: boolean = false;

  ejecutandoSOS: boolean = false;

  abrirSOS() {
    this.mostrarModalSOS = true;
  }

  cerrarModalSOS() {
    this.mostrarModalSOS = false;
  }

  async confirmarSOS() {
    this.mostrarModalSOS = false;
    this.ejecutandoSOS = true;
    this.changeDetectorRef.detectChanges();

    try {
      const resultado = await this.sosService.ejecutarSOS();
      // Sólo los tres sí/no. El objeto completo puede traer la sesión SOS y
      // otros identificadores que no necesitan quedar en el log.
      console.log(
        `SOS enviado — push: ${resultado.pushEnviado ? 'sí' : 'no'}, ` +
        `llamada: ${resultado.llamadaIniciada ? 'sí' : 'no'}, ` +
        `sms: ${resultado.smsEnviado ? 'sí' : 'no'}`
      );
    } catch (e: any) {
      console.error('SOS error:', e);
    }

    this.ejecutandoSOS = false;
    this.changeDetectorRef.detectChanges();
  }



  // =====================================================
  // ESTOY AQUÍ
  // =====================================================

  mostrarModalEstoyAqui: boolean = false;

  estadoEstoyAqui: string = 'Estoy aquí';

  abrirEstoyAqui() {
    (document.activeElement as HTMLElement)?.blur();
    this.mostrarModalEstoyAqui = true;
  }

  cerrarModalEstoyAqui() {
    this.mostrarModalEstoyAqui = false;
  }

  async marcarEnCasa() {
    this.mostrarModalEstoyAqui = false;
    this.estadoEstoyAqui = 'Estoy en casa';
    console.log('Estado: Estoy en casa');
    await this.notificarEstadoCasa('Estoy en casa');
  }

  async marcarSaliDeCasa() {
    this.mostrarModalEstoyAqui = false;
    this.estadoEstoyAqui = 'Salí de casa';
    console.log('Estado: Salí de casa');
    await this.notificarEstadoCasa('Salí de casa');
  }

  private async notificarEstadoCasa(estado: 'Estoy en casa' | 'Salí de casa') {
    let cuidadores: any[] = [];

    try {
      cuidadores = await this.sosService.obtenerCuidadores();
    } catch (e) {
      console.error('Error obteniendo cuidadores vinculados:', e);
    }

    // Sin cuidador vinculado → avisar que debe vincularse primero
    if (!cuidadores || cuidadores.length === 0) {
      const alert = await this.alertCtrl.create({
        header: 'Sin cuidador vinculado',
        message: 'Debes vincular a un cuidador primero antes de realizar esta acción.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const nombreAdulto = this.nombreUsuario?.trim()
      ? this.nombreUsuario.trim()
      : 'Tu adulto mayor';

    const cuerpo =
      estado === 'Estoy en casa'
        ? `${nombreAdulto} dice: Estoy en casa`
        : `${nombreAdulto} dice: Salí de casa`;

    let enviados = 0;

    for (const cuidador of cuidadores) {
      try {
        const ok = await this.pushService.enviarPushAUsuario(
          cuidador.id,
          estado,
          cuerpo,
          { tipo: 'estado_casa', estado }
        );
        if (ok) {
          enviados++;
          console.log('Push de estado enviado al cuidador:', cuidador.id);
        }
      } catch (e) {
        console.error('Error enviando push de estado al cuidador:', e);
      }
    }

    if (enviados === 0) {
      const motivo = this.pushService.ultimoError;
      const alert = await this.alertCtrl.create({
        header: 'No se pudo enviar el estado',
        message:
          `No se envió al cuidador.\n\n` +
          `Motivo: ${motivo || 'desconocido'}\n\n` +
          `Verifica que el cuidador tenga la app abierta con el permiso de notificaciones activado y que el canal de notificaciones de SiempreCerca no esté bloqueado en su celular.`,
        buttons: ['OK']
      });
      await alert.present();
    }
  }



  // =====================================================
  // RECORDATORIOS
  // =====================================================

  abrirRecordatorios() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/recordatorios']);
  }

  abrirMiUbicacion() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/mi-ubicacion']);
  }

  abrirJuegos() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/juegos']);
  }

  async actualizarSonando() {
    try {
      // Se revisa primero lo guardado en el telefono (instantaneo). Antes se
      // consultaba solo la red, y con mala conexion la tarjeta no aparecia.
      const locales = this.alarmasService.getAlarmasLocales();
      const sonando = locales.length > 0
        ? await this.alarmasService.estanSonando(locales)
        : await this.alarmasService.estanSonando();

      this.alarmasSonando = sonando;
    } catch {
      // Si la revision falla no se borra la tarjeta que ya se estaba viendo:
      // una alarma que sigue sonando no puede desaparecer por un fallo de red.
    }

    this.changeDetectorRef.detectChanges();
  }

  async apagarAlarma(alarma: AlarmaRecordatorio) {
    await this.alarmasService.apagarAlarma(alarma);
    await this.actualizarSonando();
  }



  // =====================================================
  // ALERTAS
  // =====================================================

  abrirAlertas() {

    console.log('Alertas');

  }



  // =====================================================
  // AJUSTES
  // =====================================================

  abrirAjustes() {

    console.log('Ajustes');

  }



  // =====================================================
  // ABRIR MODAL DE VINCULACIÓN
  // =====================================================

  async abrirVinculacion() {

    this.mensaje = '';

    this.mensajeError = '';

    this.codigo = '';

    this.qrCodeUrl = '';

    // Abrir el modal primero para que el ng-template se renderice
    this.mostrarModal = true;

    this.changeDetectorRef.detectChanges();


    // Esperar a que el modal esté listo antes de generar el QR

    setTimeout(() => {

      this.generarCodigo();

    }, 200);

  }



  // =====================================================
  // GENERAR CÓDIGO
  // =====================================================

  async generarCodigo() {

    this.generando = true;

    this.mensaje = '';

    this.mensajeError = '';

    this.codigo = '';

    this.qrCodeUrl = '';


    try {


      const data =
        await this.vinculacionService.generarCodigo();


      // ---------------------------------------------
      // Guardar código
      // ---------------------------------------------

      this.codigo =
        data.codigo;


      // ---------------------------------------------
      // Guardar expiración
      // ---------------------------------------------

      if (data.fecha_expiracion) {

        this.fechaExpiracion =
          new Date(
            data.fecha_expiracion
          );

      }


      // ---------------------------------------------
      // Generar QR
      // ---------------------------------------------

      this.qrCodeUrl =
        await QRCode.toDataURL(
          this.codigo,
          {
            width: 250,
            margin: 2
          }
        );


    } catch (error: any) {

      this.mensajeError =
        error?.message ??
        'No se pudo generar el código.';


    } finally {

      this.generando = false;

      this.changeDetectorRef.detectChanges();

    }

  }



  // =====================================================
  // CERRAR MODAL
  // =====================================================

  cerrarModal() {

    this.mostrarModal = false;

  }



  // =====================================================
  // CARGAR SOLICITUDES
  // =====================================================

  async cargarSolicitudes() {

    this.cargandoSolicitudes = true;


    try {

      this.solicitudes =
        await this.vinculacionService
          .obtenerSolicitudes();

    } catch (error: any) {

      this.mensajeError =
        error?.message ??
        'No se pudieron cargar las solicitudes.';


    } finally {

      this.cargandoSolicitudes = false;

    }

  }



  // =====================================================
  // CARGAR CUIDADORES VINCULADOS
  // =====================================================

  async cargarCuidadoresVinculados() {

    this.cargandoCuidadores = true;

    try {

      const data =
        await this.vinculacionService
          .obtenerCuidadoresVinculados();

      this.cuidadoresVinculados = data;

      if (data && data.length > 0) {

        const nombres = data
          .map((item: any) => {

            const usuario =
              item.cuidador?.usuario;

            if (!usuario) {
              return '';
            }

            const nombreCompleto =
              `${usuario.nombre || ''} ${usuario.apellidopa || ''}`.trim();

            return nombreCompleto;

          })
          .filter((nom: string) => nom.length > 0);


        this.nombreCuidadorActivo =
          nombres.join(', ');

        // Cargar foto del primer cuidador vinculado
        await this.cargarFotoCuidador(data[0]?.cuidador?.id_usuario);

      } else {

        this.nombreCuidadorActivo = '';
        this.cuidadorFotoUrl = null;

      }

    } catch (error: any) {

      console.error(
        'Error cargando cuidadores vinculados:',
        error
      );

    } finally {

      this.cargandoCuidadores = false;

    }

  }



  // =====================================================
  // ACEPTAR SOLICITUD
  // =====================================================

  async aceptarSolicitud(
    idSolicitud: string
  ) {

    this.mensaje = '';

    this.mensajeError = '';


    try {

      await this.vinculacionService
        .aceptarSolicitud(
          idSolicitud
        );


      this.mensaje =
        'Cuidador vinculado correctamente.';


      // Actualizar listas

      await Promise.all([
        this.cargarSolicitudes(),
        this.cargarCuidadoresVinculados()
      ]);


      this.changeDetectorRef.detectChanges();


    } catch (error: any) {

      console.error(
        'Error aceptando solicitud:',
        error
      );


      this.mensajeError =
        error?.message ??
        'No se pudo aceptar la solicitud.';

    }

  }



  // =====================================================
  // RECHAZAR SOLICITUD
  // =====================================================

  async rechazarSolicitud(
    idSolicitud: string
  ) {

    this.mensaje = '';

    this.mensajeError = '';


    try {

      await this.vinculacionService
        .rechazarSolicitud(
          idSolicitud
        );


      this.mensaje =
        'Solicitud rechazada.';


      // Actualizar lista

      await this.cargarSolicitudes();


      this.changeDetectorRef.detectChanges();


    } catch (error: any) {

      console.error(
        'Error rechazando solicitud:',
        error
      );


      this.mensajeError =
        error?.message ??
        'No se pudo rechazar la solicitud.';

    }

  }

}
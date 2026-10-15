import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButton,
  IonModal,
  IonButtons,
  IonInput,
  IonIcon,
  IonRefresher,
  IonRefresherContent
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { SiempreCerca } from '../../../services/alarmas/siempre-cerca';
import { PushNotificationService } from '../../../services/Backend/push-notification/push-notification';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { CuidadoresService } from '../../../services/Backend/cuidadores/cuidadores';
import { FooterComponent } from '../../../components/footer/footer.component';
import { AvisoPermisosComponent } from '../../../components/aviso-permisos/aviso-permisos.component';
import { EstadoConexionComponent } from '../../../components/estado-conexion/estado-conexion.component';
import {
  PresenciaService,
  estaEnLinea
} from '../../../services/Backend/presencia/presencia';
import { SupabaseService } from '../../../services/supabase/supabase';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { PerfilCacheService } from '../../../services/perfil-cache/perfil-cache.service';
import { PermisosService } from '../../../services/permisos/permisos.service';
import { RealtimeService } from '../../../services/realtime/realtime.service';


@Component({
  selector: 'app-cuidador',
  templateUrl: './cuidador.page.html',
  styleUrls: ['./cuidador.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonModal,
    IonButtons,
    IonInput,
    IonIcon,
    IonRefresher,
    IonRefresherContent,
    CommonModule,
    FormsModule,
    FooterComponent,
    AvisoPermisosComponent,
    EstadoConexionComponent
  ]
})
export class CuidadorPage implements OnInit, OnDestroy {

  // =====================================================
  // USUARIO CUIDADOR
  // =====================================================

  nombreUsuario: string = '';

  fotoUrl: string | null = null;


  // =====================================================
  // ADULTOS MAYORES A CARGO
  // =====================================================

  adultosACargo: any[] = [];

  /** Cuántos de los adultos a cargo están en línea (con internet). */
  enLineaCount: number = 0;

  cargandoConexion: boolean = false;

  cargandoAdultos: boolean = false;

  private refreshInterval: any = null;

  private inicializado = false;

  /** Cuánto se espera entre sondeos cuando Realtime no está delivering. */
  private readonly INTERVALO_SONDEO_MS = 30000;

  /**
   * Con Realtime activo el sondeo queda como red de seguridad (por si el
   * WebSocket se cae) y no como el mecanismo principal.
   */
  private readonly INTERVALO_SONDEO_CON_REALTIME_MS = 120000;

  private soltarRealtime: (() => void) | null = null;

  // =====================================================
  // AVISO DE PERMISOS
  // =====================================================

  avisoPermisos: { titulo: string; detalle: string } | null = null;

  avisoPermisosUrgente = false;

  avisoPermisosOculto = false;

  /**
   * Vigilancia del aviso: el permiso puede APAGARSE con la pantalla ya
   * abierta (ajustes rápidos o Ajustes del sistema), y en ese caso el aviso
   * tiene que aparecer solo, sin que la persona salga y vuelva a entrar.
   */
  private timerPermisos: any = null;

  private escuchaAppPermisos: Promise<{ remove: () => Promise<void> }> | null = null;


  // =====================================================
  // MODAL DE VINCULACIÓN
  // =====================================================

  mostrarModal = false;

  codigo = '';

  vinculando = false;

  mensaje = '';

  mensajeError = '';


  // =====================================================
  // CONSTRUCTOR
  // =====================================================

  constructor(
    private vinculacionService: Vinculacion,
    private cuidadoresService: CuidadoresService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private pushService: PushNotificationService,
    private supabaseService: SupabaseService,
    private presenciaService: PresenciaService,
    private perfilCache: PerfilCacheService,
    private permisosService: PermisosService,
    private realtimeService: RealtimeService
  ) {
    addIcons(icons);
  }


  // =====================================================
  // INICIO
  // =====================================================

  async ngOnInit() {
    // El nombre y la foto salen de la caché: la pantalla se ve de inmediato en
    // vez de esperar dos viajes a la red (que era lo que pasaba con getUser()).
    void this.cargarPerfilRapido();

    await this.cargarAdultos();

    this.changeDetectorRef.detectChanges();

    // Crear canal SOS + push después de cargar la página (no bloquear)
    setTimeout(() => {
      if (Capacitor.isNativePlatform()) {
        SiempreCerca.crearCanalSOS().catch(() => {});
        this.pushService.inicializar().catch(() => {});
      }
    }, 2000);

    // Vinculaciones en vivo + aviso de permisos.
    await this.activarRealtime();
    await this.revisarPermisos();
    this.iniciarVigilanciaPermisos();

    this.inicializado = true;
  }

  // =====================================================
  // PERFIL RÁPIDO
  // =====================================================

  private async cargarPerfilRapido(): Promise<void> {
    try {
      const perfil = await this.perfilCache.perfil();
      if (!perfil) return;

      this.nombreUsuario = perfil.nombre || perfil.nombreCompleto || '';
      this.changeDetectorRef.detectChanges();

      const foto = await this.perfilCache.cargarFoto(perfil.id);
      if (foto) {
        this.fotoUrl = foto;
        this.changeDetectorRef.detectChanges();
      }
    } catch (e) {
      console.warn('No se pudo cargar el perfil rápido:', e);
      // Sin caché (primera vez): se pide a la base.
      this.nombreUsuario = await this.cuidadoresService.cargarUsuarioNombre();
      await this.cargarFotoPerfil();
      this.changeDetectorRef.detectChanges();
    }
  }

  // =====================================================
  // REALTIME DE VINCULACIONES
  // =====================================================

  /**
   * Para el cuidador esto es lo más importante: si vincula a un adulto y ese
   * adulto acepta, la tarjeta tiene que aparecer al instante. Antes había que
   * esperar hasta 30 s y sólo si la pantalla estaba abierta.
   */
  private async activarRealtime(): Promise<void> {
    try {
      const idUsuario = await this.perfilCache.idUsuario();
      if (!idUsuario) {
        this.programarSondeo();
        return;
      }

      await this.realtimeService.suscribir(idUsuario);

      this.soltarRealtime = this.realtimeService.escuchar((evento) => {
        console.log('[Panel cuidador] cambio de vinculación:', evento.tabla, evento.operacion);
        void this.cargarAdultos();
        void this.actualizarResumenConexion();
      });

      await this.realtimeService.comprobar();
      if (!this.realtimeService.disponible) {
        console.warn(
          '[Panel cuidador] Realtime no disponible, se sigue con el sondeo de 30 s. Motivo:',
          this.realtimeService.motivo
        );
      }

      this.programarSondeo();
    } catch (e) {
      console.warn('No se pudo activar Realtime:', e);
      this.programarSondeo();
    }
  }

  private programarSondeo(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    // Con Realtime activo el sondeo pasa a red de seguridad, no a protagonista.
    const cada = this.realtimeService.disponible
      ? this.INTERVALO_SONDEO_CON_REALTIME_MS
      : this.INTERVALO_SONDEO_MS;

    this.refreshInterval = setInterval(async () => {
      await this.cargarAdultos();
      this.changeDetectorRef.detectChanges();
    }, cada);
  }

  /** Refresco manual (tirar hacia abajo). */
  async refrescar(event?: any): Promise<void> {
    await this.cargarAdultos();
    await this.actualizarResumenConexion();
    this.changeDetectorRef.detectChanges();
    event?.target?.complete();
  }

  // =====================================================
  // PERMISOS
  // =====================================================

  /**
   * Para el cuidador el permiso crítico por excelencia son las
   * notificaciones: sin ellas nunca se entera de un SOS aunque todo lo demás
   * esté bien. El aviso sale en rojo cuando ese es el que falta.
   */
  private async revisarPermisos(): Promise<void> {
    if (this.avisoPermisosOculto) return;

    try {
      const resumen = await this.permisosService.resumenProblemas();
      this.avisoPermisos = resumen;
      this.avisoPermisosUrgente = !!resumen?.ids.includes('notificaciones');
    } catch (e) {
      console.warn('No se pudieron revisar los permisos:', e);
    }
  }

  async corregirPermisos(): Promise<void> {
    await this.router.navigate(['/permisos']);
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

  async cargarFotoPerfil() {
    try {
      const usuario = await this.cuidadoresService.cargarUsuario();
      if (!usuario?.id) return;

      const supabase = this.supabaseService.getClient();
      const userId = usuario.id;

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


  // =====================================================
  // DESTRUCCIÓN
  // =====================================================

  async ionViewWillEnter() {
    if (!this.inicializado) {
      return;
    }

    // Se relee todo al volver a la pantalla: el perfil pudo cambiar y los
    // permisos pudieron apagarse en Ajustes.
    await this.cargarPerfilRapido();
    await this.cargarAdultos();
    await this.revisarPermisos();
    // Y mientras siga visible, que siga mirando: un permiso puede apagarse
    // con el panel abierto y el aviso debe aparecer en ese momento.
    this.iniciarVigilanciaPermisos();
    this.changeDetectorRef.detectChanges();
  }

  ionViewWillLeave() {
    this.detenerVigilanciaPermisos();
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.detenerVigilanciaPermisos();
    this.soltarRealtime?.();
  }


  // =====================================================
  // CARGAR ADULTOS A CARGO
  // =====================================================

  async cargarAdultos() {
    this.cargandoAdultos = true;

    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();
      void this.actualizarResumenConexion();
    } catch (error: any) {
      console.error('Error cargando adultos a cargo:', error);
    } finally {
      this.cargandoAdultos = false;
      this.changeDetectorRef.detectChanges();
    }
  }


  // =====================================================
  // RESUMEN DE CONEXIÓN (¿CUÁNTOS ESTÁN EN LÍNEA?)
  // =====================================================

  /**
   * Cuenta cuántos adultos tienen la app activa con internet.
   * Si alguno vuelve a estar en línea al poco de cargar, se vuelve a mirar.
   */
  private async actualizarResumenConexion() {
    if (!this.adultosACargo.length) {
      this.enLineaCount = 0;
      this.cargandoConexion = false;
      return;
    }

    this.cargandoConexion = true;

    // Una sola consulta para todos los adultos a cargo. Antes era una por cada
    // uno, y esto corre en cada sondeo del panel (cada 30 s), así que con 3
    // adultos eran 3 viajes a la base cada 30 segundos sólo para saber quién
    // estaba en línea.
    const ids = this.adultosACargo
      .map((a: any) => a?.id_usuario || a?.adulto_mayor?.id)
      .filter(Boolean) as string[];

    const vistos = await this.presenciaService.obtenerUltimosVistos(ids);

    this.enLineaCount = Object.values(vistos).filter((v) => estaEnLinea(v) === true).length;
    this.cargandoConexion = false;
    this.changeDetectorRef.detectChanges();
  }

  get textoResumenConexion(): string {
    const total = this.adultosACargo.length;

    if (this.cargandoConexion) {
      return 'Comprobando conexión con internet…';
    }

    if (this.enLineaCount === total) {
      return total === 1 ? 'Está en línea ahora.' : `Los ${total} están en línea ahora.`;
    }

    const sinConexion = total - this.enLineaCount;
    return `${this.enLineaCount} en línea · ${sinConexion} sin conexión.`;
  }


  // =====================================================
  // ACCIONES / NAVEGACIÓN
  // =====================================================

  abrirPerfil() {
    (document.activeElement as HTMLElement)?.blur();
    this.router.navigate(['/perfil']);
  }

  verUbicacion(adulto?: any) {
    const id = adulto?.adulto_mayor?.id || adulto?.id_usuario || adulto?.id;
    if (id) {
      this.router.navigate(['/ubicacion'], { queryParams: { id } });
    } else {
      this.router.navigate(['/ubicacion']);
    }
  }

  verCuidado() {
    this.router.navigate(['/cuidado']);
  }

  verHistorial(adulto?: any) {
    const id = adulto?.adulto_mayor?.id || adulto?.id_usuario || adulto?.id;
    if (id) {
      this.router.navigate(['/historial'], { queryParams: { id } });
    } else {
      this.router.navigate(['/historial']);
    }
  }

  verEstado(adulto?: any) {
    this.router.navigate(['/estado']);
  }

  verZonaSegura(adulto?: any) {
    const id = adulto?.adulto_mayor?.id || adulto?.id_usuario || adulto?.id;
    if (id) {
      this.router.navigate(['/zona-segura'], { queryParams: { id } });
    } else {
      this.router.navigate(['/zona-segura']);
    }
  }

  /**
   * El panel resolve solo a quién mostrar cuando no se le pasa un id: entra por
   * el menú, sin tarjeta de adulto encima, así que usa el primer vinculado.
   */
  verPanelActividad(adulto?: any) {
    const id = adulto?.adulto_mayor?.id || adulto?.id_usuario || adulto?.id;
    if (id) {
      this.router.navigate(['/panel-actividad'], { queryParams: { id } });
    } else {
      this.router.navigate(['/panel-actividad']);
    }
  }

  llamarAdulto(telefono?: string) {
    if (telefono) {
      window.open(`tel:${telefono}`, '_system');
    }
  }


  // =====================================================
  // MODAL VINCULACIÓN
  // =====================================================

  abrirVinculacion() {
    this.codigo = '';
    this.mensaje = '';
    this.mensajeError = '';
    this.mostrarModal = true;
  }

  cerrarModal() {
    this.mostrarModal = false;
  }

  async vincularPorCodigo() {
    this.mensaje = '';
    this.mensajeError = '';

    this.codigo = this.codigo.trim().toUpperCase();

    if (!this.codigo) {
      this.mensajeError = 'Ingresa el código de vinculación.';
      return;
    }

    this.vinculando = true;

    try {
      const codigoData = await this.vinculacionService.buscarCodigo(this.codigo);

      await this.vinculacionService.solicitarVinculacion(codigoData.id_usuario);

      this.mensaje = '✅ Solicitud enviada correctamente. El adulto mayor debe aceptar la vinculación.';
      this.codigo = '';

      // Refrescar lista
      await this.cargarAdultos();
    } catch (error: any) {
      this.mensajeError = error?.message ?? 'No se pudo realizar la vinculación.';
    } finally {
      this.vinculando = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async escanearQR() {
    if (!Capacitor.isNativePlatform()) {
      this.mensajeError = 'El escaneo de QR solo funciona en la app móvil.';
      return;
    }

    try {
      const granted = await this.solicitarPermisosCamara();
      if (!granted) {
        this.mensajeError = 'Se requiere permiso de cámara para escanear el código.';
        return;
      }

      const result = await BarcodeScanner.scan({
        formats: [BarcodeFormat.QrCode]
      });

      if (result.barcodes.length > 0) {
        const codigoEscaneado = result.barcodes[0].rawValue;
        if (codigoEscaneado) {
          this.codigo = codigoEscaneado.trim().toUpperCase();
          this.changeDetectorRef.detectChanges();
        }
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled') {
        console.error('Error al escanear QR:', error);
        this.mensajeError = 'No se pudo escanear el código QR.';
      }
    }
  }

  private async solicitarPermisosCamara(): Promise<boolean> {
    try {
      const status = await BarcodeScanner.requestPermissions();
      return status.camera === 'granted' || status.camera === 'limited';
    } catch {
      return false;
    }
  }

}
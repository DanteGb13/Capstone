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
  IonIcon
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { SiempreCerca } from '../../../services/alarmas/siempre-cerca';
import { PushNotificationService } from '../../../services/Backend/push-notification/push-notification';
import { Capacitor } from '@capacitor/core';

import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { CuidadoresService } from '../../../services/Backend/cuidadores/cuidadores';
import { FooterComponent } from '../../../components/footer/footer.component';
import { EstadoConexionComponent } from '../../../components/estado-conexion/estado-conexion.component';
import {
  PresenciaService,
  estaEnLinea
} from '../../../services/Backend/presencia/presencia';
import { SupabaseService } from '../../../services/supabase/supabase';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';


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
    CommonModule,
    FormsModule,
    FooterComponent,
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
    private presenciaService: PresenciaService
  ) {
    addIcons(icons);
  }


  // =====================================================
  // INICIO
  // =====================================================

  async ngOnInit() {
    this.nombreUsuario = await this.cuidadoresService.cargarUsuarioNombre();
    await this.cargarFotoPerfil();

    await this.cargarAdultos();

    this.changeDetectorRef.detectChanges();

    // Refrescar cada 30 segundos
    this.refreshInterval = setInterval(async () => {
      await this.cargarAdultos();
      this.changeDetectorRef.detectChanges();
    }, 30000);

    // Crear canal SOS + push después de cargar la página (no bloquear)
    setTimeout(() => {
      if (Capacitor.isNativePlatform()) {
        SiempreCerca.crearCanalSOS().catch(() => {});
        this.pushService.inicializar().catch(() => {});
      }
    }, 2000);

    this.inicializado = true;
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

    await this.cargarFotoPerfil();
    await this.cargarAdultos();
    this.changeDetectorRef.detectChanges();
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
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

    const vistos: Record<string, string | null> = {};

    for (const adulto of this.adultosACargo) {
      const id = adulto?.id_usuario || adulto?.adulto_mayor?.id;
      if (!id) continue;
      vistos[id] = await this.presenciaService.obtenerUltimoVisto(id);
    }

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
    this.router.navigate(['/historial']);
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
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { UbicacionForeground } from '../Backend/ubicacion-foreground/ubicacion-foreground';
import { SiempreCerca } from '../alarmas/siempre-cerca';
import { PermisosExtra } from '../Backend/permisos-extra/permisos-extra';

export interface PermisoInfo {
  id: string;
  nombre: string;
  descripcion: string;
  icono: string;
  concedido: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PermisosService {

  private isNative = Capacitor.isNativePlatform();

  async obtenerTodosLosPermisos(): Promise<PermisoInfo[]> {
    return [
      await this.verificarUbicacion(),
      await this.verificarCamara(),
      await this.verificarFotos(),
      await this.verificarNotificaciones(),
      await this.verificarAlarmaExacta(),
      await this.verificarTelefono(),
      await this.verificarContactos(),
      await this.verificarBateria()
    ];
  }

  getPermisosPorDefecto(): PermisoInfo[] {
    return [
      { id: 'ubicacion', nombre: 'Ubicación', descripcion: 'Para localizarte en el mapa', icono: 'location-outline', concedido: false },
      { id: 'camara', nombre: 'Cámara', descripcion: 'Tomar fotos de perfil', icono: 'camera-outline', concedido: false },
      { id: 'fotos', nombre: 'Fotos y videos', descripcion: 'Acceder a galería', icono: 'images-outline', concedido: false },
      { id: 'notificaciones', nombre: 'Notificaciones', descripcion: 'Alertas y avisos', icono: 'notifications-outline', concedido: false },
      { id: 'alarma-exacta', nombre: 'Alarma exacta', descripcion: 'Recordatorios a tiempo', icono: 'time-outline', concedido: false },
      { id: 'telefono', nombre: 'Teléfono', descripcion: 'Llamar contactos de emergencia', icono: 'call-outline', concedido: false },
      { id: 'contactos', nombre: 'Contactos', descripcion: 'Acceder a tu lista de contactos', icono: 'people-outline', concedido: false },
      { id: 'bateria', nombre: 'Batería', descripcion: 'Funcionar en segundo plano', icono: 'battery-charging-outline', concedido: false }
    ];
  }

  async solicitarPermiso(idPermiso: string): Promise<boolean> {
    if (!this.isNative) return true;

    try {
      switch (idPermiso) {
        case 'ubicacion': return await this.solicitarUbicacion();
        case 'camara': return await this.solicitarCamara();
        case 'fotos': return await this.solicitarFotos();
        case 'notificaciones': return await this.solicitarNotificaciones();
        case 'alarma-exacta': return await this.solicitarAlarmaExacta();
        case 'telefono': return await this.solicitarTelefono();
        case 'contactos': return await this.solicitarContactos();
        case 'bateria': return await this.solicitarBateria();
        default: return true;
      }
    } catch (e) {
      console.warn('Error solicitando permiso:', e);
      return false;
    }
  }

  // =====================================================
  // UBICACIÓN
  // =====================================================

  private async solicitarUbicacion(): Promise<boolean> {
    try {
      await UbicacionForeground.iniciar({ intervaloMs: 30000, distanciaMinimaM: 20 });
      return true;
    } catch {
      await this.abrirAjustesApp();
      return false;
    }
  }

  // =====================================================
  // CÁMARA
  // =====================================================

  private async solicitarCamara(): Promise<boolean> {
    try {
      const { Camera } = await import('@capacitor/camera');
      const r = await Camera.checkPermissions();
      if (r.camera === 'granted') return true;
      const s = await Camera.requestPermissions();
      return s.camera === 'granted';
    } catch { return false; }
  }

  // =====================================================
  // FOTOS Y VIDEOS
  // =====================================================

  private async solicitarFotos(): Promise<boolean> {
    try {
      const { Camera } = await import('@capacitor/camera');
      const r = await Camera.checkPermissions();
      if (r.photos === 'granted') return true;
      const s = await Camera.requestPermissions({ permissions: ['photos'] });
      return s.photos === 'granted';
    } catch { return false; }
  }

  // =====================================================
  // NOTIFICACIONES
  // =====================================================

  private async solicitarNotificaciones(): Promise<boolean> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const r = await LocalNotifications.checkPermissions();
      if (r.display === 'granted') return true;
      const s = await LocalNotifications.requestPermissions();
      return s.display === 'granted';
    } catch { return false; }
  }

  // =====================================================
  // ALARMA EXACTA (recordatorios que no se atrasan)
  // =====================================================

  private async solicitarAlarmaExacta(): Promise<boolean> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const r = await LocalNotifications.checkExactNotificationSetting();
      if (r.exact_alarm === 'granted') return true;
      await LocalNotifications.changeExactNotificationSetting();
      const s = await LocalNotifications.checkExactNotificationSetting();
      return s.exact_alarm === 'granted';
    } catch { return false; }
  }

  // =====================================================
  // TELÉFONO
  // =====================================================

  private async solicitarTelefono(): Promise<boolean> {
    try {
      const r = await PermisosExtra.solicitarTelefono();
      return r.concedido;
    } catch { return false; }
  }

  // =====================================================
  // CONTACTOS
  // =====================================================

  private async solicitarContactos(): Promise<boolean> {
    try {
      const r = await PermisosExtra.solicitarContactos();
      return r.concedido;
    } catch { return false; }
  }

  // =====================================================
  // BATERÍA
  // =====================================================

  private async solicitarBateria(): Promise<boolean> {
    try {
      await SiempreCerca.pedirIgnorarOptimizacion();
      const r = await SiempreCerca.ignorandoBateria();
      return r.si;
    } catch { return false; }
  }

  // =====================================================
  // VERIFICAR ESTADOS
  // =====================================================

  private async verificarUbicacion(): Promise<PermisoInfo> {
    let concedido = false;
    try {
      if (this.isNative) {
        const r = await UbicacionForeground.verificarPermisos();
        concedido = r.ubicacionForeground;
      } else if ('permissions' in navigator) {
        const r = await (navigator.permissions as any).query({ name: 'geolocation' });
        concedido = r.state === 'granted';
      }
    } catch { concedido = false; }
    return { id: 'ubicacion', nombre: 'Ubicación', descripcion: 'Para localizarte en el mapa', icono: 'location-outline', concedido };
  }

  private async verificarCamara(): Promise<PermisoInfo> {
    let concedido = false;
    try {
      if (this.isNative) {
        const { Camera } = await import('@capacitor/camera');
        const r = await Camera.checkPermissions();
        concedido = r.camera === 'granted';
      }
    } catch { concedido = false; }
    return { id: 'camara', nombre: 'Cámara', descripcion: 'Tomar fotos de perfil', icono: 'camera-outline', concedido };
  }

  private async verificarFotos(): Promise<PermisoInfo> {
    let concedido = false;
    try {
      if (this.isNative) {
        const { Camera } = await import('@capacitor/camera');
        const r = await Camera.checkPermissions();
        concedido = r.photos === 'granted';
      }
    } catch { concedido = false; }
    return { id: 'fotos', nombre: 'Fotos y videos', descripcion: 'Acceder a galería', icono: 'images-outline', concedido };
  }

  private async verificarNotificaciones(): Promise<PermisoInfo> {
    let concedido = false;
    try {
      if (this.isNative) {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const r = await LocalNotifications.checkPermissions();
        concedido = r.display === 'granted';
      } else if ('Notification' in window) {
        concedido = (Notification as any).permission === 'granted';
      }
    } catch { concedido = false; }
    return { id: 'notificaciones', nombre: 'Notificaciones', descripcion: 'Alertas y avisos', icono: 'notifications-outline', concedido };
  }

  private async verificarAlarmaExacta(): Promise<PermisoInfo> {
    let concedido = false;
    try {
      if (this.isNative) {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const r = await LocalNotifications.checkExactNotificationSetting();
        concedido = r.exact_alarm === 'granted';
      }
    } catch { concedido = false; }
    return { id: 'alarma-exacta', nombre: 'Alarma exacta', descripcion: 'Recordatorios a tiempo', icono: 'time-outline', concedido };
  }

  private async verificarTelefono(): Promise<PermisoInfo> {
    let concedido = false;
    try {
      if (this.isNative) {
        const r = await PermisosExtra.verificarPermisos();
        concedido = r.telefono;
      }
    } catch { concedido = false; }
    return { id: 'telefono', nombre: 'Teléfono', descripcion: 'Llamar contactos de emergencia', icono: 'call-outline', concedido };
  }

  private async verificarContactos(): Promise<PermisoInfo> {
    let concedido = false;
    try {
      if (this.isNative) {
        const r = await PermisosExtra.verificarPermisos();
        concedido = r.contactos;
      }
    } catch { concedido = false; }
    return { id: 'contactos', nombre: 'Contactos', descripcion: 'Acceder a tu lista de contactos', icono: 'people-outline', concedido };
  }

  private async verificarBateria(): Promise<PermisoInfo> {
    let concedido = true;
    try {
      if (this.isNative) {
        const r = await SiempreCerca.ignorandoBateria();
        concedido = r.si;
      }
    } catch { concedido = true; }
    return { id: 'bateria', nombre: 'Batería', descripcion: 'Funcionar en segundo plano', icono: 'battery-charging-outline', concedido };
  }

  async abrirAjustesApp(): Promise<void> {
    try {
      if (this.isNative) {
        await UbicacionForeground.abrirAjustes();
      }
    } catch (e) {
      console.warn('Error abriendo ajustes:', e);
    }
  }
}

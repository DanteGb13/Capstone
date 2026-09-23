import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonSpinner
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Geolocation, Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { AlertController } from '@ionic/angular';
import { CuidadoresService } from '../../../services/Backend/cuidadores/cuidadores';

declare const L: any; // Leaflet (cargado globalmente en index.html)

@Component({
  selector: 'app-mi-ubicacion',
  templateUrl: './mi-ubicacion.page.html',
  styleUrls: ['./mi-ubicacion.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonSpinner,
    CommonModule
  ]
})
export class MiUbicacionPage implements OnInit, AfterViewInit, OnDestroy {

  // =====================================================
  // ESTADO GPS
  // =====================================================

  estadoTexto: string = 'Esperando GPS...';

  lat: number | null = null;

  lon: number | null = null;

  precision: number = 0;

  velocidad: number = 0;

  hora: string = '-';

  ubicacionActiva: boolean = false;

  errorGps: string = '';

  iniciando: boolean = true;

  // =====================================================
  // DIRECCIÓN DEL PERFIL (CASA)
  // =====================================================

  calle: string = '';

  numero: string = '';

  comuna: string = '';

  region: string = '';

  tieneDireccion: boolean = false;

  // =====================================================
  // MAPA (LEAFLET)
  // =====================================================

  private map: any = null;

  private marker: any = null;

  private accuracyCircle: any = null;

  private watchId: string | null = null;

  private webWatchId: number | null = null;

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private alertCtrl: AlertController,
    private cuidadoresService: CuidadoresService
  ) {
    addIcons(icons);
  }

  // =====================================================
  // INICIO
  // =====================================================

  async ngOnInit() {
    await this.cargarDireccionPerfil();
    await this.iniciarWatch();
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.inicializarMapa();
      // Si el GPS ya fijó posición antes de inicializarse el mapa, pintarla
      if (this.map && this.lat != null && this.lon != null) {
        this.renderizarEnMapa(this.lat, this.lon, this.precision || 30);
      }
      this.changeDetectorRef.detectChanges();
    }, 300);
  }

  ngOnDestroy() {
    this.detenerWatch();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  // =====================================================
  // DIRECCIÓN DEL PERFIL
  // =====================================================

  private async cargarDireccionPerfil() {
    try {
      const usuario = await this.cuidadoresService.cargarUsuario();
      if (!usuario) return;

      const dir = (usuario as any).direccion;
      if (dir) {
        this.calle = dir.calle || '';
        this.numero = (dir.numero ?? '').toString();
        this.comuna = dir.comuna || '';
        this.region = dir.region || '';
        this.tieneDireccion = !!(this.calle.trim() || this.numero.trim());
      }
    } catch (e) {
      console.error('Error cargando dirección del perfil:', e);
    }
  }

  // =====================================================
  // GPS EN TIEMPO REAL (MISMO TELÉFONO)
  // =====================================================

  private async iniciarWatch() {
    this.iniciando = true;

    // Verificar y pedir permisos de ubicación
    if (Capacitor.isNativePlatform()) {
      try {
        const permiso = await Geolocation.checkPermissions();
        if (permiso.location !== 'granted') {
          const pedido = await Geolocation.requestPermissions();
          if (pedido.location !== 'granted') {
            this.estadoTexto = 'Permiso de ubicación denegado';
            this.errorGps = 'Debes activar los permisos de ubicación para poder usar tu ubicación.';
            this.iniciando = false;
            this.changeDetectorRef.detectChanges();
            return;
          }
        }
      } catch (e: any) {
        console.warn('Error de permisos geolocation:', e);
      }
    }

    try {
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        (pos: Position | null, err: any) => {
          if (err) {
            this.manejarErrorGps(err?.message || 'Error GPS');
            return;
          }
          if (pos) {
            this.procesarPosicion(pos.coords as any);
          }
        }
      );
    } catch (e: any) {
      // Fallback al GPS del navegador (Web)
      this.usarGeolocalizacionNavegador();
    } finally {
      this.iniciando = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private usarGeolocalizacionNavegador() {
    if (!('geolocation' in navigator)) {
      this.manejarErrorGps('El dispositivo no soporta geolocalización.');
      return;
    }

    this.webWatchId = navigator.geolocation.watchPosition(
      (pos) => this.procesarPosicion(pos.coords),
      (err) => this.manejarErrorGps(err?.message || 'Error GPS'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  private procesarPosicion(coords: { latitude: number; longitude: number; accuracy?: number; speed?: number | null }) {
    this.lat = coords.latitude;
    this.lon = coords.longitude;
    this.precision = Math.round(coords.accuracy || 0);
    this.velocidad = coords.speed == null ? 0 : coords.speed * 3.6;
    this.hora = new Date().toLocaleTimeString();
    this.estadoTexto = 'GPS conectado';
    this.errorGps = '';
    this.ubicacionActiva = true;

    this.changeDetectorRef.detectChanges();
    this.renderizarEnMapa(this.lat, this.lon, coords.accuracy || 30);
  }

  private manejarErrorGps(mensaje: string) {
    this.estadoTexto = 'GPS sin señal';
    this.errorGps = mensaje;
    this.ubicacionActiva = false;
    console.warn('GPS error:', mensaje);
    this.changeDetectorRef.detectChanges();
  }

  private detenerWatch() {
    if (this.watchId) {
      Geolocation.clearWatch({ id: this.watchId }).catch(() => {});
      this.watchId = null;
    }
    if (this.webWatchId != null) {
      navigator.geolocation.clearWatch(this.webWatchId);
      this.webWatchId = null;
    }
  }

  // =====================================================
  // MAPA (LEAFLET)
  // =====================================================

  private inicializarMapa(): boolean {
    const container = document.getElementById('miMapa');
    if (!container || typeof L === 'undefined') {
      return false;
    }

    if (this.map) {
      return true;
    }

    try {
      const latInicial = this.lat ?? -33.4489;
      const lngInicial = this.lon ?? -70.6693;

      this.map = L.map(container, {
        center: [latInicial, lngInicial],
        zoom: 15,
        zoomControl: false
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);

      L.control.zoom({ position: 'topright' }).addTo(this.map);

      return true;
    } catch (e) {
      console.error('Error inicializando mapa:', e);
      return false;
    }
  }

  private renderizarEnMapa(lat: number, lon: number, precision: number) {
    if (!this.map) {
      this.inicializarMapa();
    }
    if (!this.map) return;

    const coords: [number, number] = [lat, lon];

    if (this.marker) {
      this.marker.setLatLng(coords);
    } else {
      this.marker = L.marker(coords).addTo(this.map);
    }

    if (this.accuracyCircle) {
      this.accuracyCircle.setLatLng(coords);
      this.accuracyCircle.setRadius(precision || 30);
    } else {
      this.accuracyCircle = L.circle(coords, {
        radius: precision || 30,
        color: '#2196F3',
        fillColor: '#42A5F5',
        fillOpacity: 0.2,
        weight: 1.5
      }).addTo(this.map);
    }

    this.map.setView(coords, 17);
  }

  centrarMapa() {
    if (this.map && this.lat != null && this.lon != null) {
      this.map.setView([this.lat, this.lon], 18);
    }
  }

  abrirEnGoogleMaps() {
    if (this.lat == null || this.lon == null) {
      this.mostrarAlertaLocacionDesactivada();
      return;
    }
    const url = `https://www.google.com/maps?q=${this.lat},${this.lon}`;
    window.open(url, '_system');
  }

  // =====================================================
  // IR A MI CASA (NAVEGAR DESDE EL PUNTO ACTUAL)
  // =====================================================

  async irACasa() {
    if (!this.ubicacionActiva || this.lat == null || this.lon == null) {
      const alert = await this.alertCtrl.create({
        header: 'Ubicación no activa',
        message:
          'Tu ubicación no está activa o aún no se ha obtenido tu posición.\n\n' +
          'Debes activar los permisos de ubicación del teléfono y tener el GPS encendido para poder ir a tu casa.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    if (!this.tieneDireccion) {
      const alert = await this.alertCtrl.create({
        header: 'Sin dirección guardada',
        message: 'No tienes una dirección de casa guardada en tu perfil. Agrégala en la opción Perfil para poder ir a tu casa.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const destino = [this.calle, this.numero, this.comuna, this.region, 'Chile']
      .filter((parte) => parte && parte.trim().length > 0)
      .join(', ');

    // Navegación guiada desde mi ubicación actual hasta mi casa
    const url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${this.lat},${this.lon}` +
      `&destination=${encodeURIComponent(destino)}` +
      `&travelmode=driving`;

    window.open(url, '_system');
  }

  private async mostrarAlertaLocacionDesactivada() {
    const alert = await this.alertCtrl.create({
      header: 'Ubicación no activa',
      message:
        'Tu ubicación no está activa.\n\n' +
        'Debes activar los permisos de ubicación (Ajustes del teléfono > Apps > SiempreCerca > Permisos) y tener el GPS encendido.',
      buttons: ['OK']
    });
    await alert.present();
  }
}
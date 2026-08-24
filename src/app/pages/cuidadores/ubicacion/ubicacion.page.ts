import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonSelect,
  IonSelectOption,
  IonSpinner
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { Gps, UbicacionInfo } from '../../../services/Backend/gps/gps';

declare const L: any; // Leaflet

@Component({
  selector: 'app-ubicacion',
  templateUrl: './ubicacion.page.html',
  styleUrls: ['./ubicacion.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    CommonModule,
    FormsModule
  ]
})
export class UbicacionPage implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef;

  // =====================================================
  // DATOS DE ADULTOS MAYORES
  // =====================================================

  adultosACargo: any[] = [];

  adultoSeleccionado: any = null;

  cargandoLista: boolean = false;


  // =====================================================
  // ESTADO DE UBICACIÓN
  // =====================================================

  ubicacionActual: UbicacionInfo | null = null;

  cargandoUbicacion: boolean = false;

  ultimaActualizacionTexto: string = 'Nunca';

  tiempoRestanteSegundos: number = 300; // 5 minutos = 300 segundos

  contadorTexto: string = '5:00';


  // =====================================================
  // MAPA (LEAFLET)
  // =====================================================

  private map: any = null;

  private marker: any = null;

  private accuracyCircle: any = null;


  // =====================================================
  // TIMERS
  // =====================================================

  private autoRefreshTimer: any = null;

  private countdownInterval: any = null;


  // =====================================================
  // CONSTRUCTOR
  // =====================================================

  constructor(
    private vinculacionService: Vinculacion,
    private gpsService: Gps,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private route: ActivatedRoute
  ) {
    addIcons(icons);
  }


  // =====================================================
  // INICIO
  // =====================================================

  async ngOnInit() {
    await this.cargarAdultosACargo();

    this.route.queryParams.subscribe((params) => {
      if (params['id'] && this.adultosACargo.length > 0) {
        const encontrado = this.adultosACargo.find(
          (item) => item.id === params['id'] || item.adulto_mayor?.id === params['id'] || item.id_usuario === params['id']
        );
        if (encontrado) {
          this.adultoSeleccionado = encontrado;
          this.actualizarUbicacion(true);
        }
      }
    });

    this.iniciarTemporizadorAutoRefresh();
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.inicializarMapa();
      if (this.adultoSeleccionado) {
        this.actualizarUbicacion(false);
      }
    }, 400);
  }

  ngOnDestroy() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }


  // =====================================================
  // CARGAR ADULTOS A CARGO
  // =====================================================

  async cargarAdultosACargo() {
    this.cargandoLista = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();

      if (this.adultosACargo && this.adultosACargo.length > 0) {
        this.adultoSeleccionado = this.adultosACargo[0];
      }
    } catch (error: any) {
      console.error('Error al cargar adultos vinculados:', error);
    } finally {
      this.cargandoLista = false;
      this.changeDetectorRef.detectChanges();

      // Inicializar mapa luego de renderizar la vista con los adultos
      if (this.adultosACargo.length > 0) {
        setTimeout(() => {
          this.inicializarMapa();
          if (this.adultoSeleccionado) {
            this.actualizarUbicacion(true);
          }
        }, 200);
      }
    }
  }


  // =====================================================
  // CAMBIO DE ADULTO SELECCIONADO
  // =====================================================

  onAdultoChange(event: any) {
    const id = event.detail.value;
    const encontrado = this.adultosACargo.find(item => item.id === id || item.adulto_mayor?.id === id);
    if (encontrado) {
      this.adultoSeleccionado = encontrado;
      this.actualizarUbicacion(true);
    }
  }


  // =====================================================
  // INICIALIZAR MAPA (LEAFLET)
  // =====================================================

  private inicializarMapa(): boolean {
    const container = document.getElementById('map');
    if (!container || typeof L === 'undefined') {
      return false;
    }

    if (this.map) {
      return true;
    }

    try {
      // Coordenadas por defecto (Santiago, Chile)
      const latInicial = -33.4489;
      const lngInicial = -70.6693;

      this.map = L.map(container, {
        center: [latInicial, lngInicial],
        zoom: 15,
        zoomControl: false
      });

      // Capa de mosaicos OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);

      // Botones de zoom en la esquina superior derecha
      L.control.zoom({ position: 'topright' }).addTo(this.map);

      return true;
    } catch (e) {
      console.error('Error inicializando mapa:', e);
      return false;
    }
  }


  // =====================================================
  // ACTUALIZAR UBICACIÓN (MANUAL O AUTOMÁTICO)
  // =====================================================

  async actualizarUbicacion(centrarEnMapa: boolean = true) {
    if (!this.adultoSeleccionado) {
      return;
    }

    this.cargandoUbicacion = true;
    this.changeDetectorRef.detectChanges();

    const idUsuario = this.adultoSeleccionado.adulto_mayor?.id || this.adultoSeleccionado.id_usuario;
    const direccionFallback = this.adultoSeleccionado.adulto_mayor?.direccion;

    try {
      const info = await this.gpsService.obtenerUbicacionAdulto(idUsuario, direccionFallback);
      this.ubicacionActual = info;

      const ahora = new Date();
      this.ultimaActualizacionTexto = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Reiniciar contador de 5 min
      this.tiempoRestanteSegundos = 300;
      this.actualizarTextoContador();

      // Asegurar inicialización de mapa
      if (!this.map) {
        this.changeDetectorRef.detectChanges();
        setTimeout(() => {
          this.inicializarMapa();
          this.renderizarEnMapa(info, centrarEnMapa);
        }, 150);
      } else {
        this.renderizarEnMapa(info, centrarEnMapa);
      }
    } catch (error: any) {
      console.error('Error obteniendo ubicación:', error);
    } finally {
      this.cargandoUbicacion = false;
      this.changeDetectorRef.detectChanges();
    }
  }


  // =====================================================
  // RENDERIZAR EN MAPA CON PIN Y POPUP
  // =====================================================

  private renderizarEnMapa(info: UbicacionInfo, centrar: boolean = true) {
    if (!this.map || typeof L === 'undefined') {
      this.inicializarMapa();
    }

    if (!this.map) return;

    const nombreAdulto = this.adultoSeleccionado?.adulto_mayor?.nombre
      ? `${this.adultoSeleccionado.adulto_mayor.nombre} ${this.adultoSeleccionado.adulto_mayor.apellidopa || ''}`
      : 'Adulto Mayor';

    const coords = [info.latitud, info.longitud];

    // Crear icono personalizado moderno
    const customIcon = L.divIcon({
      className: 'custom-map-marker',
      html: `
        <div class="marker-pin">
          <div class="marker-avatar">
            <i class="bi bi-person-fill"></i>
          </div>
          <div class="pulse-ring"></div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -42]
    });

    if (this.marker) {
      this.marker.setLatLng(coords);
    } else {
      this.marker = L.marker(coords, { icon: customIcon }).addTo(this.map);
    }

    // Popup
    const popupContent = `
      <div style="text-align: center; padding: 4px;">
        <strong style="font-size: 15px; color: #7715c7; display: block; margin-bottom: 4px;">
          ${nombreAdulto}
        </strong>
        <span style="font-size: 12px; color: #555;">
          ${info.direccionTexto || 'Ubicación activa'}
        </span>
        <div style="margin-top: 6px; font-size: 11px; color: #27ae60; font-weight: bold;">
          🟢 Localizado a las ${this.ultimaActualizacionTexto}
        </div>
      </div>
    `;

    this.marker.bindPopup(popupContent);

    // Círculo de precisión
    if (this.accuracyCircle) {
      this.accuracyCircle.setLatLng(coords);
      this.accuracyCircle.setRadius(info.precision || 30);
    } else {
      this.accuracyCircle = L.circle(coords, {
        radius: info.precision || 30,
        color: '#7715c7',
        fillColor: '#9c3ded',
        fillOpacity: 0.15,
        weight: 1.5
      }).addTo(this.map);
    }

    if (centrar) {
      this.localizarEnMapa();
    }
  }


  // =====================================================
  // BOTÓN: LOCALIZAR EN MAPA (CENTRADO CON ZOOM Y POPUP)
  // =====================================================

  localizarEnMapa() {
    if (!this.map || !this.ubicacionActual) {
      this.actualizarUbicacion(true);
      return;
    }

    const coords = [this.ubicacionActual.latitud, this.ubicacionActual.longitud];

    this.map.flyTo(coords, 17, {
      animate: true,
      duration: 1.2
    });

    if (this.marker) {
      setTimeout(() => {
        this.marker.openPopup();
      }, 1000);
    }
  }


  // =====================================================
  // ABRIR EN NAVEGADOR EXTERNO (GOOGLE MAPS / WAZE)
  // =====================================================

  abrirEnGoogleMaps() {
    if (!this.ubicacionActual) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${this.ubicacionActual.latitud},${this.ubicacionActual.longitud}`;
    window.open(url, '_system');
  }


  // =====================================================
  // TEMPORIZADOR DE AUTO-REFRESH CADA 5 MINUTOS
  // =====================================================

  private iniciarTemporizadorAutoRefresh() {
    // Contador segundo a segundo
    this.countdownInterval = setInterval(() => {
      if (this.tiempoRestanteSegundos > 0) {
        this.tiempoRestanteSegundos--;
        this.actualizarTextoContador();
        this.changeDetectorRef.detectChanges();
      }
    }, 1000);

    // Actualización cada 5 minutos (300,000 ms)
    this.autoRefreshTimer = setInterval(async () => {
      await this.actualizarUbicacion(false);
    }, 300000);
  }

  private actualizarTextoContador() {
    const minutos = Math.floor(this.tiempoRestanteSegundos / 60);
    const segundos = this.tiempoRestanteSegundos % 60;
    this.contadorTexto = `${minutos}:${segundos < 10 ? '0' : ''}${segundos}`;
  }

  get nombreAdultoActual(): string {
    if (!this.adultoSeleccionado?.adulto_mayor) {
      return 'Adulto Mayor';
    }
    const { nombre, apellidopa, apellidoma } = this.adultoSeleccionado.adulto_mayor;
    return `${nombre || ''} ${apellidopa || ''} ${apellidoma || ''}`.trim();
  }

}

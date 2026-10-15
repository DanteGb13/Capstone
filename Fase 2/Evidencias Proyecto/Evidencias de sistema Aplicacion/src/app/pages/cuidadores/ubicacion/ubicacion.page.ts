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
import { EstadoConexionComponent } from '../../../components/estado-conexion/estado-conexion.component';
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
    FormsModule,
    EstadoConexionComponent
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

  private inicializado = false;


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

  /**
   * Persona que se pidió abrir por la URL (`?id=`), todavía sin aplicar.
   *
   * Antes la URL disparaba su propia actualización de ubicación y la lista
   * disparaba otra, así que entrar a la pantalla costaba 3 o 4 viajes a la red
   * encadenados. Ahora la URL sólo anota qué se quiere y hay un solo lugar
   * que decide a quién mostrar.
   */
  private idSolicitadoUrl: string | null = null;

  /**
   * Hay una lectura de ubicación en curso.
   *
   * Sirve para no encadenar dos: el botón de refrescar y la carga inicial
   * pueden coincidir, y con la red lenta la segunda encuentra a la primera a
   * medio camino y las dos se pisan.
   */
  private ubicacionEnCurso = false;


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
    // La lista se carga sin esperar: el mapa no depende de ella y se dibuja
    // igual. Antes se esperaba aquí, y como el mapa se creaba recién al
    // terminar esta llamada, la pantalla se quedaba 1-2 segundos en blanco
    // antes de existir siquiera un mapa.
    void this.cargarAdultosACargo();

    this.route.queryParams.subscribe((params) => {
      const id = params['id'];

      // Si no hay id, o es el mismo adulto que ya está seleccionado, no se hace
      // nada: releer la ubicación para mostrar lo mismo es lo que multiplicaba
      // los viajes de red.
      if (!id || (this.adultoSeleccionado && this.idDeAdulto(this.adultoSeleccionado) === id)) {
        return;
      }

      this.idSolicitadoUrl = id;
      void this.aplicarAdultoSolicitado();
    });

    this.iniciarTemporizadorAutoRefresh();

    this.inicializado = true;
  }

  ngAfterViewInit() {
    // El mapa se crea ya, sin esperar. Puede que el contenedor mida 0 porque la
    // transición de entrada de Ionic sigue corriendo; eso lo corrige
    // `ionViewDidEnter`, no una espera a ciegas.
    this.inicializarMapa();
  }

  /**
   * Cuando la animación de entrada termina, el contenedor tiene su tamaño real
   * y Leaflet necesita enterarse para pintar los tiles.
   */
  ionViewDidEnter() {
    this.ajustarTamanoMapa();
  }

  private ajustarTamanoMapa() {
    if (!this.map) return;
    try {
      this.map.invalidateSize({ animate: false });
    } catch {
      /* el mapa todavía no está listo */
    }
  }

  /** Id del adulto en cualquiera de las formas que trae la lista. */
  private idDeAdulto(adulto: any): string {
    return adulto?.adulto_mayor?.id || adulto?.id_usuario || '';
  }

  /**
   * Aplica la persona que pedía la URL, si ya está en la lista.
   *
   * Se llama desde los dos lados (URL y lista) porque cualquiera de las dos
   * puede llegar primero, y sólo una gana: si la URL se aplica primero, la
   * lista ya no vuelve a sobrescribir.
   */
  private async aplicarAdultoSolicitado(): Promise<void> {
    if (this.cargandoLista || !this.idSolicitadoUrl || this.adultosACargo.length === 0) {
      return;
    }

    const encontrado = this.adultosACargo.find(
      (item) =>
        item.id === this.idSolicitadoUrl ||
        item.adulto_mayor?.id === this.idSolicitadoUrl ||
        item.id_usuario === this.idSolicitadoUrl
    );

    if (!encontrado) return;

    const idActual = this.adultoSeleccionado ? this.idDeAdulto(this.adultoSeleccionado) : '';
    if (idActual === this.idSolicitadoUrl) return;

    this.adultoSeleccionado = encontrado;
    this.idSolicitadoUrl = null;

    await this.actualizarUbicacion(true);
  }

  async ionViewWillEnter() {
    if (!this.inicializado || this.cargandoLista) {
      return;
    }

    await this.recargarListaAdultos();
  }

  // Mantiene el menú de personas a cargo sincronizado: si alguien fue
  // desvinculado, desaparece de la lista y de la selección actual.
  private async recargarListaAdultos() {
    const idPrevio =
      this.adultoSeleccionado?.adulto_mayor?.id ||
      this.adultoSeleccionado?.id_usuario ||
      null;

    try {
      const lista = await this.vinculacionService.obtenerAdultosACargo();
      this.adultosACargo = lista;

      if (idPrevio) {
        const sigue = lista.find(
          (item) =>
            item.adulto_mayor?.id === idPrevio || item.id_usuario === idPrevio
        );
        this.adultoSeleccionado = sigue || lista[0] || null;
      } else if (!this.adultoSeleccionado && lista.length > 0) {
        this.adultoSeleccionado = lista[0];
      }

      if (!this.adultoSeleccionado) {
        this.ubicacionActual = null;
        this.ultimaActualizacionTexto = 'Nunca';
      }

      this.changeDetectorRef.detectChanges();
    } catch (error: any) {
      console.error('Error recargando adultos a cargo:', error);
    }
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

      // Una sola lectura de ubicación por entrada. Antes se pedía desde acá
      // (tras 200 ms de espera), otra vez en ngAfterViewInit (tras 400 ms) y
      // otra más si venía `?id=`: tres o cuatro viajes encadenados, cada uno con
      // su propio geocodificado. Con la red lenta eso son 5 a 10 segundos.
      //
      // Ahora el mapa ya existe desde ngAfterViewInit: sólo falta pintarle el
      // punto cuando llegue la posición.
      if (this.adultoSeleccionado && !this.idSolicitadoUrl) {
        void this.actualizarUbicacion(true);
      }

      void this.aplicarAdultoSolicitado();
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
      this.idSolicitadoUrl = null;
      void this.actualizarUbicacion(true);
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

      // Host único (HTTP/2) en vez de subdominios {s}: con {s} el navegador
      // resuelve a.tile.openstreetmap.org, y ese dominio NO es el del
      // `preconnect` de index.html, así que había que hacer DNS y handshake TLS
      // desde cero y los tiles llegaban 2-3 segundos más tarde.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // No pedir tiles de zooms intermedios durante un zoom animado: sólo
        // se descarga el nivel final.
        updateWhenZooming: false,
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

    // Si ya hay una lectura en curso se devuelve: encadenar dos sobre la misma
    // persona sólo produce dos pinchazos superpuestos y el doble de espera.
    if (this.ubicacionEnCurso) {
      return;
    }

    this.ubicacionEnCurso = true;
    this.cargandoUbicacion = true;
    this.changeDetectorRef.detectChanges();

    const idUsuario = this.adultoSeleccionado.adulto_mayor?.id || this.adultoSeleccionado.id_usuario;
    const direccionFallback = this.adultoSeleccionado.adulto_mayor?.direccion;

    try {
      // El pin se dibuja apenas llegan las coordenadas. La dirección en texto
      // llega después, por el callback, porque el mapa no la necesita para
      // mostrar dónde está el adulto.
      const info = await this.gpsService.obtenerUbicacionAdulto(
        idUsuario,
        direccionFallback,
        (conDireccion) => {
          this.ubicacionActual = conDireccion;
          this.renderizarEnMapa(conDireccion, false);
          this.changeDetectorRef.detectChanges();
        }
      );

      this.ubicacionActual = info;

      const ahora = new Date();
      this.ultimaActualizacionTexto = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

      // Reiniciar contador de 5 min
      this.tiempoRestanteSegundos = 300;
      this.actualizarTextoContador();

      // El mapa se crea en ngAfterViewInit; si aun así no está (el contenedor
      // puede no existir todavía), renderizarEnMapa lo inicializa.
      this.renderizarEnMapa(info, centrarEnMapa);
    } catch (error: any) {
      console.error('Error obteniendo ubicación:', error);
    } finally {
      this.ubicacionEnCurso = false;
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

    // Pin clásico de ubicación (gotita) con degradado morado
    const customIcon = L.divIcon({
      className: 'custom-map-marker',
      html: `
        <div class="marker-pin">
          <div class="pulse-ring"></div>
          <svg width="40" height="50" viewBox="0 0 40 50">
            <defs>
              <linearGradient id="ubiPinGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#7715c7"/>
                <stop offset="100%" stop-color="#9c3ded"/>
              </linearGradient>
            </defs>
            <path d="M20 2 C 9 2 2 10 2 20 C 2 32 20 48 20 48 C 20 48 38 32 38 20 C 38 10 31 2 20 2 Z"
                  fill="url(#ubiPinGrad)" stroke="#ffffff" stroke-width="2"/>
            <circle cx="20" cy="20" r="8" fill="#ffffff"/>
            <circle cx="20" cy="20" r="4" fill="#7715c7"/>
          </svg>
        </div>
      `,
      iconSize: [40, 50],
      iconAnchor: [20, 48],
      popupAnchor: [0, -46]
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

  /** Último "latido" conocido del adulto seleccionado (estado en línea). */
  get ultimoVistoSeleccionado(): string | null {
    return this.adultoSeleccionado?.adulto_mayor?.ultimo_visto || null;
  }

  get nombreAdultoActual(): string {
    if (!this.adultoSeleccionado?.adulto_mayor) {
      return 'Adulto Mayor';
    }
    const { nombre, apellidopa, apellidoma } = this.adultoSeleccionado.adulto_mayor;
    return `${nombre || ''} ${apellidopa || ''} ${apellidoma || ''}`.trim();
  }

}

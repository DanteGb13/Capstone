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
  IonIcon
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Geolocation, Position } from '@capacitor/geolocation';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AlertController } from '@ionic/angular';
import { CuidadoresService } from '../../../services/Backend/cuidadores/cuidadores';
import { AbrirUrl } from '../../../services/Backend/abrir-url/abrir-url';

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

  hora: string = '-';

  ubicacionActiva: boolean = false;

  errorGps: string = '';

  iniciando: boolean = true;

  permisoDenegado: boolean = false;

  /** True cuando lo que se ve es la ultima posicion guardada, no un fix en vivo. */
  mostrandoUltimaConocida: boolean = false;

  // Texto del badge flotante sobre el mapa
  get textoBadge(): string {
    if (this.permisoDenegado) {
      return 'Permiso de ubicación denegado';
    }
    if (this.mostrandoUltimaConocida && (this.lat != null && this.lon != null)) {
      return 'Última ubicación conocida';
    }
    if (this.errorGps) {
      return 'GPS sin señal';
    }
    if (this.ubicacionActiva) {
      return 'GPS conectado';
    }
    return 'Esperando GPS...';
  }

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

  private destruido: boolean = false;

  /** Momento de la última posición recibida (para detectar GPS congelado). */
  private ultimaPosicionMs: number = 0;

  private iniciandoWatch: boolean = false;

  private timerVigilancia: any = null;

  private ultimoIntentoMs: number = 0;


  /**
   * Techo de deteccion: a los 4 s la pantalla tiene que mostrar SIEMPRE una
   * posicion (la ultima conocida) o un estado claro de "buscando", nunca quedar
   * en blanco ni mostrando "GPS sin senal" mientras el GPS decide.
   */
  private readonly LIMITE_DETECCION_MS = 4000;

  private timerLimite: any = null;

  /** Segundos sin posiciones antes de dar el GPS por muerto y reconectarlo. */
  private readonly LIMITE_SIN_POSICION_MS = 45000;

  /** Espera mínima entre reconexiones, para no reiniciar el GPS en bucle. */
  private readonly ESPERA_ENTRE_INTENTOS_MS = 60000;

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
    // La posicion se toma SOLO del GPS en vivo: no se pinta ninguna ubicacion
    // guardada de antes, asi el tiempo que se ve en pantalla es el real del GPS.
    this.iniciarWatch();
    this.iniciarVigilanciaGps();
    await this.cargarDireccionPerfil();
  }

  /**
   * Al volver a esta página (por ejemplo después de abrir Google Maps) el
   * watcher del navegador puede quedar muerto: Android lo suspende cuando la
   * app pasa a segundo plano y no siempre vuelve. Antes solo se registraba en
   * ngOnInit, así que el GPS se quedaba congelado con "GPS sin señal".
   */
  ionViewWillEnter() {
    if (this.destruido || this.iniciandoWatch) {
      return;
    }

    // Al volver de Google Maps se conserva la ultima posicion en pantalla y se
    // restaura el estado, para que no aparezca "GPS sin señal" ni se vea vacío.
    this.restaurarPosicionPrevia();

    if (!this.watchId && this.webWatchId == null) {
      this.reconectarGps();
    }
  }

  /** Restaura la posicion que ya estaba en pantalla al salir de la pagina. */
  private restaurarPosicionPrevia() {
    if (this.lat == null || this.lon == null) {
      return;
    }

    const fixViejo = Date.now() - this.ultimaPosicionMs > 15000;

    this.ubicacionActiva = true;
    this.errorGps = '';
    this.mostrandoUltimaConocida = fixViejo;
    this.estadoTexto = fixViejo ? 'Última ubicación conocida' : 'GPS conectado';
    this.changeDetectorRef.detectChanges();
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
    this.destruido = true;
    if (this.timerVigilancia) {
      clearInterval(this.timerVigilancia);
      this.timerVigilancia = null;
    }
    if (this.timerLimite) {
      clearTimeout(this.timerLimite);
      this.timerLimite = null;
    }
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
    if (this.iniciandoWatch || this.destruido) {
      return;
    }

    this.iniciandoWatch = true;
    this.iniciando = true;
    this.armarLimiteDeteccion();

    // Verificar y pedir permisos de ubicación
    if (Capacitor.isNativePlatform()) {
      try {
        const permiso = await Geolocation.checkPermissions();
        if (permiso.location !== 'granted') {
          const pedido = await Geolocation.requestPermissions();
          if (pedido.location !== 'granted') {
            this.permisoDenegado = true;
            this.estadoTexto = 'Permiso de ubicación denegado';
            this.errorGps = 'Debes activar los permisos de ubicación para poder usar tu ubicación.';
            this.iniciando = false;
            // Se libera igual: si después la persona activa el permiso en los
            // ajustes del teléfono, al volver a la página se reintenta el GPS.
            this.iniciandoWatch = false;
            this.changeDetectorRef.detectChanges();
            return;
          }
        }
      } catch (e: any) {
        console.warn('Error de permisos geolocation:', e);
      }
    }

    try {
      // Lectura inmediata para obtener la primera posición lo antes posible
      // (no hay que esperar el primer callback del watch)
      try {
        const posicionRapida = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0
        });
        if (posicionRapida?.coords) {
          this.procesarPosicion(posicionRapida.coords as any);
        }
      } catch (e: any) {
        console.warn('Sin lectura inmediata, esperando el watch:', e?.message || e);
      }

      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
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
      this.iniciandoWatch = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private usarGeolocalizacionNavegador() {
    if (!('geolocation' in navigator)) {
      this.manejarErrorGps('El dispositivo no soporta geolocalización.');
      return;
    }

    // Lectura inmediata (fallback web)
    navigator.geolocation.getCurrentPosition(
      (pos) => this.procesarPosicion(pos.coords),
      () => {},
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
    );

    this.webWatchId = navigator.geolocation.watchPosition(
      (pos) => this.procesarPosicion(pos.coords),
      (err) => this.manejarErrorGps(err?.message || 'Error GPS'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  private procesarPosicion(coords: { latitude: number; longitude: number; accuracy?: number; speed?: number | null }) {
    if (this.destruido) return;

    this.ultimaPosicionMs = Date.now();

    this.lat = coords.latitude;
    this.lon = coords.longitude;
    this.precision = Math.round(coords.accuracy || 0);
    this.hora = new Date().toLocaleString('es-CL');
    this.estadoTexto = 'GPS conectado';
    this.errorGps = '';
    this.ubicacionActiva = true;
    this.permisoDenegado = false;
    this.mostrandoUltimaConocida = false;

    if (this.timerLimite) {
      clearTimeout(this.timerLimite);
      this.timerLimite = null;
    }

    this.changeDetectorRef.detectChanges();
    this.renderizarEnMapa(this.lat, this.lon, coords.accuracy || 30);
  }

  /**
   * Programa el techo de 4 s. Si en ese plazo no llego ninguna posicion del
   * GPS, la pantalla se resuelve igual: se muestra la ultima posicion conocida
   * o, si no hay ninguna, un estado claro de "Buscando tu ubicacion".
   */
  private armarLimiteDeteccion() {
    if (this.timerLimite) {
      clearTimeout(this.timerLimite);
    }

    this.timerLimite = setTimeout(() => {
      this.timerLimite = null;
      if (this.destruido || this.ultimaPosicionMs > 0) {
        return;
      }
      this.resolverPrimeraCarga();
    }, this.LIMITE_DETECCION_MS);
  }

  /** Estado definitivo a los 4 s: nunca dejar la pantalla esperando. */
  private resolverPrimeraCarga() {
    // Si el permiso esta denegado no se toca nada: el aviso de permisos es mas
    // util que "Buscando tu ubicacion", y volver a escribirlo lo contradice.
    if (this.permisoDenegado) {
      this.iniciando = false;
      this.changeDetectorRef.detectChanges();
      return;
    }

    const hayPosicion = this.lat != null && this.lon != null;

    this.iniciando = false;
    this.ubicacionActiva = hayPosicion;
    this.mostrandoUltimaConocida = hayPosicion;
    this.estadoTexto = hayPosicion ? 'Última ubicación conocida' : 'Buscando tu ubicación...';
    this.changeDetectorRef.detectChanges();

    if (hayPosicion && this.map) {
      this.renderizarEnMapa(this.lat!, this.lon!, this.precision || 30);
    }
  }

  private manejarErrorGps(mensaje: string) {
    if (this.destruido) return;

    console.warn('GPS error:', mensaje);

    // Si ya hay una posicion en pantalla, un error puntual no debe borrarla:
    // se mantiene la ultima conocida y el GPS sigue buscando en segundo plano.
    const hayPosicion = this.lat != null && this.lon != null;

    this.iniciando = false;
    this.mostrandoUltimaConocida = hayPosicion;
    this.ubicacionActiva = hayPosicion;
    this.errorGps = hayPosicion ? '' : mensaje;
    this.estadoTexto = hayPosicion ? 'Última ubicación conocida' : 'GPS sin señal';

    this.changeDetectorRef.detectChanges();
  }

  /**
   * Revisa cada 10 segundos que esté llegando la posición. Si pasan 25 s sin
   * ninguna, el watcher está muerto (suele pasar al volver de otra app) y se
   * vuelve a registrar para que el GPS en tiempo real nunca se quede pegado.
   */
  private iniciarVigilanciaGps() {
    if (this.timerVigilancia) {
      return;
    }

    this.timerVigilancia = setInterval(() => {
      if (this.destruido || this.iniciandoWatch) {
        return;
      }

      const hayWatch = this.watchId !== null || this.webWatchId != null;
      const sinPosicionDesde = Date.now() - this.ultimaPosicionMs;
      const ahora = Date.now();

      // Solo se reconecta si el GPS ANTES funcionaba y se quedó congelado
      // (típico al volver de Google Maps). Si nunca se ha fijado posición no se
      // toca nada: en interiores el primer fix es lento y reiniciarlo lo impediría.
      const gpsSeCongelo =
        this.ultimaPosicionMs > 0 && sinPosicionDesde > this.LIMITE_SIN_POSICION_MS;
      const yaTocoReintentar = ahora - this.ultimoIntentoMs < this.ESPERA_ENTRE_INTENTOS_MS;

      if (hayWatch && gpsSeCongelo && !yaTocoReintentar) {
        console.warn('[Mi ubicación] GPS sin posiciones, reconectando...');
        this.ultimoIntentoMs = ahora;
        this.reconectarGps();
      }
    }, 10000);
  }

  private reconectarGps() {
    this.ultimoIntentoMs = Date.now();
    this.detenerWatch();
    this.ultimaPosicionMs = 0;

    // Se borra el punto anterior: si no, el mapa seguiría mostrando una posición
    // vieja y daría la impresión de que el GPS ya tiene la ubicación.
    this.lat = null;
    this.lon = null;
    this.precision = 0;
    this.hora = '';
    this.ubicacionActiva = false;
    this.mostrandoUltimaConocida = false;

    this.changeDetectorRef.detectChanges();
    this.iniciarWatch();
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

    // Recordar si el marcador aún no existe (primera fijación)
    const primerFix = !this.marker;

    // Marcador tipo pin de ubicación (morado, igual que el resto de la app)
    const iconoMorado = L.divIcon({
      className: 'mi-ubicacion-marker',
      html: `
        <div class="mi-pin">
          <div class="mi-pin-ring"></div>
          <svg width="40" height="50" viewBox="0 0 40 50">
            <defs>
              <linearGradient id="miPinGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#7715c7"/>
                <stop offset="100%" stop-color="#9c3ded"/>
              </linearGradient>
            </defs>
            <path d="M20 2 C 9 2 2 10 2 20 C 2 32 20 48 20 48 C 20 48 38 32 38 20 C 38 10 31 2 20 2 Z"
                  fill="url(#miPinGrad)" stroke="#ffffff" stroke-width="2"/>
            <circle cx="20" cy="20" r="8" fill="#ffffff"/>
            <circle cx="20" cy="20" r="4" fill="#7715c7"/>
          </svg>
        </div>
      `,
      iconSize: [40, 50],
      iconAnchor: [20, 48]
    });

    if (this.marker) {
      this.marker.setLatLng(coords);
    } else {
      this.marker = L.marker(coords, { icon: iconoMorado }).addTo(this.map);
    }

    if (this.accuracyCircle) {
      this.accuracyCircle.setLatLng(coords);
      this.accuracyCircle.setRadius(precision || 30);
    } else {
      this.accuracyCircle = L.circle(coords, {
        radius: precision || 30,
        color: '#7715c7',
        fillColor: '#9c3ded',
        fillOpacity: 0.2,
        weight: 1.5
      }).addTo(this.map);
    }

    // Centrar solo en la primera lectura o si la posición quedó fuera de la vista,
    // para no pelear con el usuario cuando arrastra o hace zoom del mapa.
    const fueraDeVista = this.map.getBounds().contains(coords) === false;
    if (primerFix || fueraDeVista) {
      // Zoom inicial según la precisión: si es mala, alejar para ver el círculo completo
      const zoom = primerFix ? (precision <= 50 ? 17 : precision <= 200 ? 16 : 15) : 17;
      this.map.setView(coords, zoom);
    }
  }

  centrarMapa() {
    if (this.map && this.lat != null && this.lon != null) {
      this.map.setView([this.lat, this.lon], 18);
    }
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

    // 1. Selector del sistema: la persona elige la app (con su logo) entre
    //    Waze, Google Maps, OpenStreetMap, etc.
    if (await this.abrirEnAppDeMapas(destino)) {
      return;
    }

    // 2. Sin conexión no hay nada que abrir: avisamos y ofrecemos reintentar.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const alert = await this.alertCtrl.create({
        header: 'Sin internet',
        message:
          'No tienes conexión a internet en este momento y tampoco hay una aplicación de mapas instalada en el teléfono.\n\n' +
          'Revisa tus datos o conéctate a un wifi y vuelve a intentarlo.',
        cssClass: 'alerta-elegir-mapa',
        buttons: [
          { text: 'Cerrar', role: 'cancel' },
          {
            text: 'Reintentar',
            handler: () => {
              setTimeout(() => this.irACasa(), 350);
              return true;
            }
          }
        ]
      });
      await alert.present();
      return;
    }

    // 3. Respaldo: la misma ruta en el navegador.
    const url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${this.lat},${this.lon}` +
      `&destination=${encodeURIComponent(destino)}` +
      `&travelmode=driving`;

    if (await this.abrirUrl(url)) {
      return;
    }

    // 4. No hay ninguna app de mapas ni navegador que responda.
    const alert = await this.alertCtrl.create({
      header: 'No se pudo abrir el mapa',
      message:
        'No encontramos una aplicación de mapas en tu teléfono.\n\n' +
        `Puedes pedirle a alguien que te lleve a:\n${destino}`,
      cssClass: 'alerta-elegir-mapa',
      buttons: [
        { text: 'Cerrar', role: 'cancel' },
        {
          text: 'Reintentar',
          handler: () => {
            setTimeout(() => this.irACasa(), 350);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  /**
   * Geocodifica la casa para poder mandar sus coordenadas. Se prueban dos
   * alternativas porque el buscador no siempre entiende calle con número:
   * la dirección completa y, si falla, solo calle + comuna.
   */
  /**
   * Abre el selector del sistema con la DIRECCION en texto, nunca con un punto.
   *
   * OpenStreetMap solo reconoce la calle "Francisco Mattos" sin numeros (es un
   * pasaje), asi que usar sus coordenadas llevaba a Waze o Maps a un tramo sin
   * nombre. Waze y Google Maps si tienen el numero 651, por eso se les deja
   * resolver la direccion completa ellos mismos.
   */
  private async abrirEnAppDeMapas(destino: string): Promise<boolean> {
    const direccion = encodeURIComponent(destino);

    const url = `geo:?q=${direccion}`;
    const wazeUrl = `https://waze.com/ul?q=${direccion}&navigate=yes`;

    return this.abrirUrl(url, {
      titulo: 'Elige con qué aplicación ir a tu casa',
      selector: true,
      wazeUrl
    });
  }

  /**
   * Abre una URL fuera de la app y devuelve true si el sistema realmente pudo
   * abrirla. Antes se usaba window.open a ciegas y, si nadie la abría, el
   * botón quedaba sin hacer nada.
   *
   * - selector true: el plugin nativo muestra el selector del sistema.
   * - sin selector: se usa window.open y se deduce si abrió algo mirando si la
   *   app pasó a segundo plano (si se abre otra app, esto se pausa).
   */
  private async abrirUrl(
    url: string,
    opciones?: { titulo?: string; selector?: boolean; wazeUrl?: string }
  ): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      try {
        return !!window.open(url, '_blank', 'noopener');
      } catch {
        return false;
      }
    }

    // Selector del sistema: la persona elige la aplicación.
    if (opciones?.selector) {
      try {
        const resultado = await AbrirUrl.abrir({
          url,
          wazeUrl: opciones?.wazeUrl,
          titulo: opciones.titulo,
          selector: true
        });
        if (typeof resultado?.abierto === 'boolean') {
          return resultado.abierto;
        }
      } catch {
        // El plugin no está disponible (apk antiguo): se usa el respaldo.
      }
    }

    let abierta = false;
    let escucha: { remove: () => Promise<void> } | null = null;

    try {
      escucha = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          abierta = true;
        }
      });

      window.open(url, '_system');

      // Si en este rato la app no se fue a segundo plano, nadie la abrió.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch {
      abierta = false;
    } finally {
      await escucha?.remove();
    }

    return abierta;
  }

  // =====================================================
  // COMPARTIR MI UBICACIÓN (HOJA DE COMPARTIR DEL TELÉFONO)
  // =====================================================

  async compartirUbicacion() {
    if (!this.ubicacionActiva || this.lat == null || this.lon == null) {
      const alert = await this.alertCtrl.create({
        header: 'Ubicación no activa',
        message:
          'Tu ubicación no está activa o aún no se ha obtenido tu posición.\n\n' +
          'Debes activar los permisos de ubicación del teléfono y tener el GPS encendido para poder compartir tu ubicación.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const url = `https://www.google.com/maps?q=${this.lat},${this.lon}`;
    const mensaje = `Estoy aquí ahora: ${url}`;

    try {
      if (Capacitor.isNativePlatform()) {
        // Hoja de compartir nativa (WhatsApp, SMS, etc.)
        await Share.share({
          title: 'Mi ubicación',
          text: mensaje,
          dialogTitle: 'Compartir mi ubicación'
        });
        return;
      }

      // Web: usar la API de compartir del navegador si existe
      if (navigator.share) {
        await navigator.share({ title: 'Mi ubicación', text: mensaje, url });
        return;
      }
    } catch (e: any) {
      // Si el usuario cierra la hoja de compartir, no es un error real
      if (e?.message?.includes('cancel') || e === undefined) {
        return;
      }
      console.warn('Error al compartir:', e);
    }

    // Último recurso: abrir Google Maps con mi posición
    window.open(url, '_system');
  }
}
import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner,
  IonInput,
  IonSelect,
  IonSelectOption,
  AlertController,
  ToastController
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Geolocation, Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

import {
  ZonaSegura,
  EstadoZonaSegura,
  DireccionZona,
  DireccionSugerida,
  ZonaSeguraService,
  RADIO_POR_DEFECTO
} from '../../services/Backend/zona-segura/zona-segura';
import { Gps, UbicacionInfo } from '../../services/Backend/gps/gps';
import { Vinculacion } from '../../services/Backend/vinculacion/vinculacion';
import { CuidadoresService } from '../../services/Backend/cuidadores/cuidadores';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';
import { PresenciaService, estaEnLinea } from '../../services/Backend/presencia/presencia';
import { EstadoConexionComponent } from '../../components/estado-conexion/estado-conexion.component';

declare const L: any; // Leaflet (cargado globalmente en index.html)

const INTERVALO_CUIDADOR_MS = 30000;

@Component({
  selector: 'app-zona-segura',
  templateUrl: './zona-segura.page.html',
  styleUrls: ['./zona-segura.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonSpinner,
    IonInput,
    IonSelect,
    IonSelectOption,
    CommonModule,
    FormsModule,
    EstadoConexionComponent
  ]
})
export class ZonaSeguraPage implements OnInit, AfterViewInit, OnDestroy {

  // =====================================================
  // ESTADO GENERAL
  // =====================================================

  esCuidador: boolean = false;

  cargando: boolean = true;

  idAdulto: string = '';

  nombreAdulto: string = '';

  direccionPerfil: string = '';

  zonas: ZonaSegura[] = [];

  estado: EstadoZonaSegura | null = null;

  // =====================================================
  // UBICACIÓN
  // =====================================================

  ubicacion: UbicacionInfo | null = null;

  cargandoUbicacion: boolean = false;

  ultimaActualizacion: string = 'Sin datos';

  precisionTexto: string = '-';

  // =====================================================
  // CUIDADOR: ADULTOS A CARGO
  // =====================================================

  adultosACargo: any[] = [];

  adultoSeleccionado: any = null;

  cargandoAdultos: boolean = false;

  /** Último "latido" conocido del adulto (app activa con internet). */
  adultoUltimoVisto: string = '';

  /** true = en línea, false = sin conexión, null = sin datos. */
  adultoEnLinea: boolean | null = null;

  // =====================================================
  // FORMULARIO DE ZONA (HOJA INFERIOR)
  // =====================================================

  modoFormulario: boolean = false;

  editandoId: string | null = null;

  colocandoCentro: boolean = false;

  guardando: boolean = false;

  actualizandoCasa: boolean = false;

  buscandoDireccion: boolean = false;

  sugerencias: DireccionSugerida[] = [];

  cargandoSugerencias: boolean = false;

  busquedaVacia: boolean = false;

  formNombre: string = '';

  formDireccionTexto: string = '';

  formRadio: number = RADIO_POR_DEFECTO;

  formDireccion: DireccionZona = { texto: '', region: '', comuna: '', calle: '', numero: '' };

  pendienteLat: number | null = null;

  pendienteLng: number | null = null;

  // =====================================================
  // MAPA (LEAFLET)
  // =====================================================

  private map: any = null;

  private markerPersona: any = null;

  private circuloPrecision: any = null;

  private capasZonas: any[] = [];

  private capaNueva: any = null;

  private markerNuevo: any = null;

  private watchId: string | null = null;

  @ViewChild(IonContent) contenido?: IonContent;

  /** Contenedor del mapa de ESTA instancia (evita chocar con otras páginas). */
  @ViewChild('mapaZona', { static: true }) mapaEl?: ElementRef<HTMLDivElement>;

  /** Motivo por el que el mapa no arrancó; se muestra sobre el área del mapa. */
  mapaFallo: string = '';

  private webWatchId: number | null = null;

  private timerCuidador: any = null;

  private timerSugerencias: any = null;

  private timerDirecciones: any = null;

  private observerTamano: ResizeObserver | null = null;

  private destruido: boolean = false;

  private inicializado: boolean = false;

  private estadoPrevioDentro: boolean | null = null;

  /** Direcciones calculadas para zonas guardadas sin dirección de texto. */
  private direccionesCalculadas = new Map<string, string>();

  private resolviendoDirecciones: boolean = false;

  private presenciaService = inject(PresenciaService);

  constructor(
    private zonaService: ZonaSeguraService,
    private gpsService: Gps,
    private vinculacionService: Vinculacion,
    private cuidadoresService: CuidadoresService,
    private navRol: NavegacionRolService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
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
    const rol = await this.navRol.obtenerRol();
    this.esCuidador = rol === 'Familiar';

    if (this.esCuidador) {
      await this.cargarAdultos();
    } else {
      const usuario = await this.cuidadoresService.cargarUsuario();
      this.idAdulto = usuario?.id || '';
      this.nombreAdulto = usuario
        ? `${usuario.nombre || ''} ${usuario.apellidopa || ''} ${usuario.apellidoma || ''}`.trim()
        : 'Tú';

      // Zona predeterminada: la dirección de casa guardada en el perfil (tabla direccion)
      await this.prepararZonaCasa();
    }

    await this.cargarZonas();

    this.cargando = false;
    this.changeDetectorRef.detectChanges();

    if (this.esCuidador) {
      this.iniciarVigilanciaCuidador();
    } else {
      this.iniciarWatch();
    }

    this.inicializado = true;
  }

  async ionViewWillEnter() {
    // Refresca el menú de personas a cargo: alguien puede haber sido
    // desvinculado mientras la página permanecía en el historial de navegación.
    if (!this.inicializado || !this.esCuidador || this.cargandoAdultos) {
      return;
    }

    await this.cargarAdultos();
  }

  ngAfterViewInit() {
    void this.arrancarMapa();
  }

  ngOnDestroy() {
    this.destruido = true;
    this.detenerWatch();
    if (this.timerSugerencias) {
      clearTimeout(this.timerSugerencias);
      this.timerSugerencias = null;
    }
    if (this.timerDirecciones) {
      clearTimeout(this.timerDirecciones);
      this.timerDirecciones = null;
    }
    if (this.observerTamano) {
      this.observerTamano.disconnect();
      this.observerTamano = null;
    }
    if (this.timerCuidador) {
      clearInterval(this.timerCuidador);
      this.timerCuidador = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }

  // =====================================================
  // ZONA DE CASA (DIRECCIÓN DEL PERFIL - TABLA direccion)
  // =====================================================

  /**
   * Guarda la dirección del perfil y crea la zona "Mi casa" si todavía no hay zonas.
   */
  private async prepararZonaCasa() {
    if (!this.idAdulto) return;

    try {
      const dir = await this.zonaService.obtenerDireccionUsuario(this.idAdulto);
      this.direccionPerfil = dir && dir.calle.trim()
        ? this.zonaService.formatearDireccion(dir)
        : '';
    } catch {
      this.direccionPerfil = '';
    }

    try {
      await this.zonaService.asegurarZonaInicial(this.idAdulto);
    } catch {
      /* sin zona inicial: se podrá crear manualmente */
    }

    this.changeDetectorRef.detectChanges();
  }

  // =====================================================
  // CARGA DE ZONAS
  // =====================================================

  async cargarZonas() {
    if (!this.idAdulto) {
      this.zonas = [];
      return;
    }

    const zonas = await this.zonaService.obtenerZonas(this.idAdulto);
    this.zonas = zonas;
    this.pintarZonas();

    // Si los datos llegaron DESPUÉS de iniciar el mapa, la vista aterriza de una
    // vez sobre las zonas (sin animación: se pide un solo lote de tiles).
    if (this.map) this.ajustarVista();

    this.changeDetectorRef.detectChanges();
    this.programarDireccionesZonas();
  }

  /**
   * Retrasa el reverse-geocoding de las zonas para que no compita con la
   * descarga inicial de los tiles del mapa (es texto cosmético de la lista).
   */
  private programarDireccionesZonas() {
    if (this.timerDirecciones) return;

    this.timerDirecciones = setTimeout(() => {
      this.timerDirecciones = null;
      void this.resolverDireccionesZonas();
    }, 1200);
  }

  /**
   * Calcula la dirección de las zonas guardadas sin texto de dirección,
   * para que en la lista y en el popup se vea la calle (ej: "Roberto Pérez 400")
   * y no las coordenadas numéricas.
   */
  private async resolverDireccionesZonas() {
    const pendientes = this.zonas.filter(
      (z) => !z.direccion_texto && !this.direccionesCalculadas.has(z.id)
    );

    if (pendientes.length === 0 || this.resolviendoDirecciones) return;

    this.resolviendoDirecciones = true;

    try {
      for (const zona of pendientes) {
        if (this.destruido) return;

        const dir = await this.zonaService.reverseGeocodificar(
          zona.latitud_centro,
          zona.longitud_centro
        );
        if (this.destruido) return;

        if (dir.calle || dir.comuna) this.direccionesCalculadas.set(zona.id, dir.texto);

        this.pintarZonas();
        this.changeDetectorRef.detectChanges();

        // Pausa para no saturar el servicio de geocodificación
        await new Promise((resolver) => setTimeout(resolver, 600));
      }
    } finally {
      this.resolviendoDirecciones = false;
    }
  }

  async cargarAdultos() {
    this.cargandoAdultos = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();

      if (this.adultosACargo.length > 0) {
        const idParam = this.route.snapshot.queryParamMap.get('id');
        const encontrado = idParam
          ? this.adultosACargo.find(
              (a) => a.id === idParam || a.id_usuario === idParam || a.adulto_mayor?.id === idParam
            )
          : null;

        this.adultoSeleccionado = encontrado || this.adultosACargo[0];
        this.aplicarAdultoSeleccionado();
        this.sembrarEstadoConexion();
        void this.refrescarEstadoConexion();
        await this.prepararZonaCasa();
      } else {
        // Ya no hay nadie a cargo: limpiar la selección para no conservar
        // restos de una persona desvinculada.
        this.adultoSeleccionado = null;
        this.aplicarAdultoSeleccionado();
      }
    } catch (e) {
      console.error('Error cargando adultos a cargo:', e);
    } finally {
      this.cargandoAdultos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  aplicarAdultoSeleccionado() {
    const adulto = this.adultoSeleccionado;
    this.idAdulto = adulto?.adulto_mayor?.id || adulto?.id_usuario || '';
    const datos = adulto?.adulto_mayor;
    this.nombreAdulto = datos
      ? `${datos.nombre || ''} ${datos.apellidopa || ''} ${datos.apellidoma || ''}`.trim()
      : 'Adulto mayor';
  }

  async onAdultoChange(event: any) {
    const id = event.detail.value;
    const encontrado = this.adultosACargo.find(
      (a) => a.id === id || a.id_usuario === id || a.adulto_mayor?.id === id
    );
    if (!encontrado) return;

    this.adultoSeleccionado = encontrado;
    this.aplicarAdultoSeleccionado();
    this.estado = null;
    this.ubicacion = null;
    this.estadoPrevioDentro = null;
    this.sembrarEstadoConexion();
    void this.refrescarEstadoConexion();
    await this.prepararZonaCasa();
    this.cargarZonas();
    this.actualizarUbicacionAdulto(true);
    this.changeDetectorRef.detectChanges();
  }

  // =====================================================
  // ESTADO EN LÍNEA / SIN CONEXIÓN DEL ADULTO
  // =====================================================

  /** Toma el último visto que trajo la lista de adultos. */
  private sembrarEstadoConexion() {
    const visto = this.adultoSeleccionado?.adulto_mayor?.ultimo_visto || '';
    if (visto) this.adultoUltimoVisto = visto;
    this.calcularConexion();
  }

  /** Pide el último "latido" fresco de la persona (se repite con la vigilancia). */
  private async refrescarEstadoConexion() {
    if (!this.esCuidador || !this.idAdulto || this.destruido) return;

    const visto = await this.presenciaService.obtenerUltimoVisto(this.idAdulto);
    if (visto) this.adultoUltimoVisto = visto;
    this.calcularConexion();
    this.changeDetectorRef.detectChanges();
  }

  private calcularConexion() {
    // Evidencia 1: latido de la app (usuario.ultimo_visto).
    const porLatido = estaEnLinea(this.adultoUltimoVisto);

    // Evidencia 2: una ubicación enviada hace poco también sólo es posible
    // con internet (cubre a la app en segundo plano sin latido reciente).
    const origen = this.ubicacion?.origen;
    const reporteReciente =
      (origen === 'bd' || origen === 'cache') && estaEnLinea(this.ubicacion?.fecha);

    this.adultoEnLinea = reporteReciente === true ? true : porLatido;
  }

  get textoConexion(): string {
    if (this.adultoEnLinea === true) return 'En línea';

    const visto = this.adultoUltimoVisto;
    if (!visto) return 'Sin conexión';

    const fecha = new Date(visto);
    const edad = Date.now() - fecha.getTime();

    if (!isNaN(edad) && edad >= 0 && edad < 60 * 60 * 1000) {
      const minutos = Math.max(1, Math.round(edad / 60000));
      return `Sin conexión · hace ${minutos} min`;
    }

    const hora = fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    return `Sin conexión · última vez ${hora}`;
  }

  get nombreParaMostrar(): string {
    if (this.esCuidador) return this.nombreAdulto || 'Adulto mayor';
    return this.nombreAdulto || 'Tú';
  }

  /** Selector "Cuidando a" (sólo cuidador con más de un adulto a cargo). */
  get mostrarSelectorAdultos(): boolean {
    return this.esCuidador && this.adultosACargo.length > 1;
  }

  /** Fila superior: selector del adulto y/o botón de añadir zona segura. */
  get mostrarFilaSuperior(): boolean {
    return this.mostrarSelectorAdultos || (!this.modoFormulario && !this.cargando);
  }

  // =====================================================
  // UBICACIÓN DEL ADULTO (VISTA DEL CUIDADOR)
  // =====================================================

  private iniciarVigilanciaCuidador() {
    if (!this.idAdulto) return;
    this.actualizarUbicacionAdulto(true);
    this.timerCuidador = setInterval(() => {
      this.actualizarUbicacionAdulto(false);
    }, INTERVALO_CUIDADOR_MS);
  }

  async actualizarUbicacionAdulto(centrar: boolean) {
    if (!this.idAdulto || this.destruido) return;

    void this.refrescarEstadoConexion();

    this.cargandoUbicacion = true;
    this.changeDetectorRef.detectChanges();

    try {
      const direccionFallback = await this.zonaService.obtenerDireccionUsuario(this.idAdulto);
      const info = await this.gpsService.obtenerUbicacionAdulto(this.idAdulto, direccionFallback);

      // Sólo la ubicación real del adulto (BD o su último dato guardado) mueve
      // el puntero y evalúa las zonas. La dirección de casa o el GPS de ESTE
      // dispositivo no dicen dónde está él: se ignoran y se conserva la última
      // ubicación real conocida (también cuando no hay internet).
      const esReal = !info.origen || info.origen === 'bd' || info.origen === 'cache';

      if (esReal) {
        this.ubicacion = info;
        this.calcularConexion();
        this.ultimaActualizacion = new Date(info.fecha || Date.now()).toLocaleTimeString('es-CL', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        this.precisionTexto = `${Math.round(info.precision || 0)} m`;

        await this.evaluarPosicion(false);
        this.pintarPersona();

        if (centrar && this.map) {
          this.map.setView([info.latitud, info.longitud], 17);
        }
      }
    } catch (e) {
      // Sin internet o sin datos: queda la última ubicación que se tenía
      console.error('Error actualizando ubicación del adulto:', e);
    } finally {
      this.cargandoUbicacion = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // =====================================================
  // UBICACIÓN EN VIVO (DISPOSITIVO DEL ADULTO MAYOR)
  // =====================================================

  private async iniciarWatch() {
    if (Capacitor.isNativePlatform()) {
      try {
        const permiso = await Geolocation.checkPermissions();
        if (permiso.location !== 'granted') {
          const pedido = await Geolocation.requestPermissions();
          if (pedido.location !== 'granted') {
            this.ultimaActualizacion = 'Permiso de ubicación denegado';
            this.changeDetectorRef.detectChanges();
            return;
          }
        }
      } catch (e) {
        console.warn('Error de permisos geolocation:', e);
      }
    }

    try {
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
          if (err) return;
          if (pos) this.procesarPosicion(pos.coords as any);
        }
      );
    } catch (e: any) {
      this.usarGeolocalizacionNavegador();
    }
  }

  private usarGeolocalizacionNavegador() {
    if (!('geolocation' in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => this.procesarPosicion(pos.coords),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );

    this.webWatchId = navigator.geolocation.watchPosition(
      (pos) => this.procesarPosicion(pos.coords),
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  private procesarPosicion(coords: { latitude: number; longitude: number; accuracy?: number }) {
    if (this.destruido) return;

    this.ubicacion = {
      latitud: coords.latitude,
      longitud: coords.longitude,
      precision: Math.round(coords.accuracy || 0),
      fecha: new Date().toISOString(),
      enLinea: true
    };

    this.ultimaActualizacion = new Date().toLocaleTimeString('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    this.precisionTexto = `${Math.round(coords.accuracy || 0)} m`;

    this.pintarPersona();
    this.evaluarPosicion(true);
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
  // EVALUACIÓN DE ZONAS
  // =====================================================

  private async evaluarPosicion(notificar: boolean) {
    if (!this.idAdulto || !this.ubicacion) return;

    const antesDentro = this.estadoPrevioDentro;

    let estado: EstadoZonaSegura | null = null;

    if (notificar) {
      estado = await this.zonaService.evaluarYNotificar(
        this.idAdulto,
        this.ubicacion.latitud,
        this.ubicacion.longitud
      );
    } else {
      const zonas = await this.zonaService.obtenerZonas(this.idAdulto);
      estado = zonas.length
        ? this.zonaService.evaluar(zonas, this.ubicacion.latitud, this.ubicacion.longitud)
        : null;
    }

    this.estado = estado;
    this.estadoPrevioDentro = estado ? estado.dentro : null;

    this.pintarZonas();
    this.changeDetectorRef.detectChanges();

    // El aviso en pantalla SÓLO lo muestra el dispositivo del adulto con su
    // GPS real: en la vista del cuidador (o con ubicaciones de respaldo) el
    // mapa se actualiza sin ventanas ni sonidos molestos.
    if (notificar && estado && !estado.dentro && antesDentro !== false) {
      if (this.zonaService.puedeAlertar(this.idAdulto)) {
        this.zonaService.registrarAlerta(this.idAdulto);
        this.mostrarAlertaFueraDeZona(estado);
      }
    }
  }

  private async mostrarAlertaFueraDeZona(estado: EstadoZonaSegura) {
    const zona = estado.zonaCercana;
    const mensaje = zona
      ? `${this.nombreParaMostrar} está fuera de la zona segura ` +
        `"${zona.nombre || zona.direccion_texto || 'sin nombre'}", ` +
        `a ${Math.round(estado.distancia)} m del centro.`
      : `${this.nombreParaMostrar} está fuera de todas las zonas seguras.`;

    const alert = await this.alertCtrl.create({
      header: 'Fuera de zona segura',
      message: mensaje,
      buttons: ['OK']
    });
    await alert.present();
  }

  // =====================================================
  // TEXTOS DE ESTADO
  // =====================================================

  get textoEstado(): string {
    if (!this.idAdulto) return 'Selecciona un adulto mayor para ver sus zonas seguras.';
    if (!this.estado) {
      return this.zonas.length === 0
        ? 'Todavía no hay zonas seguras. Añade la primera.'
        : 'Calculando estado…';
    }
    if (!this.estado.tieneZonas) return 'Todavía no hay zonas seguras. Añade la primera.';

    if (this.estado.dentro) {
      const zona = this.estado.zonaDentro;
      return `Dentro de zona segura: ${this.tituloZona(zona)} (${Math.round(this.estado.distancia)} m del centro)`;
    }

    const cerca = this.estado.zonaCercana;
    return cerca
      ? `Fuera de zona segura. Lo más cerca está a ${Math.round(this.estado.distancia)} m de ${this.tituloZona(cerca)}.`
      : 'Fuera de zona segura.';
  }

  get subtituloEstado(): string {
    if (!this.ubicacion) return 'Esperando ubicación...';

    // Si el dato es viejo (p. ej. sin internet), se dice con claridad en vez
    // de mostrarlo como si estuviera fresco.
    const edad = Date.now() - new Date(this.ubicacion.fecha).getTime();
    if (!isNaN(edad) && edad > 5 * 60 * 1000) {
      const texto = edad < 60 * 60 * 1000
        ? `hace ${Math.floor(edad / 60000)} min`
        : 'hace más de 1 h';
      return `Última ubicación a las ${this.ultimaActualizacion} (${texto})`;
    }

    return `Ubicación actualizada a las ${this.ultimaActualizacion} · precisión ${this.precisionTexto}`;
  }

  /** Texto del badge flotante del mapa (como en Mi Ubicación). */
  get textoBadgeMapa(): string {
    if (!this.ubicacion) return 'Esperando ubicación...';
    if (this.esCuidador) return `Ubicación de ${this.nombreParaMostrar}`;
    return 'GPS conectado';
  }

  get estadoClase(): string {
    if (!this.estado || !this.estado.tieneZonas) return 'neutro';
    return this.estado.dentro ? 'dentro' : 'fuera';
  }

  get estadoIcono(): string {
    if (!this.estado || !this.estado.tieneZonas) return 'shield-outline';
    return this.estado.dentro ? 'shield-checkmark' : 'alert-circle';
  }

  tituloZona(zona: ZonaSegura | null): string {
    if (!zona) return 'zona segura';
    return zona.nombre || zona.direccion_texto || 'Zona segura';
  }

  /** Dirección de la zona: la guardada o la calculada. Nunca coordenadas numéricas. */
  direccionZona(zona: ZonaSegura): string {
    if (zona.direccion_texto) return zona.direccion_texto;
    return this.direccionesCalculadas.get(zona.id) || '';
  }

  /** Igual que direccionZona, con texto de espera para la vista. */
  etiquetaDireccionZona(zona: ZonaSegura): string {
    return this.direccionZona(zona) || 'Calculando dirección…';
  }

  distanciaA(zona: ZonaSegura): string {
    if (!this.ubicacion) return '';
    const d = this.zonaService.distanciaMetros(
      this.ubicacion.latitud,
      this.ubicacion.longitud,
      zona.latitud_centro,
      zona.longitud_centro
    );
    return d <= zona.radio_metros
      ? `${Math.round(d)} m · dentro`
      : `${Math.round(d)} m · fuera`;
  }

  esZonaActiva(zona: ZonaSegura): boolean {
    return !!this.estado && this.estado.dentro && this.estado.zonaDentro?.id === zona.id;
  }

  // =====================================================
  // MAPA
  // =====================================================

  /** Espera corta (máx. 800 ms) a zonas/ubicación para centrar bien desde el
   *  primer tile; si no llegan, se arranca con el centro por defecto. */
  private async esperarDatosIniciales(): Promise<void> {
    const inicio = Date.now();

    while (!this.destruido && !this.map && Date.now() - inicio < 800) {
      if (!this.cargando || this.ubicacion || this.zonas.length > 0) return;
      await new Promise<void>((resolver) => setTimeout(resolver, 80));
    }
  }

  /**
   * Arranca el mapa reintentando unas veces: el contenedor puede tardar en
   * estar listo. Si nunca arranca, queda el aviso visible sobre el área del mapa.
   */
  private async arrancarMapa(intento = 0): Promise<void> {
    if (this.destruido || this.map) return;

    // Igual que "mi ubicación": si los datos ya llegaron, el mapa nace centrado
    // donde tiene que estar y pide UN solo lote de tiles (sin saltos ni refetch).
    if (intento === 0) await this.esperarDatosIniciales();
    if (this.destruido || this.map) return;

    const ok = await this.inicializarMapa();

    if (ok) {
      this.pintarTodo();
      this.changeDetectorRef.detectChanges();
      return;
    }

    if (intento >= 4) {
      if (!this.mapaFallo) {
        this.mapaFallo = 'No se pudo cargar el mapa. Revisa tu conexión a internet.';
      }
      this.changeDetectorRef.detectChanges();
      return;
    }

    setTimeout(() => {
      if (!this.destruido && !this.map) void this.arrancarMapa(intento + 1);
    }, 800);
  }

  /** Si el CDN de unpkg no cargó Leaflet, se intenta de nuevo con jsDelivr. */
  private async asegurarLeaflet(): Promise<boolean> {
    if (typeof L !== 'undefined') return true;

    if (!document.querySelector('link[href*="leaflet"]')) {
      const hoja = document.createElement('link');
      hoja.rel = 'stylesheet';
      hoja.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(hoja);
    }

    await new Promise<void>((resolver) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = () => resolver();
      script.onerror = () => resolver();
      document.head.appendChild(script);
      setTimeout(resolver, 6000);
    });

    return typeof L !== 'undefined';
  }

  private async inicializarMapa(): Promise<boolean> {
    // Se usa el elemento de ESTA página (no document.getElementById, que puede
    // tomar el de otra página apilada en el navegador).
    const container: HTMLElement | null =
      this.mapaEl?.nativeElement || document.getElementById('mapaZona');

    if (!container) {
      this.mapaFallo = 'No se encontró el contenedor del mapa.';
      return false;
    }

    if (typeof L === 'undefined' && !(await this.asegurarLeaflet())) {
      this.mapaFallo = 'No se pudo cargar Leaflet. Revisa tu conexión a internet.';
      return false;
    }

    if (this.map) return true;

    try {
      // Prioridad de centro: ubicación conocida → primera zona → por defecto.
      const primeraZona = this.zonas[0];
      const lat = this.ubicacion?.latitud ?? primeraZona?.latitud_centro ?? -33.4489;
      const lng = this.ubicacion?.longitud ?? primeraZona?.longitud_centro ?? -70.6693;
      // Zoom 16 = el mismo al que ajustarVista() lleva una sola zona: evita refetch.
      const zoom = this.ubicacion || this.zonas.length > 0 ? 16 : 15;

      this.map = L.map(container, { center: [lat, lng], zoom, zoomControl: false });

      // Host único (HTTP/2) en vez de subdominios {s}: menos conexiones
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // Durante flyTo/zoom animado NO pedir tiles de zooms intermedios:
        // sólo se descarga el nivel final (menos viajes, vista estable).
        updateWhenZooming: false,
        attribution: 'OpenStreetMap contributors'
      }).addTo(this.map);

      L.control.zoom({ position: 'topright' }).addTo(this.map);

      this.map.on('click', (e: any) => this.onMapClick(e));

      this.mapaFallo = '';
      this.programarAjusteDeTamano();
      return true;
    } catch (e) {
      console.error('Error inicializando mapa de zonas seguras:', e);
      this.mapaFallo = 'No se pudo iniciar el mapa.';
      return false;
    }
  }

  /**
   * Garantiza que Leaflet vea el tamaño final del contenedor:
   *  - tras la animación de entrada de Ionic (invalidateSize diferido)
   *  - cada vez que el contenedor cambie (hoja del formulario, cambios de layout)
   */
  private programarAjusteDeTamano() {
    const contenedor = this.mapaEl?.nativeElement;
    if (!contenedor) return;

    const ajustar = () => {
      if (this.destruido || !this.map) return;
      try {
        this.map.invalidateSize({ animate: false });
      } catch {
        /* el mapa aún no está listo */
      }
    };

    // La transición de entrada de Ionic termina ~350-500 ms tras crear la vista.
    setTimeout(ajustar, 400);

    if (typeof ResizeObserver !== 'undefined' && !this.observerTamano) {
      this.observerTamano = new ResizeObserver(() => ajustar());
      this.observerTamano.observe(contenedor);
    }
  }

  private pintarTodo() {
    this.pintarZonas();
    this.pintarPersona();
    this.pintarPrevisualizacion();
    this.ajustarVista();
  }

  private pintarZonas() {
    if (!this.map || typeof L === 'undefined') return;

    for (const capa of this.capasZonas) {
      try { capa.remove(); } catch { /* ya removida */ }
    }
    this.capasZonas = [];

    for (const zona of this.zonas) {
      const coords: [number, number] = [zona.latitud_centro, zona.longitud_centro];

      let color = '#7715c7';
      let relleno = '#9c3ded';

      if (this.estado && this.estado.tieneZonas) {
        if (this.estado.dentro && this.estado.zonaDentro?.id === zona.id) {
          color = '#2e7d32';
          relleno = '#4caf50';
        } else if (!this.estado.dentro) {
          color = '#c62828';
          relleno = '#e53935';
        }
      }

      const circulo = L.circle(coords, {
        radius: zona.radio_metros,
        color,
        fillColor: relleno,
        fillOpacity: 0.16,
        weight: 2
      }).addTo(this.map);

      circulo.bindPopup(`
        <div style="text-align:center; padding:4px; max-width:200px;">
          <strong style="color:${color}; display:block; margin-bottom:4px;">${this.tituloZona(zona)}</strong>
          <span style="font-size:12px; color:#555;">${this.etiquetaDireccionZona(zona)}</span>
          <div style="margin-top:6px; font-size:11px; color:#333; font-weight:bold;">
            Radio: ${zona.radio_metros} m
          </div>
        </div>
      `);

      this.capasZonas.push(circulo);
    }
  }

  private pintarPersona() {
    if (!this.map || typeof L === 'undefined' || !this.ubicacion) return;

    const coords: [number, number] = [this.ubicacion.latitud, this.ubicacion.longitud];
    const primerFix = !this.markerPersona;

    if (!this.markerPersona) {
      const icono = L.divIcon({
        className: 'zona-persona-marker',
        html: `
          <div class="zona-pin">
            <div class="zona-pin-ring"></div>
            <svg width="40" height="50" viewBox="0 0 40 50">
              <defs>
                <linearGradient id="zonaPinGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#7715c7"/>
                  <stop offset="100%" stop-color="#9c3ded"/>
                </linearGradient>
              </defs>
              <path d="M20 2 C 9 2 2 10 2 20 C 2 32 20 48 20 48 C 20 48 38 32 38 20 C 38 10 31 2 20 2 Z"
                    fill="url(#zonaPinGrad)" stroke="#ffffff" stroke-width="2"/>
              <circle cx="20" cy="20" r="8" fill="#ffffff"/>
              <circle cx="20" cy="20" r="4" fill="#7715c7"/>
            </svg>
          </div>`,
        iconSize: [40, 50],
        iconAnchor: [20, 48]
      });

      this.markerPersona = L.marker(coords, { icon: icono }).addTo(this.map);
      this.markerPersona.bindPopup(`
        <div style="text-align:center; padding:4px;">
          <strong style="color:#7715c7;">${this.nombreParaMostrar}</strong>
          <div style="font-size:12px; color:#555;">${this.ultimaActualizacion}</div>
        </div>
      `);
    } else {
      this.markerPersona.setLatLng(coords);
    }

    const precision = this.ubicacion?.precision || 30;
    if (!this.circuloPrecision) {
      this.circuloPrecision = L.circle(coords, {
        radius: precision,
        color: '#7715c7',
        fillColor: '#9c3ded',
        fillOpacity: 0.12,
        weight: 1
      }).addTo(this.map);
    } else {
      this.circuloPrecision.setLatLng(coords);
      this.circuloPrecision.setRadius(precision);
    }

    // Como en "Mi Ubicación": centrar en la primera lectura o si el puntero
    // quedó fuera de la vista. Nunca mientras se está editando una zona.
    if (!this.modoFormulario) {
      let fueraDeVista = true;
      try {
        fueraDeVista = this.map.getBounds().contains(coords) === false;
      } catch {
        fueraDeVista = true;
      }

      if (primerFix || fueraDeVista) {
        const zoom = primerFix
          ? precision <= 50
            ? 17
            : precision <= 200
              ? 16
              : 15
          : Math.max(this.map.getZoom(), 15);

        this.map.setView(coords, zoom);
      }
    }
  }

  private ajustarVista() {
    if (!this.map || typeof L === 'undefined') return;

    const puntos: [number, number][] = this.zonas.map((z) => [z.latitud_centro, z.longitud_centro]);
    if (this.ubicacion) puntos.push([this.ubicacion.latitud, this.ubicacion.longitud]);
    if (this.pendienteLat !== null && this.pendienteLng !== null) {
      puntos.push([this.pendienteLat, this.pendienteLng]);
    }

    if (puntos.length === 0) return;

    if (puntos.length === 1) {
      this.map.setView(puntos[0], 16);
      return;
    }

    try {
      // animate:false → salto directo: sólo se piden los tiles del destino final.
      this.map.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 16, animate: false });
    } catch { /* vista por defecto */ }
  }

  centrarEnPersona() {
    if (!this.map || !this.ubicacion) return;
    this.map.setView([this.ubicacion.latitud, this.ubicacion.longitud], 17);
  }

  // =====================================================
  // ALTA / EDICION DE ZONAS
  // =====================================================

  async iniciarNuevaZona() {
    if (!this.idAdulto) {
      await this.toast('No se pudo identificar a la persona. Cierra la pantalla y vuelve a entrar.');
      return;
    }

    (document.activeElement as HTMLElement)?.blur();

    this.editandoId = null;
    this.formNombre = '';
    this.formRadio = RADIO_POR_DEFECTO;
    this.formDireccion = { texto: '', region: '', comuna: '', calle: '', numero: '' };
    this.formDireccionTexto = '';
    this.sugerencias = [];
    this.pendienteLat = null;
    this.pendienteLng = null;
    this.colocandoCentro = false;
    this.modoFormulario = true;
    this.limpiarPrevisualizacion();
    this.mostrarMapaVisible();
    this.changeDetectorRef.detectChanges();
    this.refrescarMapa();

    // Siempre queda un puntero visible (y el centro listo para guardar)
    await this.colocarCentroInicial();
  }

  /**
   * Coloca el centro en un punto conocido: la ubicación actual, la dirección
   * del perfil o la primera zona. Así el mapa nunca queda sin puntero.
   */
  private async colocarCentroInicial() {
    try {
      if (this.ubicacion) {
        await this.fijarCentro(this.ubicacion.latitud, this.ubicacion.longitud, true, true);
        this.volarA(this.ubicacion.latitud, this.ubicacion.longitud);
        return;
      }

      if (this.direccionPerfil) {
        this.formDireccionTexto = this.direccionPerfil;
        await this.buscarDireccion(true);
        return;
      }

      if (this.zonas.length > 0) {
        const zona = this.zonas[0];
        await this.fijarCentro(zona.latitud_centro, zona.longitud_centro, true, true);
        this.volarA(zona.latitud_centro, zona.longitud_centro);
      }
    } catch (e) {
      console.warn('No se pudo colocar el centro inicial de la zona:', e);
    }
  }

  /** Leaflet necesita saber el nuevo tamaño cuando se abre/cierra la hoja. */
  private refrescarMapa() {
    setTimeout(async () => {
      if (this.destruido) return;

      // Si el mapa no había arrancado, se aprovecha para iniciarlo ya con su tamaño
      if (!this.map) {
        await this.inicializarMapa();
        if (this.map) this.pintarTodo();
      }

      if (!this.map) return;

      try {
        this.map.invalidateSize({ animate: false });
      } catch {
        /* el mapa aún no está listo */
      }
      this.changeDetectorRef.detectChanges();
    }, 150);
  }

  editarZona(zona: ZonaSegura) {
    (document.activeElement as HTMLElement)?.blur();

    this.editandoId = zona.id;
    this.formNombre = zona.nombre;
    this.formRadio = zona.radio_metros;
    this.formDireccionTexto = zona.direccion_texto || this.direccionZona(zona);
    this.formDireccion = {
      texto: zona.direccion_texto,
      region: zona.region,
      comuna: zona.comuna,
      calle: zona.calle,
      numero: zona.numero
    };
    this.pendienteLat = zona.latitud_centro;
    this.pendienteLng = zona.longitud_centro;
    this.colocandoCentro = true;
    this.modoFormulario = true;
    this.sugerencias = [];

    this.fijarCentro(zona.latitud_centro, zona.longitud_centro, !zona.direccion_texto);
    this.volarA(zona.latitud_centro, zona.longitud_centro);
    this.mostrarMapaVisible();
    this.refrescarMapa();
    this.changeDetectorRef.detectChanges();
  }

  cancelarFormulario() {
    this.modoFormulario = false;
    this.colocandoCentro = false;
    this.sugerencias = [];
    this.limpiarPrevisualizacion();
    this.changeDetectorRef.detectChanges();
    this.refrescarMapa();
  }

  private onMapClick(event: any) {
    this.sugerencias = [];
    if (!this.modoFormulario) return;
    const { lat, lng } = event.latlng;
    this.fijarCentro(lat, lng, true);
  }

  /**
   * Sube el contenido al inicio para que el mapa quede visible
   * por encima de la hoja del formulario (estilo Google Maps).
   */
  private mostrarMapaVisible() {
    try {
      this.contenido?.scrollToTop(300);
    } catch {
      /* sin contenido scrolleable */
    }
  }

  private async fijarCentro(
    lat: number,
    lng: number,
    geocodificar: boolean,
    soloSiNoEscribio = false
  ) {
    this.pendienteLat = lat;
    this.pendienteLng = lng;
    this.colocandoCentro = true;

    const textoAntes = this.formDireccionTexto;

    this.pintarPrevisualizacion();
    this.changeDetectorRef.detectChanges();

    if (geocodificar) {
      const direccion = await this.zonaService.reverseGeocodificar(lat, lng);
      if (this.destruido) return;

      // Si mientras se geocodificaba la persona escribió otra dirección, se respeta
      if (soloSiNoEscribio && this.formDireccionTexto !== textoAntes) return;

      this.formDireccion = direccion;
      this.formDireccionTexto = direccion.texto;
      if (!this.formNombre) {
        this.formNombre = direccion.calle
          ? `${direccion.calle}${direccion.numero ? ' ' + direccion.numero : ''}`
          : direccion.texto.slice(0, 60);
      }
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Busca la dirección escrita por pantalla y lleva el mapa hasta allí.
   * Si la dirección es exacta, la zona queda lista para guardar;
   * si no, se puede corregir tocando el mapa.
   */
  async buscarDireccion(silencioso: boolean = false) {
    const texto = (this.formDireccionTexto || '').trim();

    if (!texto) {
      if (!silencioso) await this.toast('Escribe una dirección para buscarla en el mapa.');
      return false;
    }

    // Si ya hay sugerencias en pantalla, el botón/Enter elige la primera
    if (!silencioso && this.sugerencias.length > 0) {
      await this.seleccionarSugerencia(this.sugerencias[0]);
      return true;
    }

    if (this.buscandoDireccion) return false;

    (document.activeElement as HTMLElement)?.blur();

    this.buscandoDireccion = true;
    this.changeDetectorRef.detectChanges();

    try {
      const coords = await this.zonaService.geocodificar(texto);

      if (!coords) {
        if (!silencioso) {
          await this.toast('No se encontró esa dirección. Revisa el texto o toca el mapa.');
        }
        return false;
      }

      if (this.destruido) return false;

      this.pendienteLat = coords.latitud;
      this.pendienteLng = coords.longitud;
      this.pintarPrevisualizacion();
      this.volarA(coords.latitud, coords.longitud);

      const rev = await this.zonaService.reverseGeocodificar(coords.latitud, coords.longitud);
      if (this.destruido) return false;

      // Se conserva el texto escrito por la persona y se completan los datos de la dirección
      this.formDireccion = { ...rev, texto };
      if (!this.formNombre) {
        this.formNombre = rev.calle
          ? `${rev.calle}${rev.numero ? ' ' + rev.numero : ''}`
          : texto.slice(0, 60);
      }

      this.colocandoCentro = true;

      if (!silencioso) {
        await this.toast('Dirección ubicada en el mapa. Tócala si necesitas ajustar el centro.');
      }

      this.changeDetectorRef.detectChanges();
      return true;
    } catch (e) {
      console.error('Error buscando dirección de zona segura:', e);
      if (!silencioso) await this.toast('No se pudo buscar la dirección. Intenta de nuevo.');
      return false;
    } finally {
      this.buscandoDireccion = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // =====================================================
  // BÚSQUEDA EN VIVO (SUGERENCIAS SOBRE EL MAPA)
  // =====================================================

  /** Se dispara con cada tecla: consulta después de 300 ms de pausa. */
  onTextoDireccion(texto: string) {
    this.formDireccionTexto = texto;

    if (this.timerSugerencias) {
      clearTimeout(this.timerSugerencias);
      this.timerSugerencias = null;
    }

    const consulta = (texto || '').trim();

    if (consulta.length < 3) {
      this.sugerencias = [];
      this.cargandoSugerencias = false;
      this.busquedaVacia = false;
      this.changeDetectorRef.detectChanges();
      return;
    }

    this.cargandoSugerencias = true;
    this.changeDetectorRef.detectChanges();

    this.timerSugerencias = setTimeout(() => {
      this.timerSugerencias = null;
      this.consultarSugerencias(consulta);
    }, 300);
  }

  private async consultarSugerencias(consulta: string) {
    try {
      const sugerencias = await this.zonaService.buscarSugerencias(consulta, this.puntoCerca());

      if (this.destruido) return;
      if ((this.formDireccionTexto || '').trim() !== consulta) return; // respuesta vieja

      this.sugerencias = sugerencias;
      this.busquedaVacia = sugerencias.length === 0;

      // El mapa va captando lo que se escribe: se previsualiza el primer resultado
      if (sugerencias.length) {
        this.aplicarSugerencia(sugerencias[0], false);
      }
    } catch (e) {
      console.error('Error buscando sugerencias de zona segura:', e);
    } finally {
      if (!this.destruido) {
        this.cargandoSugerencias = false;
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  private puntoCerca(): [number, number] | null {
    if (this.ubicacion) return [this.ubicacion.latitud, this.ubicacion.longitud];

    try {
      const centro = this.map?.getCenter();
      if (centro) return [centro.lat, centro.lng];
    } catch {
      /* sin mapa aún */
    }

    return null;
  }

  async seleccionarSugerencia(sugerencia: DireccionSugerida) {
    this.sugerencias = [];
    this.aplicarSugerencia(sugerencia, true);
    (document.activeElement as HTMLElement)?.blur();
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Ubica el centro, el radio y el puntero en el mapa con la sugerencia elegida.
   * Si sobrescribirTexto es false, sólo se mueve el mapa (previsualización al escribir).
   */
  private aplicarSugerencia(sugerencia: DireccionSugerida, sobrescribirTexto: boolean) {
    if (sobrescribirTexto) this.formDireccionTexto = sugerencia.texto;

    this.formDireccion = {
      texto: sugerencia.texto,
      region: sugerencia.region,
      comuna: sugerencia.comuna,
      calle: sugerencia.calle,
      numero: sugerencia.numero
    };

    this.pendienteLat = sugerencia.latitud;
    this.pendienteLng = sugerencia.longitud;
    this.colocandoCentro = true;
    this.pintarPrevisualizacion();
    this.volarA(sugerencia.latitud, sugerencia.longitud);

    if (sobrescribirTexto && !this.formNombre) {
      this.formNombre = sugerencia.calle
        ? `${sugerencia.calle}${sugerencia.numero ? ' ' + sugerencia.numero : ''}`
        : sugerencia.principal.slice(0, 60);
    }

    this.changeDetectorRef.detectChanges();
  }

  onBlurBusqueda() {
    // Se da tiempo a que el clic sobre la sugerencia se registre
    setTimeout(() => {
      if (this.destruido) return;
      this.sugerencias = [];
      this.changeDetectorRef.detectChanges();
    }, 220);
  }

  limpiarBusqueda() {
    if (this.timerSugerencias) {
      clearTimeout(this.timerSugerencias);
      this.timerSugerencias = null;
    }

    this.formDireccionTexto = '';
    this.sugerencias = [];
    this.cargandoSugerencias = false;
    this.busquedaVacia = false;
    this.formDireccion = { texto: '', region: '', comuna: '', calle: '', numero: '' };
    this.changeDetectorRef.detectChanges();
  }

  private volarA(latitud: number, longitud: number) {
    if (!this.map || typeof L === 'undefined') return;

    try {
      this.map.flyTo([latitud, longitud], 17, { duration: 0.6 });
    } catch {
      try {
        this.map.setView([latitud, longitud], 17);
      } catch {
        /* el mapa aún no está listo */
      }
    }
  }

  private pintarPrevisualizacion() {
    if (!this.map || typeof L === 'undefined') return;
    if (this.pendienteLat === null || this.pendienteLng === null) return;

    const coords: [number, number] = [this.pendienteLat, this.pendienteLng];

    if (!this.markerNuevo) {
      const icono = L.divIcon({
        className: 'zona-nuevo-marker',
        html: `
          <div class="zona-nuevo-pin">
            <div class="zona-nuevo-ring"></div>
            <svg width="36" height="46" viewBox="0 0 36 46">
              <path d="M18 2 C 8.6 2 2 9 2 17.5 C 2 28 18 43 18 43 C 18 43 34 28 34 17.5 C 34 9 27.4 2 18 2 Z"
                    fill="#ff9800" stroke="#ffffff" stroke-width="2"/>
              <circle cx="18" cy="17.5" r="7" fill="#ffffff"/>
              <circle cx="18" cy="17.5" r="3.5" fill="#ff9800"/>
            </svg>
          </div>`,
        iconSize: [36, 46],
        iconAnchor: [18, 43]
      });

      this.markerNuevo = L.marker(coords, { icon: icono, zIndexOffset: 1000 }).addTo(this.map);
      this.markerNuevo.bindPopup('<div style="text-align:center;font-size:12px;"><strong style="color:#ff9800;">Centro de la zona</strong></div>');
    } else {
      this.markerNuevo.setLatLng(coords);
    }

    if (!this.capaNueva) {
      this.capaNueva = L.circle(coords, {
        radius: this.formRadio,
        color: '#ff9800',
        fillColor: '#ffb74d',
        fillOpacity: 0.22,
        weight: 3,
        dashArray: '8 6'
      }).addTo(this.map);
    } else {
      this.capaNueva.setLatLng(coords);
      this.capaNueva.setRadius(this.formRadio);
    }
  }

  private limpiarPrevisualizacion() {
    if (this.markerNuevo) {
      try { this.markerNuevo.remove(); } catch { /* ya removida */ }
      this.markerNuevo = null;
    }
    if (this.capaNueva) {
      try { this.capaNueva.remove(); } catch { /* ya removida */ }
      this.capaNueva = null;
    }
    this.pendienteLat = null;
    this.pendienteLng = null;
  }

  onRadioChange(valor: any) {
    const numero = Math.round(Number(valor));
    this.formRadio = isNaN(numero) || numero <= 0 ? RADIO_POR_DEFECTO : numero;
    if (this.capaNueva) this.capaNueva.setRadius(this.formRadio);
  }

  fijarRadio(radio: number) {
    this.formRadio = radio;
    if (this.capaNueva) this.capaNueva.setRadius(radio);
  }

  get direccionFormulario(): string {
    if (this.formDireccion.texto) return this.formDireccion.texto;
    const partes = [
      `${this.formDireccion.calle} ${this.formDireccion.numero}`.trim(),
      this.formDireccion.comuna,
      this.formDireccion.region
    ].filter((p) => p && p.trim());
    return partes.join(', ');
  }

  /**
   * Centro de la zona escrito como dirección (ej: "Roberto Pérez 400").
   * Nunca devuelve coordenadas numéricas.
   */
  get textoCentroZona(): string {
    if (this.pendienteLat === null || this.pendienteLng === null) return '';

    const calle = (this.formDireccion.calle || '').trim();
    const numero = (this.formDireccion.numero || '').trim();
    if (calle) return numero ? `${calle} ${numero}` : calle;

    const texto = (this.direccionFormulario || '').trim();
    if (texto) return texto;

    return 'Centro elegido en el mapa';
  }

  /** Comuna y región que se ubicaron al buscar la dirección. */
  get direccionResuelta(): string {
    const partes = [this.formDireccion.comuna, this.formDireccion.region].filter(
      (p) => p && p.trim()
    );
    return partes.join(', ');
  }

  /** Nombre que se va a guardar (con respaldo para que un campo vacío no bloquee). */
  nombreParaGuardar(): string {
    return this.formNombre.trim()
      || (this.direccionFormulario || '').trim().slice(0, 60)
      || 'Zona segura';
  }

  async guardarZona() {
    if (this.guardando) return;

    if (!this.idAdulto) {
      await this.toast('No se pudo identificar a la persona. Cierra la pantalla y vuelve a entrar.');
      return;
    }

    if (this.pendienteLat === null || this.pendienteLng === null) {
      await this.toast('Busca la dirección o toca el mapa para elegir el centro de la zona.');
      return;
    }

    const nombre = this.nombreParaGuardar();

    this.guardando = true;
    this.changeDetectorRef.detectChanges();

    const datos: Partial<ZonaSegura> = {
      id_usuario: this.idAdulto,
      nombre,
      latitud_centro: this.pendienteLat,
      longitud_centro: this.pendienteLng,
      radio_metros: this.formRadio,
      direccion_texto: this.direccionFormulario || (this.formDireccionTexto || '').trim(),
      region: this.formDireccion.region,
      comuna: this.formDireccion.comuna,
      calle: this.formDireccion.calle,
      numero: this.formDireccion.numero
    };

    let ok = false;
    const fueEdicion = !!this.editandoId;

    if (this.editandoId) {
      ok = await this.zonaService.actualizarZona(this.editandoId, datos);
    } else {
      const creada = await this.zonaService.crearZona(datos);
      ok = !!creada;
    }

    this.guardando = false;

    if (ok) {
      this.editandoId = null;
      this.cancelarFormulario();
      await this.cargarZonas();
      await this.evaluarPosicion(false);
      await this.toast(fueEdicion ? 'Zona segura actualizada.' : 'Zona segura creada.');
    } else {
      const detalle = (this.zonaService.ultimoError || '').trim();
      await this.toast(detalle
        ? `No se pudo guardar la zona: ${detalle}`
        : 'No se pudo guardar la zona segura. Intenta de nuevo.');
    }

    this.changeDetectorRef.detectChanges();
  }

  async eliminarZona(zona: ZonaSegura) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar zona segura',
      message: `¿Quieres eliminar "${this.tituloZona(zona)}"?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            const ok = await this.zonaService.eliminarZona(zona.id);
            if (ok) {
              await this.cargarZonas();
              await this.evaluarPosicion(false);
              this.changeDetectorRef.detectChanges();
            } else {
              await this.toast('No se pudo eliminar la zona segura.');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async actualizarCasa(zona: ZonaSegura) {
    if (!this.idAdulto || this.actualizandoCasa) return;

    this.actualizandoCasa = true;
    this.changeDetectorRef.detectChanges();

    const ok = await this.zonaService.actualizarZonaCasa(zona.id, this.idAdulto);

    this.actualizandoCasa = false;

    if (ok) {
      await this.cargarZonas();
      await this.evaluarPosicion(false);
      await this.toast('Zona de casa actualizada con la dirección del perfil.');
    } else {
      await this.toast('No se pudo actualizar con la dirección del perfil.');
    }

    this.changeDetectorRef.detectChanges();
  }

  private async toast(mensaje: string) {
    const t = await this.toastCtrl.create({
      message: mensaje,
      duration: 2500,
      position: 'bottom',
      icon: 'information-circle-outline'
    });
    await t.present();
  }

  async localizar() {
    if (this.ubicacion && this.map) {
      this.map.setView([this.ubicacion.latitud, this.ubicacion.longitud], 17);
      return;
    }
    if (this.esCuidador) {
      await this.actualizarUbicacionAdulto(true);
    }
  }

  get hayZonas(): boolean {
    return this.zonas.length > 0;
  }
}

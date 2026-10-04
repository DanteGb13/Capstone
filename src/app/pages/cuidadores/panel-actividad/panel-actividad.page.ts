import { Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonSpinner, IonSelect, IonSelectOption } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  arrowBack, refresh, pulse, warning, home, time, footsteps, location,
  calendar, informationCircle, expand, contract, logIn, logOut
} from 'ionicons/icons';
import {
  PanelActividadService,
  ResumenPanel,
  ResumenDia,
  LugarFrecuente,
  AlertaItem,
  DetalleTrayecto
} from '../../../services/Backend/panel-actividad/panel-actividad';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';

/** Leaflet, expuesto en `window` por `main.ts`. */
declare const L: any;

/**
 * El panel mira una sola ventana: los últimos 7 días. El selector de ventana se
 * quita cuando no hay nada que elegir, porque un grupo de un botón parece algo
 * que se puede cambiar y no lo es.
 */
const DIAS = 7;

@Component({
  selector: 'app-panel-actividad',
  templateUrl: './panel-actividad.page.html',
  styleUrls: ['./panel-actividad.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonSpinner,
    IonSelect,
    IonSelectOption
  ]
})
export class PanelActividadPage implements OnDestroy {

  private panelService = inject(PanelActividadService);
  private vinculacion = inject(Vinculacion);
  private router = inject(Router);
  private ruta = inject(ActivatedRoute);

  cargando = signal(true);
  error = signal<string | null>(null);

  /** La ventana que se mira. Fija: el panel solo muestra los últimos 7 días. */
  readonly rango = DIAS;

  /** Los adultos a cargo, para poder cambiar de persona. */
  adultos: { id: string; nombre: string }[] = [];
  idSeleccionado = signal<string | null>(null);

  panel = signal<ResumenPanel | null>(null);

  /** Id del trayecto resaltado en el mapa. null = todas las rutas a la vez. */
  rutaSeleccionada = signal<string | null>(null);

  /** true cuando el mapa ocupa toda la pantalla. */
  mapaGrande = signal(false);

  /**
   * Cada vez que se entra a la pantalla se vuelve a leer.
   *
   * Ionic deja la página viva en el router outlet, así que `ngOnInit` corre una
   * sola vez en toda la sesión. Con la carga solo en `ngOnInit`, salir y volver
   * al panel mostraba el mismo panel viejo —o el que había salido vacío en el
   * arranque en frío— sin que nada lo refrescara. `ionViewWillEnter` sí corre en
   * cada entrada, que es lo que el cuidador espera al volver.
   */
  ionViewWillEnter() {
    this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      if (!this.adultos.length) {
        this.adultos = await this.listaAdultos();
      }

      const deUrl = this.ruta.snapshot.queryParamMap.get('id');
      const id = deUrl || this.idSeleccionado() || this.adultos[0]?.id || null;

      if (!id) {
        this.panel.set(null);
        this.error.set('No tienes ningún adulto mayor vinculado todavía.');
        return;
      }

      this.idSeleccionado.set(id);
      this.panel.set(await this.panelService.cargar(id, this.rango));
    } catch (e) {
      console.error('No se pudo cargar el panel de actividad', e);
      this.error.set('No se pudo cargar la actividad. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  private async listaAdultos() {
    try {
      const lista = await this.vinculacion.obtenerAdultosACargo();
      return (lista || []).map((a: any) => {
        const id = a?.adulto_mayor?.id || a?.id_usuario || a?.id;
        const nombre = [a?.adulto_mayor?.nombre, a?.adulto_mayor?.appellidopa]
          .filter(Boolean)
          .join(' ')
          .trim();
        return { id, nombre: nombre || 'Adulto mayor' };
      }).filter((a: any) => !!a.id);
    } catch (e) {
      console.error('No se pudieron listar los adultos a cargo', e);
      return [] as { id: string; nombre: string }[];
    }
  }

  cambiarAdulto(evento: any) {
    const id = evento?.detail?.value;
    if (typeof id === 'string' && id) {
      this.idSeleccionado.set(id);
      this.rutaSeleccionada.set(null);
      this.mapaGrande.set(false);
      this.cargar();
    }
  }

  refrescar() {
    this.rutaSeleccionada.set(null);
    this.mapaGrande.set(false);
    this.cargar();
  }

  /**
   * La flecha del encabezado primero cierra el mapa a pantalla completa. Si no,
   * un toque atrás sacaría del panel con el mapa todavía abierto en pantalla.
   */
  volver() {
    if (this.mapaGrande()) {
      this.cerrarMapa();
      return;
    }
    this.router.navigate(['/cuidador']);
  }

  ngOnDestroy() {
    this.destruirMapa();
  }


  // =====================================================
  // MAPA DE RUTAS
  // =====================================================

  /**
   * Toca un trayecto para resaltarlo en el mapa. Tocar el que ya está
   * resaltado lo suelta y vuelve a verse el patrón completo, que es lo que
   * responde a "por dónde suele ir".
   */
  alternarRuta(id: string): void {
    this.rutaSeleccionada.set(this.rutaSeleccionada() === id ? null : id);
    this.pintarMapa();
  }

  /** true si la fila del listado es la que está resaltada en el mapa. */
  rutaResaltada(id: string): boolean {
    return this.rutaSeleccionada() === id;
  }

  /** Suelta el resaltado y vuelve a verse el patrón completo. */
  verTodasLasRutas(): void {
    this.rutaSeleccionada.set(null);
    this.pintarMapa();
  }

  /**
   * Abre el mapa a pantalla completa.
   *
   * No se crea un mapa nuevo: se agranda el mismo. T recrearlo en otra pantalla
   * obliga a volver a pedir los trayectos y a esperar otra vez a que carguen los
   * mosaicos, cuando los datos ya están en memoria.
   */
  abrirMapa(): void {
    this.mapaGrande.set(true);
    this.reencuadrar();
  }

  /** Cierra el mapa a pantalla completa y lo devuelve a la tarjeta. */
  cerrarMapa(): void {
    this.mapaGrande.set(false);
    this.reencuadrar();
  }

  /**
   * El mapa cambió de tamaño, así que hay que volver a medirlo y a ajustarlo a
   * las rutas. Sin esto queda mirando la posición anterior y el trayecto
   * resaltado puede quedar fuera de la pantalla.
   *
   * Se espera a que termine el cambio de tamaño: si se reencuadra mientras el
   * div todavía está en 240 px, el ajuste se calcula sobre el tamaño viejo.
   */
  private reencuadrar(): void {
    if (!this.mapa) {
      return;
    }
    setTimeout(() => {
      if (!this.mapa) {
        return;
      }
      try {
        this.mapa.invalidateSize();
        this.encuadrarRutas();
      } catch (e) {
        console.error('No se pudo reencuadrar el mapa', e);
      }
    }, 350);
  }

  /** Trayectos con puntos suficientes para dibujar una línea. */
  trayectosConRuta(): DetalleTrayecto[] {
    return this.trayectos().filter((t) => t.ruta.length >= 2);
  }

  /**
   * Cuántos trayectos se quedan fuera del mapa por falta de puntos. Se dice en
   * voz alta porque un trayecto que no aparece en el mapa es fácil de pasar por
   * alto como si no hubiera registro.
   */  trayectosSinRuta(): number {
    return this.trayectos().filter((t) => t.ruta.length < 2).length;
  }

  /**
   * El mapa se crea y se repinta cada vez que cambia la tarjeta. Va con un
   * `@ViewChild` porque el div solo existe cuando ya llegaron los datos, y con
   * un turno de espera porque Leaflet necesita que el contenedor tenga tamaño:
   * si se inicializa en el mismo ciclo en que aparece, mide 0 y queda en gris.
   */
  @ViewChild('mapaRuta')
  set contenedorMapa(el: ElementRef<HTMLElement> | undefined) {
    this.capaMapa = el ? el.nativeElement : null;
    // Se suelta el mapa anterior: si el div desaparece y vuelve, el objeto viejo
    // sigue escuchando scrolls sobre un contenedor que ya no está en la pantalla.
    this.destruirMapa();
    if (el) {
      setTimeout(() => this.pintarMapa(), 150);
    }
  }

  private mapa: any = null;
  private capaRutas: any = null;
  private capaMapa: HTMLElement | null = null;

  private pintarMapa(): void {
    if (!this.capaMapa || typeof L === 'undefined') {
      return;
    }
    const rutas = this.trayectosConRuta();
    if (!rutas.length) {
      return;
    }

    try {
      if (!this.mapa) {
        this.mapa = L.map(this.capaMapa, {
          zoomControl: false,
          // Con la rueda se hace scroll del panel, no zoom. El zoom se deja en
          // los botones por si acaso.
          scrollWheelZoom: false,
          dragging: true,
          tap: false
        });
        // Host único (HTTP/2) y no {s}.subdominio: el `preconnect` de index.html
        // apunta a `https://tile.openstreetmap.org`, así que con `{s}` había que
        // resolver y abrir conexión a `a.tile.openstreetmap.org` aparte.
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          updateWhenZooming: false,
          attribution: '© OpenStreetMap'
        }).addTo(this.mapa);
      }

      if (this.capaRutas) {
        this.capaRutas.clearLayers();
      } else {
        this.capaRutas = L.layerGroup().addTo(this.mapa);
      }

      const limites = L.latLngBounds([]);
      const seleccion = this.rutaSeleccionada();

      for (const t of rutas) {
        const puntos = t.ruta.map((p) => [p.lat, p.lon] as [number, number]);
        const esLaSeleccionada = seleccion === t.id;
        L.polyline(puntos, {
          color: esLaSeleccionada ? '#0277bd' : '#90a4ae',
          weight: esLaSeleccionada ? 5 : 3,
          opacity: esLaSeleccionada ? 1 : 0.7,
          lineJoin: 'round'
        }).addTo(this.capaRutas);

        if (esLaSeleccionada) {
          L.circleMarker(puntos[0], {
            radius: 7,
            color: '#ffffff',
            weight: 2,
            fillColor: '#43a047',
            fillOpacity: 1
          }).addTo(this.capaRutas).bindTooltip('Salida');
          L.circleMarker(puntos[puntos.length - 1], {
            radius: 7,
            color: '#ffffff',
            weight: 2,
            fillColor: '#e53935',
            fillOpacity: 1
          }).addTo(this.capaRutas).bindTooltip('LLegada');
        }

        for (const p of puntos) {
          limites.extend(p);
        }
      }

      // El mapa se ajusta a las rutas, no al centro de la pantalla: con un solo
      // trayecto de 70 m, un zoom fijo dejaría la línea en un punto invisible.
      this.limitesRutas = limites;
      this.encuadrarRutas();
      this.mapa.invalidateSize();
    } catch (e) {
      console.error('No se pudo dibujar el mapa de rutas', e);
    }
  }

  private limitesRutas: any = null;

  /**
   * Ajusta la vista a las rutas ya dibujadas. Con el mapa a pantalla completa
   * se vuelve a llamar, porque la proporción cambia y el encuadre de la tarjeta
   * dejaría la ruta en una esquina.
   */
  private encuadrarRutas(): void {
    if (this.mapa && this.limitesRutas && this.limitesRutas.isValid()) {
      this.mapa.fitBounds(this.limitesRutas, { padding: [22, 22], maxZoom: 17 });
    }
  }

  /**
   * Suelta el mapa. Sin esto, al refrescar o cambiar de adulto el mapa anterior
   * se queda vivo con su contenedor viejo en el medio.
   */
  private destruirMapa(): void {
    if (this.mapa) {
      try {
        this.mapa.remove();
      } catch {
        // El contenedor ya no está en el DOM; no hay nada que soltar.
      }
      this.mapa = null;
    }
    this.capaRutas = null;
    this.limitesRutas = null;
  }


  // =====================================================
  // FORMATO
  // =====================================================

  /** Cuántas alertas hay de un tipo. */
  totalAlertas(tipo: AlertaItem['tipo']): number {
    const p = this.panel();
    if (!p) {
      return 0;
    }
    return p.alertas.filter((a) => a.tipo === tipo).length;
  }

  /** Porcentaje que ocupa la barra, acotado a 100 para no desbordar. */
  anchoBarra(valor: number, maximo: number): number {
    if (!Number.isFinite(valor) || valor <= 0 || maximo <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((valor / maximo) * 100));
  }

  /** Trayectos del más nuevo al más viejo, como pide el listado. */
  trayectos(): DetalleTrayecto[] {
    return this.panel()?.trayectos || [];
  }

  /**
   * El conteo del encabezado de la tarjeta de trayectos, con su plural.
   *
   * Va con la palabra porque un número solo al lado de un título se lee como
   * una cifra más de la lista, y aquí es cuántos trayectos hay en total. El
   * período ya está escrito arriba del todo, así que no se repite.
   */
  conteoTrayectos(): string {
    const n = this.trayectos().length;
    if (n === 0) {
      return 'sin trayectos';
    }
    return n === 1 ? '1 trayecto' : `${n} trayectos`;
  }

  /**
   * Conteo por tipo, para la tarjeta de alertas. Solo cantidades: el detalle
   * de cada una ya se ve en la sección de alertas SOS del menú y en el
   * historial, y aquí solo hace falta saber cuánto hay.
   */
  conteoAlertas(): { tipo: AlertaItem['tipo']; etiqueta: string; cantidad: number; icono: string }[] {
    const p = this.panel();
    if (!p) {
      return [];
    }
    return [
      // Rotulos cortos: la tarjeta ya se titula "Alertas", asi que decir
      // "Alertas SOS" repetia la palabra de arriba, y "Solicitudes de salud" se
      // puede leer entero como "Salud".
      { tipo: 'sos' as const, etiqueta: 'SOS', cantidad: this.totalAlertas('sos'), icono: 'warning' },
      { tipo: 'zona' as const, etiqueta: 'Zona segura', cantidad: p.zona ? 1 : 0, icono: 'home' },
      { tipo: 'salud' as const, etiqueta: 'Salud', cantidad: this.totalAlertas('salud'), icono: 'pulse' }
    ];
  }

  /**
   * Si la tarjeta de alertas tiene algo que mostrar.
   *
   * Cuenta también las salidas, las vueltas y la posición actual: si lo único
   * que pasó en la semana fue que el adulto salió y volvió, la tarjeta no puede
   * decir que no pasó nada.
   */
  hayAlgoQueContar(): boolean {
    const p = this.panel();
    if (!p) {
      return false;
    }
    return this.alertas().length > 0
      || p.casa.salidas > 0
      || p.casa.entradas > 0
      || p.casa.ahoraDentro !== null
      || p.salidasZona.salidas > 0;
  }

  /**
   * La fila "Estoy en casa": cuántas veces volvió y dónde estaba en el último
   * punto.
   *
   * El estado va con la hora del punto que lo dice. Sin ella, un último punto de
   * hace tres días se leería como "ahora está en casa", que es justo el tipo de
   * mentira que este panel evita en todas las demás cifras.
   */
  estoyEnCasa(): string {
    const c = this.panel()?.casa;
    if (!c) {
      return 'sin dato';
    }

    const vueltas = c.entradas === 1 ? '1 vuelta' : `${c.entradas} vueltas`;
    if (c.ahoraDentro === null) {
      return `${vueltas} · sin dato`;
    }
    const donde = c.ahoraDentro ? 'dentro' : 'fuera';
    if (!c.ultimoPunto) {
      return `${vueltas} · ${donde}`;
    }
    return `${vueltas} · ${donde} el ${this.fechaHora(c.ultimoPunto)}`;
  }

  /** Fecha y hora en formato local, sin depender del locale de Angular. */
  fechaHora(iso: string | null): string {
    if (!iso) {
      return 'sin dato';
    }
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) {
      return 'sin dato';
    }
    const d = new Date(t);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
  }

  /** Duración en "1 h 25 min", o "en curso" si el trayecto sigue abierto. */
  duracion(t: DetalleTrayecto): string {
    if (t.abierto) {
      return 'en curso';
    }
    const total = Math.max(0, Math.round(t.duracionS / 60));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) {
      return `${m} min`;
    }
    return `${h} h ${m} min`;
  }

  /** Velocidad media, o guion si no es calculable. */
  velocidad(t: DetalleTrayecto): string {
    if (t.velocidadKmh === null) {
      return 'sin dato';
    }
    return `${t.velocidadKmh} km/h`;
  }

  /**
   * "12 de 47 puntos" o "sin puntos". El número importa: un trayecto con 2
   * puntos no respalda ni la distancia ni el tiempo quieto, y hay que decirlo
   * para que el cuidador no los tome en serio.
   */
  puntos(t: DetalleTrayecto): string {
    if (t.puntos === 0) {
      return 'sin puntos de GPS';
    }
    if (t.puntos < 5) {
      return `${t.puntos} puntos, muy poco`;
    }
    return `${t.puntos} puntos`;
  }

  /** Porcentaje quieto, o guion si no hay con qué calcularlo. */
  pctQuieto(t: DetalleTrayecto): string {
    if (t.pctQuieto === null) {
      return 'sin calcular';
    }
    if (t.pctQuieto === 0) {
      return 'sin pausas';
    }
    return `${t.pctQuieto}% quieto`;
  }

  /**
   * Aviso de incoherencia entre la distancia que escribió el teléfono y la que
   * se puede rehacer con los puntos que quedaron. Solo aparece cuando hay
   * suficientes puntos para que la comparación signifique algo.
   */
  incoherencia(t: DetalleTrayecto): string | null {
    if (t.puntos < 5 || t.distanciaSinPuntosM < 50) {
      return null;
    }
    const pct = Math.round((t.distanciaSinPuntosM / Math.max(t.distanciaM, 1)) * 100);
    return `Ojo: la distancia guardada (${this.formatoDistancia(t.distanciaM)}) no cuadra con los ${t.puntos} puntos que hay (difieren ${pct}%). Puede que se hayan borrado puntos.`;
  }

  /** Los minutos quieto de un día, o guion si no hubo registro. */
  quieto(dia: ResumenDia): string {
    if (dia.minutosQuieto <= 0) {
      return 'sin registro';
    }
    return this.formatoHoras(dia.minutosQuieto / 60);
  }

  /**
   * El tiempo quieto para la etiqueta de la barra. Sale "–" y no "sin registro"
   * porque con siete columnas un texto de once letras se sale de la suya; el
   * pie de la tarjeta ya explica que los días rayados no tienen registro.
   */
  quietoCorto(dia: ResumenDia): string {
    if (this.panel()?.sinPuntos || dia.minutosQuieto <= 0) {
      return '–';
    }
    return this.formatoHoras(dia.minutosQuieto / 60);
  }


  // =====================================================
  // GRÁFICO DE TRAYECTOS
  // =====================================================

  /**
   * Un día por cada día del rango, para el eje. Los días sin trayecto también
   * entran: quitarlos del eje haría que el gráfico saltara de un día al
   * siguiente y no se viera que no hubo registro.
   */
  diasGrafico(): ResumenDia[] {
    return this.dias();
  }

  /**
   * Trayectos de un día, en el orden en que ocurrieron. Se usan las
   * fechas exactas de cada trayecto, no el resumen por día, para que dos
   * trayectos que cayeron el mismo día caigan en la misma barra.
   */
  trayectosDelDia(dia: ResumenDia): DetalleTrayecto[] {
    return this.trayectos().filter((t) => {
      const t0 = Date.parse(t.inicio);
      return Number.isFinite(t0) && this.claveDia(new Date(t0)) === dia.fecha;
    });
  }

  /**
   * Barras apiladas: la parte alta es tiempo quieto y la baja es desplazamiento.
   *
   * El orden importa. La barra crece desde abajo con el desplazamiento, que es
   * lo que se quiere comparar entre días, y el tiempo quieto se apila encima. Al
   * revés, las barras altas taparían el movimiento.
   */
  alturaSegmentoDia(dia: ResumenDia, tipo: 'movimiento' | 'quieto'): number {
    const escala = this.escalaGrafico();
    if (escala <= 0) {
      return 0;
    }
    const base = tipo === 'movimiento' ? dia.distanciaM : dia.minutosQuieto;
    // Sin puntos no hay tiempo quieto que graficar: se deja el hueco, no se inventa
    // una barra de 0 que parece un dato medido.
    if (tipo === 'quieto' && this.panel()?.sinPuntos) {
      return 0;
    }
    return Math.min(100, (base / escala) * 100);
  }

  /**
   * Escala común: distancia en metros y tiempo quieto en minutos no son la misma
   * unidad, así que se convierten los dos a minutos equivalentes.
   *
   * El desplazamiento se mide en distancia y el tiempo quieto en tiempo, así que
   * compararlos sin convertir daría una barra de 1 km (=1000) contra una de
   * 90 min: la primera aplastaría a la segunda siempre.
   *
   * Y como los dos segmentos van apilados en la misma barra, la escala es la
   * SUMA de los dos en el día más pesado, no el mayor de los dos. Tomando el
   * máximo, un día con 30 min de marcha y 60 quieto daba dos barras al tope:
   * 150% de alto, más que el contenedor, y la barra se salía de la tarjeta.
   */
  private escalaGrafico(): number {
    const p = this.panel();
    if (!p) {
      return 0;
    }
    let max = 0;
    for (const d of p.dias) {
      max = Math.max(max, this.minutosDeDistancia(d.distanciaM) + d.minutosQuieto);
    }
    return max;
  }

  /**
   * Distancia convertida a "minutos de marcha" para poder graficarla junto al
   * quieto: se usa 4,5 km/h, que es el paso lento de una persona mayor.
   * No es una velocidad real del adulto, es una escala común.
   */
  private minutosDeDistancia(metros: number): number {
    const VELOCIDAD_REF_MPOR_MIN = 4500 / 60;
    return Number.isFinite(metros) && metros > 0 ? metros / VELOCIDAD_REF_MPOR_MIN : 0;
  }

  /** true si el día tiene algo que graficar. */
  diaTieneGrafico(dia: ResumenDia): boolean {
    return dia.distanciaM > 0 || (!this.panel()?.sinPuntos && dia.minutosQuieto > 0);
  }

  /**
   * El desplazamiento para la etiqueta de la barra. Sin registro va "–" y no
   * "0 m": la barra de ese día va rayada, y un 0 al lado de una barra rayada
   * parece un dato medido. Con datos, el valor tal cual.
   */
  distanciaCorta(dia: ResumenDia): string {
    if (dia.distanciaM <= 0) {
      return '–';
    }
    return this.formatoDistancia(dia.distanciaM);
  }

  private claveDia(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  formatoDistancia(metros: number): string {
    if (!Number.isFinite(metros) || metros <= 0) {
      return '0 m';
    }
    if (metros < 1000) {
      return `${Math.round(metros)} m`;
    }
    return `${(metros / 1000).toFixed(1)} km`;
  }

  formatoHoras(horas: number): string {
    if (!Number.isFinite(horas) || horas <= 0) {
      return '0 h';
    }
    if (horas < 1) {
      return `${Math.round(horas * 60)} min`;
    }
    return `${horas.toFixed(1)} h`;
  }

  /** "hace 3 h" / "hace 2 días", sin depender del locale de Angular. */
  tiempoRelativo(fecha: string | null | undefined): string {
    if (!fecha) {
      return 'sin dato';
    }
    const t = Date.parse(fecha);
    if (!Number.isFinite(t)) {
      return 'sin dato';
    }
    const minutos = Math.round((Date.now() - t) / 60000);
    if (minutos < 1) {
      return 'recién';
    }
    if (minutos < 60) {
      return `hace ${minutos} min`;
    }
    const horas = Math.round(minutos / 60);
    if (horas < 24) {
      return `hace ${horas} h`;
    }
    const dias = Math.round(horas / 24);
    return dias === 1 ? 'ayer' : `hace ${dias} días`;
  }



  etiquetaAlerta(tipo: AlertaItem['tipo']): string {
    if (tipo === 'sos') {
      return 'SOS';
    }
    if (tipo === 'zona') {
      return 'Zona';
    }
    return 'Salud';
  }

  /** Para el mapa de barras de lugares. */
  lugares(): LugarFrecuente[] {
    return this.panel()?.lugares || [];
  }

  dias(): ResumenDia[] {
    return this.panel()?.dias || [];
  }

  alertas(): AlertaItem[] {
    return this.panel()?.alertas || [];
  }

  /** Un día con datos es el único que puede comparar contra el promedio. */
  diaTope(): ResumenDia | null {
    const conDatos = this.dias().filter((d) => d.distanciaM > 0);
    if (!conDatos.length) {
      return null;
    }
    return conDatos.reduce((a, b) => (b.distanciaM > a.distanciaM ? b : a));
  }

  constructor() {
    addIcons({
      arrowBack, refresh, pulse, warning, home, time, footsteps,
      location, calendar, informationCircle, expand, contract, logIn, logOut
    });
  }
}

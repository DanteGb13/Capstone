import { Injectable, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Voz, InfoVoz } from './voz';

const INFO_VACIA: InfoVoz = {
  listo: false,
  motorListo: false,
  lectorExterno: false,
  velocidad: 1,
  tono: 1,
  idioma: ''
};

const STORAGE_ACTIVO = 'voz-activa';
const STORAGE_VELOCIDAD = 'voz-velocidad';

/** Un texto más largo que esto no es una etiqueta, es un párrafo. */
const MAX_ETIQUETA = 60;

/** Si se repite el mismo nombre en menos de este tiempo, es el mismo toque. */
const REPETICION_MS = 1200;

@Injectable({ providedIn: 'root' })
export class VozService {

  readonly activo = signal(false);
  readonly velocidad = signal(1);
  readonly info = signal<InfoVoz>(INFO_VACIA);
  readonly hablando = signal(false);

  /**
   * Hay que apagarlo si el sistema ya está leyendo.
   *
   * Con TalkBack encendido, esta capa hablaría encima y quedarían dos voces
   * superpuestas: la app quedaría inaudible justo para la persona que activó la
   * ayuda para poder usarla.
   */
  readonly chocaConLector = computed(
    () => this.activo() && this.info().lectorExterno
  );

  /** Lo que se escribe bajo la tarjeta de Ajustes. */
  readonly resumen = computed(() => {
    if (this.chocaConLector()) return 'Apagada: el sistema ya lee la pantalla';
    return this.activo() ? 'Activada' : 'Desactivada';
  });

  private ultimoTexto = '';
  private ultimoMomento = 0;
  private escuchando = false;
  private ultimoTitulo = '';

  constructor() {
    this.activo.set(this.leer(STORAGE_ACTIVO) === '1');
    this.velocidad.set(Number(this.leer(STORAGE_VELOCIDAD)) || 1);
    this.conectar();
  }
  private leer(storageKey: string): string {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      // Sin almacenamiento local se arranca con los valores por defecto.
      return '';
    }
  }

  private conectar(): void {
    // La voz puede haber quedado activada de la sesión anterior. `establecer()`
    // NO se ejecuta al abrir la app, así que si el escuchador sólo se
    // enganchara ahí, la tarjeta de Ajustes diría "Activada" y la pantalla
    // seguiría en silencio hasta que el usuario apagara y encendiera la voz.
    if (this.activo()) this.instalar();

    if (!Capacitor.isNativePlatform()) return;

    void this.leerInfo();
    void Voz.addListener('fin', () => this.hablando.set(false));
  }

  async leerInfo(): Promise<InfoVoz> {
    if (!Capacitor.isNativePlatform()) {
      this.info.set(INFO_VACIA);
      return INFO_VACIA;
    }

    try {
      const r = await Voz.info();
      this.info.set(r);
      return r;
    } catch (e) {
      console.warn('No se pudo leer la información de voz:', e);
      this.info.set(INFO_VACIA);
      return INFO_VACIA;
    }
  }

  // =====================================================
  // ENCENDER Y APAGAR
  // =====================================================

  /**
   * Enciende o apaga la lectura.
   *
   * Devuelve `false` si no se pudo encender, para que la pantalla pueda dejar el
   * interruptor como estaba: prometer que está activa cuando no lo está es peor
   * que no encenderla.
   */
  async establecer(activo: boolean): Promise<boolean> {
    if (!activo) {
      this.activo.set(false);
      this.guardar(STORAGE_ACTIVO, '0');
      this.desinstalar();
      await this.silencio();
      return true;
    }

    const info = await this.leerInfo();

    if (info.lectorExterno) {
      // No es un error de la app: el sistema ya hace esto mejor y con control
      // de volumen. Se avisa en vez de activación a ciegas.
      return false;
    }

    this.activo.set(true);
    this.guardar(STORAGE_ACTIVO, '1');
    await this.fijarVelocidad();

    this.instalar();
    await this.decir('Lectura en voz alta activada.');
    return true;
  }

  private guardar(clave: string, valor: string): void {
    try {
      localStorage.setItem(clave, valor);
    } catch {
      // si no se guarda, el ajuste sólo dura esta sesión
    }
  }

  // =====================================================
  // LO QUE SE DICE AL TOCAR
  // =====================================================

  /**
   * Un único escuchador en toda la app, en fase de captura.
   *
   * Va en `document` y no en cada componente a propósito: registrar un
   * escuchador por pantalla obligaría a acordarse de ponerlo en cada una, y la
   * primera pantalla nueva sin él anunciaría el silencio.
   *
   * Se engancha siempre que la voz esté activa, también fuera del teléfono: en
   * el navegador `decir()` no hace nada, pero así el estado real (escuchador
   * puesto o no) vive en un solo sitio y se puede probar.
   */
  private instalar(): void {
    if (this.escuchando) return;
    this.escuchando = true;
    document.addEventListener('click', this.alTocar, true);
  }

  private desinstalar(): void {
    if (!this.escuchando) return;
    this.escuchando = false;
    document.removeEventListener('click', this.alTocar, true);
  }

  private readonly alTocar = (evento: Event): void => {
    if (!this.activo()) return;

    // Un control ya abierto (un menú, un modal) lo anuncia el propio sistema
    // al abrirlo; si también lo dijera esta capa se oiría dos veces.
    if ((evento.target as HTMLElement)?.closest('.ion-overlay')) return;

    const texto = this.etiquetaDe(evento.target);
    if (!texto) return;

    this.decir(texto);
  };

  /**
   * Nombre de lo que se tocó.
   *
   * Se busca de abajo hacia arriba porque el toque cae en el nodo más
   * profundo: si alguien toca el texto dentro de un botón, el elemento
   * concreto es un `span` que no tiene nombre propio, y hay que subir hasta
   * encontrar algo que sí lo tenga.
   */
  private etiquetaDe(destino: EventTarget | null): string {
    if (!(destino instanceof Element)) return '';

    let el: Element | null = destino;
    while (el && el !== document.body && el !== document.documentElement) {
      const texto = this.etiquetaDeElemento(el);
      if (texto) return texto;
      el = el.parentElement;
    }
    return '';
  }

  private etiquetaDeElemento(el: Element): string {
    // 1. Etiqueta explícita. Es lo primero que se mira porque es lo único que
    //    no depende de la forma del markup.
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return this.limpiar(aria);

    const porId = this.textoDeAriaLabelledBy(el);
    if (porId) return porId;

    // 2. Un campo de texto se anuncia por su nombre, no por lo que tenga
    //    escrito: leerle a alguien lo que acaba de escribir es inútil.
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return this.limpiar(el.placeholder || el.getAttribute('name') || '');
    }

    // 3. Texto visible, en orden de documento.
    const visible = this.primerTexto(el);
    return visible ? this.limpiar(visible) : '';
  }

  private textoDeAriaLabelledBy(el: Element): string {
    const ids = el.getAttribute('aria-labelledby');
    if (!ids) return '';

    for (const id of ids.split(/\s+/)) {
      const referenciado = document.getElementById(id);
      const texto = referenciado?.textContent?.trim();
      if (texto) return texto;
    }
    return '';
  }

  /**
   * Primer texto con contenido de un elemento, en orden de documento.
   *
   * Se recorre el subárbol y se corta en el primero: en una tarjeta como
   *
   *   Tamaño de letra
   *   Grande
   *
   * devuelve "Tamaño de letra" y no "Tamaño de letraGrande", que es lo que
   * daría con `textContent` de toda la tarjeta.
   */
  private primerTexto(el: Element): string {
    const propio = Array.from(el.childNodes)
      .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      ?.textContent
      ?.trim();

    if (propio) {
      // El corte por longitud va AQUÍ también y no sólo en el recorrido: si
      // este texto fuera un párrafo, sin esta comprobación la voz se leería el
      // párrafo entero a quien tocó en cualquier parte de él.
      return propio.length <= MAX_ETIQUETA ? propio : '';
    }

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const texto = n.textContent?.trim();
      if (texto && texto.length <= MAX_ETIQUETA) return texto;
    }
    return '';
  }

  private limpiar(texto: string): string {
    return texto
      .replace(/\s+/g, ' ')
      .replace(/^[\s·•\-—:]+|[\s·•\-—:]+$/g, '')
      .trim();
  }

  // =====================================================
  // HABLAR
  // =====================================================

  async decir(texto: string): Promise<void> {
    if (!texto || !Capacitor.isNativePlatform()) return;

    const ahora = Date.now();
    // El mismo nombre repetido enseguida es el mismo toque, disparado dos
    // veces por el navegador, no dos toques distintos.
    if (texto === this.ultimoTexto && ahora - this.ultimoMomento < REPETICION_MS) {
      return;
    }
    this.ultimoTexto = texto;
    this.ultimoMomento = ahora;
    this.hablando.set(true);

    try {
      await Voz.hablar({ texto });
    } catch (e) {
      this.hablando.set(false);
      console.warn('No se pudo leer en voz alta:', e);
    }
  }

  /**
   * Lee la pantalla actual de arriba abajo.
   *
   * Las frases van encoladas y no interrumpidas: si cada línea se pidiera por
   * separado con interrupción, se pisarían y sólo se oiría la última.
   */
  async leerPantalla(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    const lineas = this.lineasDePantalla();
    if (lineas.length === 0) return;

    this.hablando.set(true);
    try {
      await Voz.leerLineas({ lineas });
    } catch (e) {
      this.hablando.set(false);
      console.warn('No se pudo leer la pantalla:', e);
    }
  }

  private lineasDePantalla(): string[] {
    const pagina = document.querySelector('.ion-page:not(.ion-page-hidden)');
    if (!pagina) return [];

    const salida: string[] = [];

    const titulo = pagina.querySelector('ion-title')?.textContent?.trim();
    if (titulo) {
      salida.push(titulo);
      this.ultimoTitulo = titulo;
    }

    // Se leen encabezados y botones, en orden. El resto del texto (párrafos,
    // descripciones) se omite a propósito: leerlo todo convierte la pantalla
    // en un audio endless y la persona no encuentra dónde pulsar.
    const interesting = pagina.querySelectorAll(
      'h1, h2, h3, .ajustes-texto > span:first-child, ion-button, .btn-mic, .boton'
    );

    for (const el of Array.from(interesting)) {
      const texto = this.limpiar(el.textContent || '');
      if (!texto || texto.length > MAX_ETIQUETA) continue;
      if (salida.includes(texto)) continue;
      salida.push(texto);

      if (salida.length >= 12) break;
    }

    return salida;
  }

  private async silencio(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Voz.detener();
    } catch {
      // sin motor listo no hay nada que callar
    }
    this.hablando.set(false);
  }

  // =====================================================
  // AJUSTES
  // =====================================================

  /**
   * Le pasa al motor la velocidad guardada.
   *
   * Va aparte de `cambiarVelocidad` porque al ENCENDER no hay que anunciarlo:
   * si se reutilizara aquél, cada vez que se activara la voz se oiría
   * "Velocidad uno" después de "Lectura en voz alta activada", y sonaría a error.
   */
  private async fijarVelocidad(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Voz.velocidad({ valor: this.velocidad() });
    } catch (e) {
      console.warn('No se pudo aplicar la velocidad guardada:', e);
    }
  }

  async cambiarVelocidad(valor: number): Promise<void> {
    this.velocidad.set(valor);
    this.guardar(STORAGE_VELOCIDAD, String(valor));

    if (!Capacitor.isNativePlatform()) return;
    try {
      await Voz.velocidad({ valor });
      await this.decir(`Velocidad ${valor.toFixed(1).replace('.', ',')}.`);
    } catch (e) {
      console.warn('No se pudo cambiar la velocidad:', e);
    }
  }

  async abrirAccesibilidad(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Voz.abrirAccesibilidad();
    } catch (e) {
      console.warn('No se pudieron abrir los ajustes de accesibilidad:', e);
    }
  }
}

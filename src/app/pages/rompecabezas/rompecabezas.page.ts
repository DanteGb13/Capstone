import { Component, ChangeDetectorRef, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonRange
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  arrowBack,
  cameraOutline,
  checkmarkDoneOutline,
  chevronDownOutline,
  chevronUpOutline,
  helpCircleOutline,
  imagesOutline,
  refreshOutline,
  removeOutline,
  swapHorizontalOutline
} from 'ionicons/icons';
import { TutorialJuegoComponent } from '../../components/tutorial-juego/tutorial-juego.component';
import { TUTORIAL_ROMPECABEZA } from '../juegos/tutoriales';

/** Cantidad de piezas por lado (tablero de 3 x 3 = 8 piezas + un hueco). */
const LADO = 3;
const CASILLAS = LADO * LADO;
/** Tamaño máximo (px) al que se ajusta la foto elegida. */
const LADO_MAXIMO_FOTO = 640;
/** Tamaño máximo (px) al que se ajusta la foto antes de recortarla. */
const MAXIMO_FUENTE_FOTO = 1600;

@Component({
  selector: 'app-rompecabezas',
  templateUrl: './rompecabezas.page.html',
  styleUrls: ['./rompecabezas.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonRange,
    TutorialJuegoComponent
  ]
})
export class RompecabezasPage implements OnDestroy {

  /** Evita repintar cuando la página ya fue destruida. */
  private destruido = false;

  /** True mientras se muestra el tutorial de "Cómo jugar". */
  mostrarTutorial = true;
  pasosTutorial = TUTORIAL_ROMPECABEZA;

  /** Estado del tablero: un número por casilla (0 = casilla vacía). */
  piezas: number[] = [];
  movimientos = 0;
  terminado = false;

  /** Imagen armada con <canvas>, usada como referencia y por pieza. */
  imagen = '';

  /** True cuando se usa una foto elegida por el usuario. */
  esFotoPropia = false;

  /** True cuando la sección de foto propia está desplegada. */
  fotoAbierta = false;

  // ---- Recorte interactivo de la foto ----
  /** Muestra la ventana para ajustar la foto. */
  recorteVisible = false;
  /** Foto cargada (reducida) para ajustar y recortar. */
  fotoSeleccionada = '';
  /** Zoom actual aplicado a la foto (1 = la cubre, máximo = ampliada). */
  zoom = 1;
  /** Zoom máximo permitido en el recorte. */
  zoomMaximo = 10;
  /** Desplazamiento en píxeles de la foto dentro del cuadrado. */
  despX = 0;
  despY = 0;

  private naturalAncho = 0;
  private naturalAlto = 0;
  private ladoLayoutAncho = 0;
  private ladoLayoutAlto = 0;
  private cuadroPx = 0;
  private baseF = 1;
  private arrastreId = -1;
  private inicioX = 0;
  private inicioY = 0;
  private inicioDespX = 0;
  private inicioDespY = 0;
  /** Dedos actualmente sobre la foto durante el ajuste. */
  private punteros = new Map<number, { x: number; y: number }>();
  /** Distancia entre los dos dedos al empezar el pellizco. */
  private distanciaPellizco = 0;
  /** Zoom al empezar el pellizco. */
  private zoomPellizco = 1;

  @ViewChild('selectorCamara') selectorCamara!: ElementRef<HTMLInputElement>;
  @ViewChild('selectorGaleria') selectorGaleria!: ElementRef<HTMLInputElement>;
  @ViewChild('cuadroRecorte') cuadroRecorte!: ElementRef<HTMLDivElement>;
  @ViewChild('imagenRecorte') imagenRecorte!: ElementRef<HTMLImageElement>;

  constructor(private router: Router, private cdr: ChangeDetectorRef) {
    addIcons({ arrowBack, cameraOutline, imagesOutline, refreshOutline, removeOutline, addOutline, checkmarkDoneOutline, chevronDownOutline, chevronUpOutline, swapHorizontalOutline, helpCircleOutline });
    this.imagen = this.generarImagen();
    this.jugarDeNuevo();
  }

  /** Abre la cámara del dispositivo para tomar una foto. */
  abrirCamara(): void {
    this.selectorCamara?.nativeElement.click();
  }

  /** Abre la galería para elegir una foto guardada. */
  abrirGaleria(): void {
    this.selectorGaleria?.nativeElement.click();
  }

  /** Lee el archivo elegido y abre la ventana para ajustar la foto. */
  onFotoSeleccionada(evento: Event, selector: HTMLInputElement): void {
    const archivo = selector.files?.[0];
    if (!archivo) {
      return;
    }
    // Permite volver a elegir la misma foto en la próxima partida.
    selector.value = '';

    const lector = new FileReader();
    lector.onload = () => {
      const original = lector.result as string;
      this.prepararFoto(original);
    };
    lector.readAsDataURL(archivo);
  }

  /**
   * Reduce la foto elegida (las cámaras generan imágenes muy grandes)
   * para que el recorte y el juego sigan siendo livianos.
   */
  private prepararFoto(original: string): void {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, MAXIMO_FUENTE_FOTO / Math.max(img.width, img.height));
      const ancho = Math.round(img.width * escala);
      const alto = Math.round(img.height * escala);

      const canvas = document.createElement('canvas');
      canvas.width = ancho;
      canvas.height = alto;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, ancho, alto);
        this.fotoSeleccionada = canvas.toDataURL('image/jpeg', 0.9);
      } else {
        this.fotoSeleccionada = original;
      }
      this.abrirRecorte();
    };
    img.onerror = () => {
      // Si la foto no se pudo leer, se conserva la imagen actual.
    };
    img.src = original;
  }

  /** Muestra el cuadrado de recorte para ajustar la parte que se armará. */
  abrirRecorte(): void {
    this.recorteVisible = true;
    this.zoom = 1;
    this.despX = 0;
    this.despY = 0;
    this.arrastreId = -1;
    this.punteros.clear();
    this.distanciaPellizco = 0;
    // Render manual: el ajuste se abre desde un callback asíncrono (FileReader/Image).
    this.cdr.detectChanges();
    // Se prepara si la imagen ya terminó de cargar; si no, el evento (load)
    // del <img> en la plantilla la prepara apenas esté lista.
    requestAnimationFrame(() => this.prepararRecorte());
  }

  /** Calcula el tamaño del cuadrado y aplica la posición inicial de la foto. */
  prepararRecorte(): void {
    const imagen = this.imagenRecorte?.nativeElement;
    const cuadro = this.cuadroRecorte?.nativeElement;
    if (!imagen || !cuadro || imagen.naturalWidth <= 0 || cuadro.clientWidth <= 0) {
      return;
    }
    this.naturalAncho = imagen.naturalWidth;
    this.naturalAlto = imagen.naturalHeight;
    // Se usa el tamaño visual (layout), no el de los píxeles reales: las fotos
    // de cámara traen densidad (EXIF) y en pantalla ocupan menos píxeles.
    this.ladoLayoutAncho = imagen.clientWidth;
    this.ladoLayoutAlto = imagen.clientHeight;
    this.cuadroPx = cuadro.clientWidth;
    // Escala base: la foto siempre cubre el cuadrado completo.
    this.baseF = this.cuadroPx / Math.min(this.ladoLayoutAncho, this.ladoLayoutAlto);
    this.aplicarRecorte();
  }

  /** Aplica la posición y escala actuales a la foto dentro del cuadrado. */
  private aplicarRecorte(): void {
    const imagen = this.imagenRecorte?.nativeElement;
    if (!imagen || this.ladoLayoutAncho <= 0) {
      return;
    }
    const escala = this.baseF * this.zoom;
    const anchoVisto = this.ladoLayoutAncho * escala;
    const altoVisto = this.ladoLayoutAlto * escala;

    // La foto no puede salirse del cuadrado.
    const maxX = Math.min(0, this.cuadroPx - anchoVisto);
    const maxY = Math.min(0, this.cuadroPx - altoVisto);
    this.despX = Math.max(maxX, Math.min(0, this.despX));
    this.despY = Math.max(maxY, Math.min(0, this.despY));

    imagen.style.transform = `translate(${this.despX}px, ${this.despY}px) scale(${escala})`;
  }

  /** Cambia el zoom con el control deslizante. */
  cambiarZoom(evento: Event): void {
    const valor = (evento as CustomEvent).detail.value as number | { lower: number; upper: number };
    const numero = typeof valor === 'number' ? valor : 1;
    // El control crece desde el centro del cuadrado.
    this.ajustarZoom(numero, this.cuadroPx / 2, this.cuadroPx / 2);
  }

  /**
   * Aplica un nuevo zoom manteniendo fijo el punto indicado (px, py) del
   * cuadrado: el contenido bajo ese punto sigue estando en el mismo lugar.
   */
  private ajustarZoom(nuevoZoom: number, px: number, py: number): void {
    nuevoZoom = Math.max(1, Math.min(this.zoomMaximo, nuevoZoom));
    if (this.zoom !== nuevoZoom && this.zoom > 0) {
      const ratio = nuevoZoom / this.zoom;
      this.despX = px - (px - this.despX) * ratio;
      this.despY = py - (py - this.despY) * ratio;
    }
    this.zoom = nuevoZoom;
    this.aplicarRecorte();
  }

  /** Empieza a arrastrar o a pellizcar la foto con los dedos. */
  marcarRecorte(evento: PointerEvent): void {
    evento.preventDefault();
    (evento.target as HTMLElement).setPointerCapture?.(evento.pointerId);
    this.punteros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });

    if (this.punteros.size === 1) {
      // Un dedo: arrastra la foto.
      this.arrastreId = evento.pointerId;
      this.inicioX = evento.clientX;
      this.inicioY = evento.clientY;
      this.inicioDespX = this.despX;
      this.inicioDespY = this.despY;
    } else if (this.punteros.size === 2) {
      // Dos dedos: empieza el pellizco para acercar o alejar.
      const [p1, p2] = [...this.punteros.values()];
      this.arrastreId = -1;
      this.distanciaPellizco = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      this.zoomPellizco = this.zoom;
    }
  }

  /** Mueve la foto: un dedo la arrastra, dos dedos la acercan o alejan. */
  moverRecorte(evento: PointerEvent): void {
    const dedo = this.punteros.get(evento.pointerId);
    if (!dedo) {
      return;
    }
    dedo.x = evento.clientX;
    dedo.y = evento.clientY;

    if (this.punteros.size === 2 && this.distanciaPellizco > 0) {
      const [p1, p2] = [...this.punteros.values()];
      const distancia = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const nuevo = this.zoomPellizco * (distancia / this.distanciaPellizco);
      // El zoom se hace desde el punto medio de los dos dedos.
      const cuadro = this.cuadroRecorte?.nativeElement;
      if (cuadro) {
        const rect = cuadro.getBoundingClientRect();
        this.ajustarZoom(nuevo, (p1.x + p2.x) / 2 - rect.left, (p1.y + p2.y) / 2 - rect.top);
      } else {
        this.ajustarZoom(nuevo, this.cuadroPx / 2, this.cuadroPx / 2);
      }
    } else if (this.arrastreId === evento.pointerId) {
      this.despX = this.inicioDespX + (evento.clientX - this.inicioX);
      this.despY = this.inicioDespY + (evento.clientY - this.inicioY);
      this.aplicarRecorte();
    }
  }

  /** Suelta un dedo. */
  soltarRecorte(evento: PointerEvent): void {
    this.punteros.delete(evento.pointerId);

    if (this.punteros.size < 2) {
      // Se reinicia la base para que el próximo pellizco parta desde el zoom actual.
      this.distanciaPellizco = 0;
    }
    if (this.punteros.size === 1) {
      // El dedo que queda retoma el arrastre.
      const [id, dedo] = [...this.punteros.entries()][0];
      this.arrastreId = id;
      this.inicioX = dedo.x;
      this.inicioY = dedo.y;
      this.inicioDespX = this.despX;
      this.inicioDespY = this.despY;
    } else if (this.punteros.size === 0) {
      this.arrastreId = -1;
    }
  }

  /** Genera la imagen final del rompecabeza con la parte elegida. */
  confirmarRecorte(): void {
    const imagen = this.imagenRecorte?.nativeElement;
    if (!imagen || this.naturalAncho <= 0) {
      return;
    }
    if (this.ladoLayoutAncho <= 0) {
      // No se había preparado el recorte (p. ej. imagen ya en caché): se calcula aquí.
      this.prepararRecorte();
      if (this.ladoLayoutAncho <= 0) {
        return;
      }
    }
    const escala = this.baseF * this.zoom;
    // Convierte el cuadrado que se ve en pantalla (px de layout) a píxeles
    // reales de la foto, para que el rompecabeza muestre exactamente lo marcado.
    const fuente = this.naturalAncho / this.ladoLayoutAncho;
    const origenX = (-this.despX / escala) * fuente;
    const origenY = (-this.despY / escala) * fuente;
    const tamano = (this.cuadroPx / escala) * fuente;

    const canvas = document.createElement('canvas');
    canvas.width = LADO_MAXIMO_FOTO;
    canvas.height = LADO_MAXIMO_FOTO;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      imagen,
      origenX,
      origenY,
      tamano,
      tamano,
      0,
      0,
      LADO_MAXIMO_FOTO,
      LADO_MAXIMO_FOTO
    );
    this.imagen = canvas.toDataURL('image/jpeg', 0.85);

    this.esFotoPropia = true;
    this.recorteVisible = false;
    this.arrastreId = -1;
    this.punteros.clear();

    // Carga la foto en el rompecabeza sin necesidad de "Revolver y reiniciar".
    this.jugarDeNuevo();
    this.cdr.detectChanges();
  }

  /** Cierra el recorte sin usarlo. */
  cerrarRecorte(): void {
    this.recorteVisible = false;
    this.arrastreId = -1;
    this.punteros.clear();
    this.distanciaPellizco = 0;
  }

  /** Posición de fondo para dibujar la pieza correcta de la imagen. */
  posPieza(pieza: number): string {
    const renglon = Math.floor((pieza - 1) / LADO);
    const columna = (pieza - 1) % LADO;
    return `${columna * 50}% ${renglon * 50}%`;
  }

  /** Indica si la casilla indicada queda al lado del hueco vacío. */
  esMovible(casilla: number): boolean {
    const vacia = this.piezas.indexOf(0);
    const fila = Math.floor(casilla / LADO);
    const col = casilla % LADO;
    const filaVacia = Math.floor(vacia / LADO);
    const colVacia = vacia % LADO;
    return Math.abs(fila - filaVacia) + Math.abs(col - colVacia) === 1;
  }

  /** Intenta mover la pieza que está en la casilla indicada. */
  mover(casilla: number): void {
    if (this.terminado || !this.esMovible(casilla)) {
      return;
    }

    const vacia = this.piezas.indexOf(0);
    // Intercambia pieza y casilla vacía.
    [this.piezas[casilla], this.piezas[vacia]] = [this.piezas[vacia], this.piezas[casilla]];
    this.movimientos++;


    if (this.estaOrdenado()) {
      setTimeout(() => {
        this.terminado = true;
        if (!this.destruido) {
          this.cdr.detectChanges();
        }
      }, 350);
    }
  }

  /** Comprueba si las piezas quedaron en orden (imagen armada). */
  private estaOrdenado(): boolean {
    for (let i = 0; i < CASILLAS - 1; i++) {
      if (this.piezas[i] !== i + 1) {
        return false;
      }
    }
    return true;
  }

  /** Baraja el tablero y reinicia el contador de movimientos. */
  jugarDeNuevo(): void {
    this.movimientos = 0;
    this.terminado = false;

    do {
      this.piezas = Array.from({ length: CASILLAS }, (_, i) => (i + 1) % CASILLAS);
      // Se desordena moviendo piezas al azar (garantiza un juego resoluble).
      for (let paso = 0; paso < 300; paso++) {
        const vacia = this.piezas.indexOf(0);
        const vecinas = this.casillasVecinas(vacia);
        const destino = vecinas[Math.floor(Math.random() * vecinas.length)];
        [this.piezas[vacia], this.piezas[destino]] = [this.piezas[destino], this.piezas[vacia]];
      }
    } while (this.estaOrdenado());
  }

  /** Casillas adyacentes (arriba, abajo, izquierda, derecha). */
  private casillasVecinas(casilla: number): number[] {
    const fila = Math.floor(casilla / LADO);
    const col = casilla % LADO;
    const vecinas: number[] = [];
    if (fila > 0) { vecinas.push(casilla - LADO); }
    if (fila < LADO - 1) { vecinas.push(casilla + LADO); }
    if (col > 0) { vecinas.push(casilla - 1); }
    if (col < LADO - 1) { vecinas.push(casilla + 1); }
    return vecinas;
  }

  /** Dibuja un paisaje (cielo, sol, montañas, lago y flores) y lo vuelve imagen. */
  private generarImagen(): string {
    const tam = 600;
    const canvas = document.createElement('canvas');
    canvas.width = tam;
    canvas.height = tam;
    const ctx = canvas.getContext('2d'); 
    if (!ctx) {
      return '';
    }

    // Cielo con degradado.
    const cielo = ctx.createLinearGradient(0, 0, 0, tam);
    cielo.addColorStop(0, '#7ec8f7');
    cielo.addColorStop(0.65, '#fdf1d0');
    ctx.fillStyle = cielo;
    ctx.fillRect(0, 0, tam, tam);

    // Sol con resplandor.
    ctx.fillStyle = 'rgba(255, 212, 59, 0.35)';
    ctx.beginPath();
    ctx.arc(480, 130, 95, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd43b';
    ctx.beginPath();
    ctx.arc(480, 130, 58, 0, Math.PI * 2);
    ctx.fill();

    // Montañas del fondo.
    ctx.fillStyle = '#7aa678';
    ctx.beginPath();
    ctx.moveTo(-40, 430);
    ctx.lineTo(200, 190);
    ctx.lineTo(420, 430);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5c8a5e';
    ctx.beginPath();
    ctx.moveTo(240, 430);
    ctx.lineTo(430, 250);
    ctx.lineTo(660, 430);
    ctx.closePath();
    ctx.fill();

    // Lago.
    const lago = ctx.createLinearGradient(0, 430, 0, 620);
    lago.addColorStop(0, '#58b0e8');
    lago.addColorStop(1, '#2f81c4');
    ctx.fillStyle = lago;
    ctx.fillRect(0, 430, tam, 170);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(120, 500);
    ctx.quadraticCurveTo(160, 470, 210, 500);
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.stroke();

    // Franja de césped al pie.
    ctx.fillStyle = '#4d9e4f';
    ctx.fillRect(0, 560, tam, 40);

    // Flores.
    const flores = [
      { x: 70, y: 545 },
      { x: 120, y: 570 },
      { x: 180, y: 552 },
      { x: 250, y: 575 },
      { x: 330, y: 548 },
      { x: 520, y: 555 }
    ];
    for (const flor of flores) {
      ctx.fillStyle = '#ff8787';
      for (let petalo = 0; petalo < 5; petalo++) {
        const angulo = (petalo / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(
          flor.x + Math.cos(angulo) * 9,
          flor.y + Math.sin(angulo) * 9,
          7,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.fillStyle = '#fff3bf';
      ctx.beginPath();
      ctx.arc(flor.x, flor.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas.toDataURL('image/png');
  }

  /** Vuelve a la lista de juegos. */
  volver(): void {
    void this.router.navigate(['/juegos']);
  }

  ngOnDestroy(): void {
    this.destruido = true;
  }
}
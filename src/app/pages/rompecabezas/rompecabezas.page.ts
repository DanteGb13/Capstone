import { Component } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowBack, imageOutline, refreshOutline } from 'ionicons/icons';

/** Cantidad de piezas por lado (tablero de 3 x 3 = 8 piezas + un hueco). */
const LADO = 3;
const CASILLAS = LADO * LADO;

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
    IonIcon
  ]
})
export class RompecabezasPage {

  /** Estado del tablero: un número por casilla (0 = casilla vacía). */
  piezas: number[] = [];
  movimientos = 0;
  terminado = false;

  /** Imagen armada con <canvas>, usada como referencia y por pieza. */
  imagen = '';

  constructor(private router: Router) {
    addIcons({ arrowBack, imageOutline, refreshOutline });
    this.imagen = this.generarImagen();
    this.jugarDeNuevo();
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
}
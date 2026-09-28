import { Injectable, inject } from '@angular/core';

import { HistorialDesplazamiento } from '../historial-desplazamiento/historial-desplazamiento';
import { esCoordenadaValida, haversineMetros } from '../../geo/geo';


const DISTANCIA_INICIO_M = 25;

const DISTANCIA_PUNTO_M = 10;

const INTERVALO_PUNTO_MS = 60000;

const PARADO_CIERRE_MS = 5 * 60000;

const HUECO_MAXIMO_MS = 5 * 60000;

const ACTIVO_MAXIMO_MS = 6 * 60 * 60000;


interface Fix {
  lat: number;
  lng: number;
  ts: number;
}


interface EstadoTracker {
  idUsuario: string | null;
  idDesplazamiento: string | null;
  orden: number;
  ultimoFix: Fix | null;
  ultimoGuardado: Fix | null;
  ultimoMovimiento: number;
}


function estadoVacio(idUsuario: string | null): EstadoTracker {
  return {
    idUsuario,
    idDesplazamiento: null,
    orden: 0,
    ultimoFix: null,
    ultimoGuardado: null,
    ultimoMovimiento: Date.now()
  };
}


@Injectable({
  providedIn: 'root'
})
export class DesplazamientoTracker {

  private historial = inject(HistorialDesplazamiento);

  private estado: EstadoTracker = estadoVacio(null);

  private cola: Promise<void> = Promise.resolve();


  /**
   * Se llama al abrir el panel del adulto: si quedó un desplazamiento
   * activo de una sesión anterior, se reanuda o se cierra.
   */
  async revisarArranque(idUsuario: string): Promise<void> {
    if (!idUsuario) return;

    this.encolar(() => this.evaluarArranque(idUsuario));
    await this.cola;
  }


  /**
   * Entra un fix del GPS. Todo se serializa en una cola para que dos
   * reportes simultáneos no abran dos desplazamientos.
   *
   * `ahora` es opcional: permite simular el paso del tiempo en pruebas.
   */
  procesar(
    idUsuario: string,
    lat: number,
    lng: number,
    precision?: number,
    ahora: number = Date.now()
  ): Promise<void> {
    this.encolar(() => this.evaluarFix(idUsuario, lat, lng, precision, ahora));
    return this.cola;
  }


  private encolar(tarea: () => Promise<void>) {
    this.cola = this.cola.then(tarea).catch((error) => {
      console.error('Error en el seguimiento de desplazamiento:', error);
    });
  }


  private async evaluarArranque(idUsuario: string): Promise<void> {
    const activo = await this.historial.obtenerDesplazamientoActivo(idUsuario);

    if (!activo) {
      this.estado = estadoVacio(idUsuario);
      return;
    }

    const inicio = Date.parse(activo.fecha_inicio);
    const ahora = Date.now();

    if (!Number.isFinite(inicio) || ahora - inicio > ACTIVO_MAXIMO_MS) {
      await this.historial.finalizarDesplazamiento(activo.id);
      this.estado = estadoVacio(idUsuario);
      return;
    }

    const puntos = activo.puntos || [];
    const ultimo = puntos[puntos.length - 1];
    const tsUltimo = ultimo ? Date.parse(ultimo.fecha) : NaN;

    this.estado = {
      idUsuario,
      idDesplazamiento: activo.id,
      orden: puntos.length,
      ultimoFix: ultimo
        ? { lat: ultimo.latitud, lng: ultimo.longitud, ts: tsUltimo }
        : null,
      ultimoGuardado: ultimo
        ? { lat: ultimo.latitud, lng: ultimo.longitud, ts: tsUltimo }
        : null,
      ultimoMovimiento: Number.isFinite(tsUltimo) ? tsUltimo : inicio
    };
  }


  private async evaluarFix(
    idUsuario: string,
    lat: number,
    lng: number,
    precision: number | undefined,
    ahora: number
  ): Promise<void> {
    if (!idUsuario || !esCoordenadaValida(lat, lng)) return;

    if (this.estado.idUsuario !== idUsuario) {
      this.estado = estadoVacio(idUsuario);
    }

    const anterior = this.estado.ultimoFix;
    const distancia = anterior
      ? haversineMetros(anterior.lat, anterior.lng, lat, lng)
      : 0;
    const hueco = anterior ? ahora - anterior.ts : 0;

    if (!this.estado.idDesplazamiento) {
      if (anterior && distancia >= DISTANCIA_INICIO_M && hueco <= HUECO_MAXIMO_MS) {
        await this.abrir(idUsuario, lat, lng, precision, ahora);
      } else {
        this.estado.ultimoFix = { lat, lng, ts: ahora };
      }
      return;
    }

    if (hueco > HUECO_MAXIMO_MS) {
      await this.cerrar();
      this.estado.ultimoFix = { lat, lng, ts: ahora };
      return;
    }

    const guardado = this.estado.ultimoGuardado;

    if (guardado) {
      const distGuardado = haversineMetros(guardado.lat, guardado.lng, lat, lng);
      const desdeGuardado = ahora - guardado.ts;
      const porMovimiento = distGuardado >= DISTANCIA_PUNTO_M;
      const porTiempo = desdeGuardado >= INTERVALO_PUNTO_MS && distGuardado >= 1;

      if (porMovimiento || porTiempo) {
        const guardo = await this.historial.agregarPunto(
          this.estado.idDesplazamiento,
          { latitud: lat, longitud: lng },
          precision,
          this.estado.orden + 1
        );

        if (guardo) {
          this.estado.orden++;
          this.estado.ultimoGuardado = { lat, lng, ts: ahora };

          if (porMovimiento) {
            this.estado.ultimoMovimiento = ahora;
          }
        }
      }
    }

    this.estado.ultimoFix = { lat, lng, ts: ahora };

    if (ahora - this.estado.ultimoMovimiento >= PARADO_CIERRE_MS) {
      await this.cerrar();
    }
  }


  private async abrir(
    idUsuario: string,
    lat: number,
    lng: number,
    precision: number | undefined,
    ahora: number
  ): Promise<void> {
    const desplazamiento = await this.historial.iniciarDesplazamiento(
      idUsuario,
      { latitud: lat, longitud: lng }
    );

    if (!desplazamiento?.id) {
      this.estado.ultimoFix = { lat, lng, ts: ahora };
      return;
    }

    this.estado = {
      idUsuario,
      idDesplazamiento: desplazamiento.id,
      orden: 1,
      ultimoFix: { lat, lng, ts: ahora },
      ultimoGuardado: { lat, lng, ts: ahora },
      ultimoMovimiento: ahora
    };
  }


  private async cerrar(): Promise<void> {
    const id = this.estado.idDesplazamiento;
    const idUsuario = this.estado.idUsuario;

    this.estado = estadoVacio(idUsuario);

    if (id) {
      await this.historial.finalizarDesplazamiento(id);
    }
  }

}

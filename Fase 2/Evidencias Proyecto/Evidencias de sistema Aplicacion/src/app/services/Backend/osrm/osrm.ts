import { Injectable } from '@angular/core';

export interface PuntoRuta {
  latitud: number;
  longitud: number;
}

export interface ResultadoRuta {
  distanciaMetros: number;
  duracionSegundos: number;
  geometria: any;
  coordenadas: PuntoRuta[];
}

@Injectable({
  providedIn: 'root'
})
export class Osrm {

  private readonly BASE_URL = 'https://router.project-osrm.org';

  async obtenerRuta(puntos: PuntoRuta[]): Promise<ResultadoRuta | null> {
    if (puntos.length < 2) {
      return null;
    }

    const coords = puntos
      .map(p => `${p.longitud},${p.latitud}`)
      .join(';');

    const url = `${this.BASE_URL}/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.warn('OSRM respondió con error:', response.status);
        return null;
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        console.warn('OSRM no encontró ruta:', data.code);
        return null;
      }

      const ruta = data.routes[0];
      const coordenadas: PuntoRuta[] = (ruta.geometry?.coordinates || []).map(
        (c: number[]) => ({ latitud: c[1], longitud: c[0] })
      );

      return {
        distanciaMetros: Math.round(ruta.distance),
        duracionSegundos: Math.round(ruta.duration),
        geometria: ruta.geometry,
        coordenadas
      };
    } catch (error) {
      console.error('Error consultando OSRM:', error);
      return null;
    }
  }


  async obtenerDistanciaYTiempo(origen: PuntoRuta, destino: PuntoRuta): Promise<{ metros: number; segundos: number } | null> {
    const resultado = await this.obtenerRuta([origen, destino]);
    if (!resultado) return null;
    return {
      metros: resultado.distanciaMetros,
      segundos: resultado.duracionSegundos
    };
  }


  async reconstruirRuta(waypoints: PuntoRuta[]): Promise<ResultadoRuta | null> {
    if (waypoints.length < 2) {
      return null;
    }

    const coords = waypoints
      .map(p => `${p.longitud},${p.latitud}`)
      .join(';');

    const url = `${this.BASE_URL}/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=false`;

    try {
      const response = await fetch(url);

      if (!response.ok) return null;

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        return null;
      }

      const ruta = data.routes[0];
      const coordenadas: PuntoRuta[] = (ruta.geometry?.coordinates || []).map(
        (c: number[]) => ({ latitud: c[1], longitud: c[0] })
      );

      return {
        distanciaMetros: Math.round(ruta.distance),
        duracionSegundos: Math.round(ruta.duration),
        geometria: ruta.geometry,
        coordenadas
      };
    } catch (error) {
      console.error('Error reconstruyendo ruta con OSRM:', error);
      return null;
    }
  }
}

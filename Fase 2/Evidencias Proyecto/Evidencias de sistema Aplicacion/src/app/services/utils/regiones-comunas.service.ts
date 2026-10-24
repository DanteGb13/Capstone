import { Injectable } from '@angular/core';

/** Región de Chile con sus comunas (sólo nombres, como las guarda el perfil). */
export interface RegionChile {
  id: string;
  nombre: string;
  comunas: string[];
}

const CLAVE_CACHE = 'sc_dpa_v1';
const REGIONES_OFICIALES = 16;
const ASSET = 'assets/division-administrativa-chile.json';

/**
 * Regiones y comunas de Chile.
 *
 * Los datos vienen embebidos en la app (assets/division-administrativa-chile.json),
 * así que el registro y la edición de dirección funcionan siempre, sin red.
 * En la primera carga se guarda una copia en localStorage para acceso más
 * rápido en las siguientes sesiones.
 */
@Injectable({ providedIn: 'root' })
export class RegionesComunasService {

  private enMemoria: RegionChile[] | null = null;
  private enVuelo: Promise<RegionChile[]> | null = null;

  /** Las 16 regiones con sus comunas, de norte a sur. */
  async regiones(): Promise<RegionChile[]> {
    if (this.enMemoria) return this.enMemoria;

    const cache = this.leerCache();
    if (cache.length >= REGIONES_OFICIALES) {
      this.enMemoria = cache;
      return cache;
    }

    if (this.enVuelo) return this.enVuelo;

    this.enVuelo = this.cargarAsset();
    try {
      const datos = await this.enVuelo;
      if (datos.length < REGIONES_OFICIALES) {
        throw new Error('No se pudieron cargar las regiones y comunas.');
      }
      this.enMemoria = datos;
      this.guardarCache(datos);
      return datos;
    } catch (e: any) {
      if (e?.message?.includes('No se pudieron cargar')) throw e;
      throw new Error('No se pudieron cargar las regiones y comunas.');
    } finally {
      this.enVuelo = null;
    }
  }

  /** Comunas de una región, buscadas por el nombre tal como se guarda en el perfil. */
  async comunasDe(regionNombre: string): Promise<string[]> {
    const regiones = await this.regiones();
    return regiones.find((r) => r.nombre === regionNombre)?.comunas ?? [];
  }

  /** Limpia la caché local (para tests). */
  limpiar(): void {
    this.enMemoria = null;
    try {
      localStorage.removeItem(CLAVE_CACHE);
    } catch {
      // sin almacenamiento local no hay nada que borrar
    }
  }

  // =====================================================
  // CARGA DESDE ASSETS
  // =====================================================

  private async cargarAsset(): Promise<RegionChile[]> {
    const respuesta = await fetch(ASSET);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const json = await respuesta.json();
    const bruto = Array.isArray(json) ? json : [];
    return bruto
      .map((r: any) => ({
        id: String(r?.id ?? '').trim(),
        nombre: String(r?.nombre ?? '').trim(),
        comunas: Array.isArray(r?.comunas)
          ? r.comunas.map((c: any) => String(c).trim()).filter((c: string) => c.length > 0)
          : [],
      }))
      .filter((r: RegionChile) => r.nombre.length > 0 && r.comunas.length > 0);
  }

  // =====================================================
  // ALMACENAMIENTO
  // =====================================================

  private leerCache(): RegionChile[] {
    try {
      const bruto = localStorage.getItem(CLAVE_CACHE);
      if (!bruto) return [];
      const datos = JSON.parse(bruto);
      if (!Array.isArray(datos)) return [];
      return datos.filter(
        (r: any) => typeof r?.nombre === 'string' && Array.isArray(r?.comunas)
      );
    } catch {
      return [];
    }
  }

  private guardarCache(datos: RegionChile[]): void {
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify(datos));
    } catch {
      // sin almacenamiento local se relee el asset cada vez
    }
  }
}

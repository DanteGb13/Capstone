import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../supabase/supabase';

/** Lo mínimo que se necesita para pintar la cabecera de cualquier panel. */
export interface PerfilResumen {
  id: string;
  nombre: string;
  apellidos: string;
  nombreCompleto: string;
  telefono: string;
  correo: string;
  fotoUrl: string | null;
  /** Rol: 'Usuario' (adulto mayor) o 'Familiar' (cuidador). */
  rol: string | null;
}

interface PerfilCacheEntry {
  perfil: PerfilResumen;
  guardadoEn: number;
}

const CLAVE_CACHE = 'sc_perfil_cache';
const CLAVE_FOTO = 'sc_foto_cache';

/** La foto cambia muy rara vez: se cachea aparte y con más margen. */
const TTL_PERFIL_MS = 5 * 60 * 1000;
const TTL_FOTO_MS = 60 * 60 * 1000;

/**
 * Perfil del usuario en caché.
 *
 * Antes, cada panel llamaba dos veces a `auth.getUser()`, que va a la red
 * aunque la sesión esté en el teléfono, y encima lo hacía en serie: primero
 * el nombre, después la foto, después el resto. Eso son varios viajes antes de
 * que aparezca el nombre en pantalla.
 *
 * Ahora:
 *  - el id sale de `getSession()`, que es local y instantáneo;
 *  - el perfil se pide una sola vez y se comparte entre paneles;
 *  - la foto se resuelve aparte y se cachea más tiempo.
 */
@Injectable({ providedIn: 'root' })
export class PerfilCacheService {

  private supabaseService = inject(SupabaseService);

  /** Perfil ya cargado en memoria. */
  private enMemoria: PerfilCacheEntry | null = null;

  /** Promesa en vuelo, para no disparar dos consultas a la vez. */
  private enVuelo: Promise<PerfilResumen | null> | null = null;

  // =====================================================
  // ID DE SESIÓN (local, sin red)
  // =====================================================

  /**
   * Id del usuario desde la sesión LOCAL.
   *
   * `getSession()` no va a la red: lee el token guardado en el teléfono.
   * `getUser()` sí va, y por eso usarlo para sacar el id retrasaba la apertura
   * de cada pantalla.
   */
  async idUsuario(): Promise<string | null> {
    try {
      const { data } = await this.supabaseService.getClient().auth.getSession();
      return data?.session?.user?.id ?? null;
    } catch {
      return null;
    }
  }

  // =====================================================
  // PERFIL
  // =====================================================

  /**
   * Perfil del usuario. Lo devuelve de inmediato si está en caché y va a la
   * base sólo cuando hace falta o venció.
   *
   * `forzar` se usa al volver del primer plano, para no mostrar el nombre de
   * la cuenta anterior si es que se cambió.
   */
  async perfil(forzar = false): Promise<PerfilResumen | null> {
    const id = await this.idUsuario();
    if (!id) {
      this.enMemoria = null;
      return null;
    }

    // La caché se guarda indexada por id: si la cuenta cambió, no se sirve la
    // anterior. Es el mismo tipo de fuga que el del token de push.
    const guardada = this.leerCache();
    if (!forzar && guardada && guardada.perfil.id === id) {
      const vigente = Date.now() - guardada.guardadoEn < TTL_PERFIL_MS;
      if (vigente) {
        this.enMemoria = guardada;
        return guardada.perfil;
      }
    }

    if (this.enVuelo) return this.enVuelo;

    this.enVuelo = this.cargarPerfil(id);
    try {
      return await this.enVuelo;
    } finally {
      this.enVuelo = null;
    }
  }

  private async cargarPerfil(id: string): Promise<PerfilResumen | null> {
    try {
      const supabase = this.supabaseService.getClient();

      const { data, error } = await supabase
        .from('usuario')
        .select(`
          id,
          nombre,
          apellidopa,
          apellidoma,
          telefono,
          correo,
          rol (nombre)
        `)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.warn('No se pudo cargar el perfil:', error.message);
        // Si hay algo en caché, es mejor mostrarlo viejo que una pantalla vacía.
        return this.enMemoria?.perfil.id === id ? this.enMemoria.perfil : null;
      }

      if (!data) return null;

      const rolData = data.rol as any;
      const rol = Array.isArray(rolData) ? rolData[0]?.nombre ?? null : rolData?.nombre ?? null;

      const nombre = (data.nombre ?? '').trim();
      const apellidoPaterno = (data.apellidopa ?? '').trim();
      const apellidoMaterno = (data.apellidoma ?? '').trim();

      const perfil: PerfilResumen = {
        id: data.id,
        nombre,
        apellidos: [apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
        nombreCompleto: [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
        telefono: data.telefono ?? '',
        correo: data.correo ?? '',
        fotoUrl: null,
        rol
      };

      this.enMemoria = { perfil, guardadoEn: Date.now() };
      this.guardarCache(this.enMemoria);

      // La foto se resuelve después y no bloquea al nombre.
      this.cargarFoto(id).then((url) => {
        if (url && this.enMemoria?.perfil.id === id) {
          this.enMemoria = { ...this.enMemoria, perfil: { ...this.enMemoria.perfil, fotoUrl: url } };
        }
      });

      return perfil;
    } catch (e) {
      console.warn('Error cargando el perfil:', e);
      return null;
    }
  }

  // =====================================================
  // FOTO
  // =====================================================

  /**
   * URL firmada de la foto de perfil.
   *
   * Son dos viajes a Supabase Storage (listar + firmar). Con la caché, sólo
   * ocurren la primera vez por hora en vez de en cada entrada al panel.
   */
  async cargarFoto(idUsuario: string): Promise<string | null> {
    if (!idUsuario) return null;

    const guardado = this.leerFoto(idUsuario);
    if (guardado && Date.now() - guardado.guardadoEn < TTL_FOTO_MS) {
      return guardado.url;
    }

    try {
      const supabase = this.supabaseService.getClient();

      const { data, error } = await supabase.storage
        .from('fotos-perfil')
        .list(`${idUsuario}/`, { limit: 1 });

      if (error) return null;
      if (!data || data.length === 0) {
        this.guardarFoto(idUsuario, null);
        return null;
      }

      const { data: firmada, error: errorFirma } = await supabase.storage
        .from('fotos-perfil')
        .createSignedUrl(`${idUsuario}/${data[0].name}`, 3600);

      if (errorFirma || !firmada?.signedUrl) return null;

      this.guardarFoto(idUsuario, firmada.signedUrl);
      return firmada.signedUrl;
    } catch {
      return null;
    }
  }

  // =====================================================
  // INVALIDACIÓN
  // =====================================================

  /**
   * Borra la caché. OBLIGATORIO al cerrar sesión o cambiar de cuenta: si no, la
   * app muestra el nombre y la foto de la cuenta anterior.
   */
  limpiar(): void {
    this.enMemoria = null;
    this.enVuelo = null;
    try {
      localStorage.removeItem(CLAVE_CACHE);
      localStorage.removeItem(CLAVE_FOTO);
    } catch {
      // sin almacenamiento local no hay nada que borrar
    }
  }

  // =====================================================
  // ALMACENAMIENTO
  // =====================================================

  private leerCache(): PerfilCacheEntry | null {
    try {
      const bruto = localStorage.getItem(CLAVE_CACHE);
      return bruto ? (JSON.parse(bruto) as PerfilCacheEntry) : null;
    } catch {
      return null;
    }
  }

  private guardarCache(entry: PerfilCacheEntry): void {
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify(entry));
    } catch {
      // si no se puede guardar, el trabajo de red no se repite igual por el
      // caché en memoria, así que no es grave
    }
  }

  private leerFoto(id: string): { url: string | null; guardadoEn: number } | null {
    try {
      const bruto = localStorage.getItem(CLAVE_FOTO);
      if (!bruto) return null;
      const datos = JSON.parse(bruto);
      if (datos?.id !== id) return null;
      return { url: datos.url ?? null, guardadoEn: datos.guardadoEn ?? 0 };
    } catch {
      return null;
    }
  }

  private guardarFoto(id: string, url: string | null): void {
    try {
      localStorage.setItem(CLAVE_FOTO, JSON.stringify({ id, url, guardadoEn: Date.now() }));
    } catch {
      // ver guardarCache
    }
  }
}

import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
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

  // ── Los campos siguientes los necesita la pantalla de Perfil ───────────────
  // Son opcionales a propósito: el resto de pantallas (los dos paneles) no los
  // usan, y agregarlos como requeridos obligaría a tocarlas.

  /** Apellidos por separado: el formulario los valida y los guarda uno por uno. */
  apellidopa?: string;
  apellidoma?: string;
  rut?: string;
  fechaNacimiento?: string | null;

  /** Para actualizar la dirección por separado (tabla `direccion`). */
  idDireccion?: string | null;
  direccion?: PerfilDireccion | null;

  /**
   * `usuario.id_rol`. La pantalla de Perfil lo usa para el texto de "cuenta"
   * ("Adulto Mayor" / "Cuidador") cuando el rol no viene legible, así que hace
   * falta traerlo: sin él, un adulto mayor se mostraría como cuidador.
   */
  idRol?: number | null;
}

/** Dirección de la persona, tal como la guarda el perfil. */
export interface PerfilDireccion {
  region?: string;
  comuna?: string;
  calle?: string;
  numero?: string;
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

  /**
   * Avisa de que el perfil o la foto cambiaron.
   *
   * Sin esto, quien cambia su foto desde Mi Perfil seguía viendo la anterior
   * en la barra superior hasta navegar a otra página (cada página monta su
   * propio `app-web-nav`, y sólo se crea uno nuevo al cambiar de ruta).
   */
  private readonly notificador = new Subject<void>();

  /** Emite cada vez que se invalida o se actualiza el perfil. */
  readonly cambios$: Observable<void> = this.notificador.asObservable();

  private supabaseService = inject(SupabaseService);

  /** Perfil ya cargado en memoria. */
  private enMemoria: PerfilCacheEntry | null = null;

  /** Promesa en vuelo, para no disparar dos consultas a la vez. */
  private enVuelo: Promise<PerfilResumen | null> | null = null;

  private fotosEnMemoria = new Map<string, string | null>();

  /**
   * Lo mismo para la foto. Va con el id de usuario porque la promesa es de una
   * persona concreta: si cambia la cuenta, la otra promesa no le sirve.
   */
  private fotoEnVuelo: { idUsuario: string; promesa: Promise<string | null> } | null = null;

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
        // La caché se guarda ANTES de resolver la foto, así que en la segunda
        // carga el perfil viene sin ella: se pide igual y se pinta cuando
        // llegue. Sin esto el avatar del navbar nunca mostraría la foto.
        this.completarFoto(guardada.perfil);
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
        // Antes eram 8 columnas y faltaban la fecha de nacimiento y la
        // dirección, que son justamente los campos que edita la pantalla de
        // Perfil. Iba a buscar esos por su cuenta en otro viaje, y con esto
        // sigue siendo un solo viaje.
        .select(`
          id,
          nombre,
          apellidopa,
          apellidoma,
          telefono,
          correo,
          rut,
          fecha_nacimiento,
          id_direccion,
          id_rol,
          direccion (
            region,
            comuna,
            calle,
            numero
          ),
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

      // Supabase devuelve las relaciones 1 a 1 como arreglo a veces.
      const dirData = data.direccion as any;
      const direccion: PerfilDireccion | null = Array.isArray(dirData)
        ? (dirData[0] ?? null)
        : (dirData ?? null);

      const perfil: PerfilResumen = {
        id: data.id,
        nombre,
        apellidos: [apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
        nombreCompleto: [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
        telefono: data.telefono ?? '',
        correo: data.correo ?? '',
        fotoUrl: null,
        rol,
        apellidopa: apellidoPaterno,
        apellidoma: apellidoMaterno,
        rut: data.rut ?? '',
        fechaNacimiento: data.fecha_nacimiento ?? null,
        idDireccion: (data.id_direccion as string | null) ?? null,
        idRol: (data.id_rol as number | null) ?? null,
        direccion: direccion
          ? {
            region: direccion.region ?? '',
            comuna: direccion.comuna ?? '',
            calle: direccion.calle ?? '',
            numero: direccion.numero ?? ''
          }
          : null
      };

      this.enMemoria = { perfil, guardadoEn: Date.now() };
      this.guardarCache(this.enMemoria);

      // La foto se resuelve después y no bloquea al nombre.
      this.completarFoto(perfil);

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
   * Completa la foto de un perfil que ya se entregó al llamador.
   *
   * Antes la URL se escribía sólo en `enMemoria`, con un objeto nuevo, así que
   * el objeto que el navbar o la página de perfil tenían en la mano seguía con
   * `fotoUrl: null` para siempre y la foto jamás aparecía. Ahora se actualiza
   * en el sitio.
   */
  private completarFoto(perfil: PerfilResumen): void {
    if (perfil.fotoUrl) return;

    void this.cargarFoto(perfil.id).then((url) => {
      if (!url) return;

      // El mismo objeto que ya tiene el llamador.
      perfil.fotoUrl = url;

      if (this.enMemoria?.perfil.id !== perfil.id) return;

      this.enMemoria = { ...this.enMemoria, perfil: { ...this.enMemoria.perfil, fotoUrl: url } };
      // Se vuelve a guardar para que la próxima carga no arranque de cero.
      this.guardarCache(this.enMemoria);
      // La barra ya tiene el perfil en la mano y se va a enterar sólo si se
      // le avisa: la foto llegó DESPUÉS de haberla pintado sin ella.
      this.notificador.next();
    });
  }

  /**
   * URL firmada de la foto de perfil.
   *
   * Son dos viajes a Supabase Storage (listar + firmar). Con la caché, sólo
   * ocurren la primera vez por hora en vez de en cada entrada al panel.
   */
  async cargarFoto(idUsuario: string): Promise<string | null> {
    if (!idUsuario) return null;

    const enMemoria = this.fotosEnMemoria.get(idUsuario);
    if (this.fotosEnMemoria.has(idUsuario)) return enMemoria ?? null;

    const guardado = this.leerFoto(idUsuario);
    if (guardado && Date.now() - guardado.guardadoEn < TTL_FOTO_MS) {
      return guardado.url;
    }

    // Sin este guardia, dos pantallas que piden la foto al mismo tiempo (o los
    // dos disparos de carga de una misma pantalla).each una hace su propio
    // `list()` + `createSignedUrl()`. Con el guardia, la segunda espera la misma
    // promesa: una sola ida a storage.
    if (this.fotoEnVuelo?.idUsuario === idUsuario) {
      return this.fotoEnVuelo.promesa;
    }

    const promesa = this.resolverFoto(idUsuario);
    this.fotoEnVuelo = { idUsuario, promesa };

    try {
      return await promesa;
    } finally {
      if (this.fotoEnVuelo?.promesa === promesa) {
        this.fotoEnVuelo = null;
      }
    }
  }

  /**
   * El trabajo pesado de `cargarFoto()`: lista el bucket, firma la URL y guarda
   * el resultado en caché.
   */
  private async resolverFoto(idUsuario: string): Promise<string | null> {
    try {
      const supabase = this.supabaseService.getClient();

      const { data, error } = await supabase.storage
        .from('fotos-perfil')
        .list(`${idUsuario}/`, { limit: 1 });

      if (error) {
        console.warn('No se pudo listar la foto de perfil:', error.message);
        return null;
      }
      if (!data || data.length === 0) {
        this.guardarFoto(idUsuario, null);
        return null;
      }

      const { data: firmada, error: errorFirma } = await supabase.storage
        .from('fotos-perfil')
        .createSignedUrl(`${idUsuario}/${data[0].name}`, 3600);

      if (errorFirma || !firmada?.signedUrl) {
        console.warn('No se pudo firmar la foto de perfil:', errorFirma?.message ?? 'URL no disponible');
        return null;
      }

      this.guardarFoto(idUsuario, firmada.signedUrl);
      this.fotosEnMemoria.set(idUsuario, firmada.signedUrl);
      return firmada.signedUrl;
    } catch (error) {
      console.warn('Error resolviendo la foto de perfil:', error);
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
    this.fotosEnMemoria.clear();
    try {
      localStorage.removeItem(CLAVE_CACHE);
      for (let indice = localStorage.length - 1; indice >= 0; indice--) {
        const clave = localStorage.key(indice);
        if (clave?.startsWith(`${CLAVE_FOTO}_`)) localStorage.removeItem(clave);
      }
    } catch {
      // sin almacenamiento local no hay nada que borrar
    }
    this.notificador.next();
  }

  /**
   * Borra sólo la foto cacheada.
   *
   * Hace falta cuando la persona acaba de subir o de borrar su foto: la caché
   * dura una hora, así que sin esto el avatar seguiría mostrando la anterior
   * (o la que ya no existe) hasta que venciera el TTL. `limpiar()` no sirve
   * para esto porque tiraría también el perfil.
   */
  limpiarFoto(): void {
    try {
      for (let indice = localStorage.length - 1; indice >= 0; indice--) {
        const clave = localStorage.key(indice);
        if (clave?.startsWith(`${CLAVE_FOTO}_`)) localStorage.removeItem(clave);
      }
    } catch {
      // sin almacenamiento local no hay nada que borrar
    }
    this.fotosEnMemoria.clear();
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
      const bruto = localStorage.getItem(`${CLAVE_FOTO}_${id}`);
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
      localStorage.setItem(`${CLAVE_FOTO}_${id}`, JSON.stringify({ id, url, guardadoEn: Date.now() }));
    } catch {
      // ver guardarCache
    }
    this.fotosEnMemoria.set(id, url);
  }

  obtenerFotoEnMemoria(idUsuario: string): string | null {
    return this.fotosEnMemoria.get(idUsuario) ?? null;
  }

  obtenerFotoGuardada(idUsuario: string): string | null {
    const guardada = this.leerFoto(idUsuario);
    if (!guardada || Date.now() - guardada.guardadoEn >= TTL_FOTO_MS) return null;

    if (guardada.url) this.fotosEnMemoria.set(idUsuario, guardada.url);
    return guardada.url;
  }
}

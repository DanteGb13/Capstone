import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { mensajeErrorApp } from '../../utils/mensaje-error';

const TABLA = 'contacto_emergencia';

/** Diccionario global de parentescos: sólo tiene id y nombre. */
const TABLA_RELACION = 'relacion';

/** Valor reservado del formulario para escribir un parentesco que no está en la lista. */
export const OTRO_PARENTESCO = '__otro__';

/** Columnas que la app necesita: traer '*' arrastra columnas viejas de la tabla. */
const CAMPOS =
  'id, id_usuario, nombre, apellidopa, apellidoma, telefono, correo, id_relacion';
const CAMPOS_ANTIGUOS = 'id, id_usuario, nombre, appellidopa, appellidoma, telefono, correo';

/** Postgres devuelve 42703 cuando la columna no existe. */
function esColumnaInexistente(mensaje?: string): boolean {
  return /column .* does not exist|42703/i.test(mensaje || '');
}

/** Deja el contacto siempre con las claves correctas, venga del nombre que venga. */
function normalizarContacto(fila: any): ContactoEmergencia {
  // En la base estas columnas están con el nombre viejo (doble L). Se leen
  // cualquiera de los dos y se devuelven con el nombre de la interfaz.
  const paterno = fila.apellidopa ?? fila.appellidopa ?? null;
  const materno = fila.apellidoma ?? fila.appellidoma ?? null;

  const contacto: ContactoEmergencia = {
    id: fila.id,
    id_usuario: fila.id_usuario,
    nombre: fila.nombre,
    telefono: fila.telefono,
    correo: fila.correo ?? null,
    id_relacion: fila.id_relacion ?? null
  };

  // Se asignan aparte para no escribir las claves una a una en el literal.
  contacto['apellidopa'] = paterno;
  contacto['apellidoma'] = materno;

  return contacto;
}

export interface ContactoEmergencia {
  id: string;
  id_usuario: string;
  nombre: string;
  apellidopa?: string | null;
  apellidoma?: string | null;
  telefono: string;
  correo?: string | null;
  id_relacion?: string | null;
}

/** Parentesco del diccionario global de la base. */
export interface Relacion {
  id: string;
  nombre: string;
}

/** Nombre completo del contacto (la tabla guarda nombre y apellidos aparte). */
export function nombreCompleto(contacto: {
  nombre?: string | null;
  apellidopa?: string | null;
  apellidoma?: string | null;
}): string {
  const fila = (contacto || {}) as Record<string, any>;
  const paterno = fila['apellidopa'] ?? fila['appellidopa'] ?? '';
  const materno = fila['apellidoma'] ?? fila['appellidoma'] ?? '';

  return `${fila['nombre'] || ''} ${paterno} ${materno}`.trim();
}

export interface ContactoPublico {
  nombre: string;
  telefono: string;
  descripcion: string;
  icono: string;
  color: string;
}

/**
 * Emergencias públicas de Chile: viven en la app (no en la BD) para que
 * funcionen aunque el teléfono esté sin datos o sin sesión.
 * Fuentes: chile.gob.cl / MINSAL / consulados.gob.cl (131, 132, 133, 134).
 */
export const CONTACTOS_PUBLICOS: ContactoPublico[] = [
  {
    nombre: 'Ambulancia (SAMU)',
    telefono: '131',
    descripcion: 'Emergencias médicas',
    icono: 'medkit-outline',
    color: '#00897b'
  },
  {
    nombre: 'Bomberos',
    telefono: '132',
    descripcion: 'Incendios y rescates',
    icono: 'flame-outline',
    color: '#e53935'
  },
  {
    nombre: 'Carabineros',
    telefono: '133',
    descripcion: 'Emergencias policiales',
    icono: 'shield-half-outline',
    color: '#2e7d32'
  },
  {
    nombre: 'Policía de Investigaciones',
    telefono: '134',
    descripcion: 'Denuncias e investigaciones',
    icono: 'search-outline',
    color: '#283593'
  }
];

/** Deja el teléfono listo para marcar (agrega +56 a móviles chilenos). */
export function telefonoParaMarcar(telefono: string): string {
  let tel = (telefono || '').replace(/[\s\-\(\)\+]/g, '');

  if (tel.length === 9 && tel.startsWith('9')) {
    tel = '+56' + tel;
  }

  return tel;
}

@Injectable({ providedIn: 'root' })
export class ContactosEmergenciaService {

  ultimoError: string = '';

  private supabaseService = inject(SupabaseService);

  /** Contactos de emergencia guardados por el usuario (sólo los suyos, por RLS). */
  async listar(idUsuario: string): Promise<ContactoEmergencia[]> {
    this.ultimoError = '';
    if (!idUsuario) return [];

    try {
      const supabase = this.supabaseService.getClient();

      let consulta: any = await supabase
        .from(TABLA)
        .select(CAMPOS)
        .eq('id_usuario', idUsuario)
        .order('nombre', { ascending: true });

      // Mientras la migración de nombres de columna no esté aplicada, se lee con
      // el nombre antiguo para no dejar al usuario sin sus contactos.
      if (consulta.error && esColumnaInexistente(consulta.error.message)) {
        consulta = await supabase
          .from(TABLA)
          .select(CAMPOS_ANTIGUOS)
          .eq('id_usuario', idUsuario)
          .order('nombre', { ascending: true });
      }

      if (consulta.error) {
        this.ultimoError = mensajeErrorApp(consulta.error);
        console.error('Error listando contactos de emergencia:', consulta.error.message);
        return [];
      }

      return ((consulta.data || []) as any[]).map(normalizarContacto);
    } catch (e: any) {
      this.ultimoError = e?.message || 'Error inesperado';
      console.error('Error listando contactos de emergencia:', e);
      return [];
    }
  }

  /** Guarda un contacto nuevo (el usuario sólo puede crear los suyos). */
  async agregar(datos: {
    id_usuario: string;
    nombre: string;
    apellidopa?: string;
    apellidoma?: string;
    telefono: string;
    correo?: string;
    id_relacion?: string;
  }): Promise<ContactoEmergencia | null> {
    this.ultimoError = '';

    const payload: any = {
      id_usuario: datos.id_usuario,
      nombre: (datos.nombre || '').trim(),
      telefono: (datos.telefono || '').trim()
    };
    if (datos.apellidopa && datos.apellidopa.trim()) {
      payload.apellidopa = datos.apellidopa.trim();
    }
    if (datos.apellidoma && datos.apellidoma.trim()) {
      payload.apellidoma = datos.apellidoma.trim();
    }
    if (datos.correo && datos.correo.trim()) {
      payload.correo = datos.correo.trim();
    }
    if (datos.id_relacion && datos.id_relacion.trim()) {
      payload.id_relacion = datos.id_relacion.trim();
    }

    try {
      const supabase = this.supabaseService.getClient();

      let consulta: any = await supabase
        .from(TABLA)
        .insert(payload)
        .select(CAMPOS)
        .maybeSingle();

      // Si la tabla todavía tiene las columnas con el nombre antiguo
      // ('appellidopa'), se reintenta con ese nombre.
      if (consulta.error && esColumnaInexistente(consulta.error.message)) {
        const payloadAntiguo: any = { ...payload };
        if (payloadAntiguo.apellidopa !== undefined) {
          payloadAntiguo.appellidopa = payloadAntiguo.apellidopa;
          delete payloadAntiguo.apellidopa;
        }
        if (payloadAntiguo.apellidoma !== undefined) {
          payloadAntiguo.appellidoma = payloadAntiguo.apellidoma;
          delete payloadAntiguo.apellidoma;
        }

        consulta = await supabase
          .from(TABLA)
          .insert(payloadAntiguo)
          .select(CAMPOS_ANTIGUOS)
          .maybeSingle();
      }

      // Si la tabla exige una columna que la app no envió (23502 = NOT NULL
      // sin valor), se reintenta dejándola vacía en vez de fallar.
      if (consulta.error && consulta.error.code === '23502') {
        const coincidencia = /column "([^"]+)"/.exec(consulta.error.message || '');
        const columna = coincidencia?.[1];

        if (columna && columna !== 'id' && payload[columna] === undefined) {
          payload[columna] = '';
          consulta = await supabase
            .from(TABLA)
            .insert(payload)
            .select(CAMPOS)
            .maybeSingle();
        }
      }

      if (consulta.error) {
        this.ultimoError = mensajeErrorApp(consulta.error);
        console.error('Error guardando contacto de emergencia:', consulta.error.message, consulta.error);
        return null;
      }

      return consulta.data ? normalizarContacto(consulta.data) : null;
    } catch (e: any) {
      this.ultimoError = e?.message || 'Error inesperado';
      console.error('Error guardando contacto de emergencia:', e);
      return null;
    }
  }

  /**
   * Parentescos que ya existen en la base (diccionario compartido).
   * Se guarda en memoria: es una tabla global que casi no cambia y pedirla en
   * cada visita sumaba una espera más antes de que apareciera el parentesco.
   */
  private cacheRelaciones: Relacion[] | null = null;

  async listarRelaciones(): Promise<Relacion[]> {
    if (this.cacheRelaciones) return this.cacheRelaciones;

    try {
      const { data, error } = await this.supabaseService.getClient()
        .from(TABLA_RELACION)
        .select('id, nombre')
        .order('nombre', { ascending: true });

      if (error) {
        // A propósito NO se escribe ultimoError: esta consulta corre en
        // paralelo con la de contactos y no debe pisar su mensaje de error.
        console.error('Error listando parentescos:', error.message);
        return [];
      }

      this.cacheRelaciones = ((data || []) as any[])
        .filter((fila) => fila && fila.id)
        .map((fila) => ({ id: fila.id, nombre: fila.nombre || '' }));

      return this.cacheRelaciones;
    } catch (e: any) {
      console.error('Error listando parentescos:', e);
      return [];
    }
  }

  /** Olvida los parentescos cargados (al deslizar para actualizar). */
  invalidarRelaciones() {
    this.cacheRelaciones = null;
  }

  /**
   * Devuelve el id de un parentesco, creándolo si todavía no existe.
   * Si la base no deja escribir en el diccionario devuelve null y deja el
   * motivo en ultimoError, para poder avisar sin frenar el guardado.
   */
  async resolverRelacion(nombre: string): Promise<string | null> {
    const buscado = (nombre || '').trim();
    if (!buscado) return null;

    // Limpia errores anteriores: el formulario mira este valor justo después.
    this.ultimoError = '';

    try {
      const supabase = this.supabaseService.getClient();
      const existentes = await this.listarRelaciones();

      const encontrada = existentes.find(
        (rel) => (rel.nombre || '').trim().toLowerCase() === buscado.toLowerCase()
      );
      if (encontrada) return encontrada.id;

      const { data, error } = await supabase
        .from(TABLA_RELACION)
        .insert({ nombre: buscado })
        .select('id')
        .maybeSingle();

      if (error) {
        this.ultimoError = mensajeErrorApp(error);
        console.error('Error guardando parentesco:', error.message);
        return null;
      }

      // Se agrega al caché recién consultado: si no, el desplegable del
      // formulario seguía sin mostrar el parentesco que se acaba de crear.
      if (data?.id && this.cacheRelaciones) {
        this.cacheRelaciones = [
          ...this.cacheRelaciones,
          { id: data.id, nombre: buscado }
        ].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
      }

      return data?.id ?? null;
    } catch (e: any) {
      this.ultimoError = e?.message || 'Error inesperado';
      console.error('Error guardando parentesco:', e);
      return null;
    }
  }

  /** Elimina un contacto del usuario. */
  async eliminar(id: string): Promise<boolean> {
    this.ultimoError = '';

    try {
      const { error } = await this.supabaseService.getClient()
        .from(TABLA)
        .delete()
        .eq('id', id);

      if (error) {
        this.ultimoError = mensajeErrorApp(error);
        console.error('Error eliminando contacto de emergencia:', error.message);
        return false;
      }

      return true;
    } catch (e: any) {
      this.ultimoError = e?.message || 'Error inesperado';
      console.error('Error eliminando contacto de emergencia:', e);
      return false;
    }
  }

}

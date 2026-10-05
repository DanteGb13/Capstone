import { Injectable, inject } from '@angular/core';

import { SupabaseService } from '../../supabase/supabase';


export type TipoEventoHistorial =
  | 'sos'
  | 'desplazamiento'
  | 'zona'
  | 'recordatorio'
  | 'salud'
  | 'manual'
  | 'llamada'
  | 'nota'
  | 'estado_casa'
  | 'ubicacion';


export interface EventoHistorialFila {
  id: string;
  id_usuario: string;
  tipo: TipoEventoHistorial;
  titulo: string;
  detalle: string | null;
  fecha: string;
  id_origen: string | null;
}


export interface EventoManualEntrada {
  id_usuario: string;
  tipo?: Extract<TipoEventoHistorial, 'manual' | 'llamada' | 'nota' | 'ubicacion'>;
  titulo: string;
  detalle?: string | null;
  fecha?: string;
  id_origen?: string | null;
}


/** Cómo se ve un metro recorrido según el tamaño. */
function metrosBonitos(metros: number): string {
  if (!isFinite(metros) || metros <= 0) return '0 m';

  if (metros < 1000) return `${Math.round(metros)} m`;

  return `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

/** "24 min", "1 h 05 min" */
function duracionBonita(segundos: number): string {
  const total = Math.max(0, Math.round(segundos / 60));

  if (total < 60) return `${total} min`;

  const horas = Math.floor(total / 60);
  const mins = total % 60;
  return mins === 0 ? `${horas} h` : `${horas} h ${String(mins).padStart(2, '0')} min`;
}


/** Fila de `sos_alerta`. */
interface FilaSos {
  id: string;
  id_adulto: string;
  creada_en: string;
  confirmada_en: string | null;
}

/** Fila de `historial_desplazamiento`. */
interface FilaDesplazamiento {
  id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  distancia_metros: number | null;
  duracion_segundos: number | null;
}

/** Fila de `zona_alerta`. */
interface FilaZona {
  id: string;
  fuera: boolean;
  primera_alerta: string | null;
  ultima_notificacion: string | null;
}

/** Fila de `alarma_recordatorio`. */
interface FilaRecordatorio {
  id: string;
  nombre: string;
  hora: number;
  minuto: number;
  confirmado: string | null;
}

/** Fila de `solicitud_vinculacion`. */
interface FilaVinculacion {
  id: string;
  estado: string;
  fecha_solicitud: string;
  fecha_respuesta: string | null;
}

/** Fila de `solicitud_actualizacion_salud`. */
interface FilaSolicitudSalud {
  id: string;
  solicitada_en: string;
  atendida_en: string | null;
  motivo: string | null;
}

/** Fila de `signos_vitales`. */
interface FilaSignosVitales {
  id: string;
  pasos: number | null;
  calorias: number | null;
  spo2: number | null;
  sueno_minutos: number | null;
  fuente: string | null;
  fecha_actualizacion: string;
}

/** Fila de `historial_evento`. */
interface FilaEventoManual {
  id: string;
  id_usuario: string;
  tipo: string;
  titulo: string;
  detalle: string | null;
  fecha: string;
  id_origen: string | null;
}


/**
 * Historial de una persona a cargo.
 *
 * ANTES: leía la vista `historial_eventos`, que no existe en la base de datos.
 * La consulta fallaba, el error se guardaba con un `console.warn` y el método
 * devolvía una lista vacía, así que la pantalla parecía no tener historial
 * aunque las tablas tuvieran todos los datos.
 *
 * AHORA: consulta en paralelo las tablas donde la app realmente escribe los
 * datos y las une acá. No hace falta tocar la base de datos: cada consulta pasa
 * por las RLS que ya valen en el resto de las pantallas, así que el cuidador
 * sigue viendo sólo a las personas que tiene vinculadas.
 *
 * Qué NO se usa, y por qué:
 *  - `ubicacion`: escribe una fila cada 30 segundos. Como evento es ruido y
 *    taparía los SOS, que es lo que importa. El movimiento ya está resumido y
 *    con sentido en `historial_desplazamiento`.
 *  - `signos_vitales`: es estado actual (una fila por persona, se sobrescribe),
 *    no historial. Se usa para mostrar la última lectura, no una serie.
 */
@Injectable({
  providedIn: 'root'
})
export class HistorialEventos {

  private supabaseService = inject(SupabaseService);

  private supabase = this.supabaseService.getClient();


  // =====================================================
  // LEER EL HISTORIAL
  // =====================================================

  /**
   * Eventos de un adulto, del más reciente al más antiguo.
   *
   * Las fuentes van en `Promise.all` a propósito: son independientes entre sí y
   * consultarlas en serie multiplicaría la espera por siete.
   *
   * Cada fuente trae un tope propio y se recorta al `limite` final después de
   * unir. Consultar 200 filas de cada tabla y quedarse con las 200 más
   * recientes del conjunto es lo que hace que la búsqueda por texto y los
   * filtros sigan funcionando bien.
   */
  async obtenerEventos(
    idUsuario: string,
    limite: number = 200,
    offset: number = 0
  ): Promise<EventoHistorialFila[]> {
    if (!idUsuario) return [];

    const [
      sos,
      desplazamientos,
      zonas,
      recordatorios,
      vinculaciones,
      solicitudesSalud,
      salud,
      manuales
    ] = await Promise.all([
      this.leerSos(idUsuario, limite),
      this.leerDesplazamientos(idUsuario, limite),
      this.leerZona(idUsuario),
      this.leerRecordatorios(idUsuario, limite),
      this.leerVinculaciones(idUsuario),
      this.leerSolicitudesSalud(idUsuario, limite),
      this.leerSalud(idUsuario),
      this.leerManuales(idUsuario, limite),
    ]);

    const todos = [
      ...sos,
      ...desplazamientos,
      ...zonas,
      ...recordatorios,
      ...vinculaciones,
      ...solicitudesSalud,
      ...salud,
      ...manuales
    ]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    return todos.slice(offset, offset + limite);
  }


  /**
   * Una consulta que no puede romper la pantalla entera.
   *
   * Cada tabla tiene sus permisos y puede faltar una migración. Si una falla se
   * devuelve una lista vacía y las demás siguen: es preferible mostrar 5 de 7
   * tipos de evento a mostrar cero.
   *
   * Se usa `PromiseLike` y no `Promise` porque el builder de PostgREST es un
   * "thenable", no una promesa.
   */
  private async leerSeguro<T>(
    etiqueta: string,
    tarea: () => PromiseLike<{ data: T[] | null; error: unknown }>
  ): Promise<T[]> {
    try {
      const { data, error } = await tarea();
      if (error) {
        console.warn(`[Historial] No se pudo leer ${etiqueta}:`, error);
        return [];
      }
      return data ?? [];
    } catch (e) {
      console.warn(`[Historial] Falló la lectura de ${etiqueta}:`, e);
      return [];
    }
  }


  // -------------------------------------------------------------
  // SOS
  // -------------------------------------------------------------

  private async leerSos(idUsuario: string, limite: number): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro<FilaSos>('las alertas SOS', () =>
      this.supabase
        .from('sos_alerta')
        .select('id, id_adulto, creada_en, confirmada_en')
        .eq('id_adulto', idUsuario)
        .order('creada_en', { ascending: false })
        .limit(limite)
    );

    return filas.map((f) => {
      const minutos = f.confirmada_en
        ? Math.round((Date.parse(f.confirmada_en) - Date.parse(f.creada_en)) / 60000)
        : null;

      return {
        id: `sos-${f.id}`,
        id_usuario: idUsuario,
        tipo: 'sos' as const,
        titulo: 'SOS activado',
        detalle:
          minutos === null
            ? 'Sin confirmar'
            : minutos <= 0
              ? 'Confirmada de inmediato'
              : `Confirmada ${minutos} min después`,
        fecha: f.creada_en,
        id_origen: f.id
      };
    });
  }


  // -------------------------------------------------------------
  // DESPLAZAMIENTOS (movimiento del teléfono)
  // -------------------------------------------------------------

  private async leerDesplazamientos(idUsuario: string, limite: number): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro<FilaDesplazamiento>('los desplazamientos', () =>
      this.supabase
        .from('historial_desplazamiento')
        .select('id, fecha_inicio, fecha_fin, distancia_metros, duracion_segundos')
        .eq('id_usuario', idUsuario)
        // Sólo los cerrados: uno en curso no tiene duración todavía y se
        // completaría en otra carga, moviéndose de lugar en la línea de tiempo.
        .eq('activo', false)
        .order('fecha_inicio', { ascending: false })
        .limit(limite)
    );

    return filas
      .map((f): EventoHistorialFila | null => {
        const distancia = Number(f.distancia_metros || 0);
        const duracion = Number(f.duracion_segundos || 0);

        // Menos de 30 m es ruido del GPS, no un recorrido.
        if (distancia < 30) return null;

        return {
          id: `desp-${f.id}`,
          id_usuario: idUsuario,
          tipo: 'desplazamiento',
          titulo: `Recorrido ${metrosBonitos(distancia)}`,
          detalle: `${duracionBonita(duracion)} · desde el teléfono`,
          fecha: f.fecha_inicio,
          id_origen: f.id
        };
      })
      .filter((e): e is EventoHistorialFila => e !== null);
  }


  // -------------------------------------------------------------
  // ZONA SEGURA
  // -------------------------------------------------------------

  /**
   * Estado actual de la zona segura.
   *
   * OJO, esto NO es un historial y no se puede arreglar desde la app:
   * `zona_alerta` guarda UNA fila por persona que se va sobrescribiendo
   * (`fuera`, `primera_alerta`, `ultima_notificacion`), y no tiene columna
   * `id_zona`, así que tampoco se sabe de qué zona se salió. Con lo que hay
   * sólo se puede mostrar la última salida.
   *
   * Se ofrecen las dos fechas que sí existen: cuándo empezó a estar fuera y
   * cuándo se le avisó por última vez.
   */
  private async leerZona(idUsuario: string): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro<FilaZona>('el estado de la zona segura', () =>
      this.supabase
        .from('zona_alerta')
        .select('id, fuera, primera_alerta, ultima_notificacion')
        .eq('id_usuario', idUsuario)
        .order('actualizada_en', { ascending: false })
        .limit(1)
    );

    const f = filas[0];
    if (!f || !f.fuera || !f.primera_alerta) return [];

    return [{
      id: `zona-${f.id}`,
      id_usuario: idUsuario,
      tipo: 'zona' as const,
      titulo: 'Salió de una zona segura',
      detalle: f.ultima_notificacion
        ? `Último aviso: ${new Date(f.ultima_notificacion).toLocaleString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
        : 'Sin aviso registrado',
      fecha: f.primera_alerta,
      id_origen: f.id
    }];
  }


  // -------------------------------------------------------------
  // RECORDATORIOS
  // -------------------------------------------------------------

  /**
   * Recordatorios confirmados.
   *
   * `confirmado` es la fecha en que el adulto resolvió la alarma, y ahí está el
   * dato de verdad: un recordatorio programado no es un evento, sólo lo es
   * cuando alguien lo confirmó. Por eso sólo se leen los que lo tienen.
   */
  private async leerRecordatorios(idUsuario: string, limite: number): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro<FilaRecordatorio>('los recordatorios', () =>
      this.supabase
        .from('alarma_recordatorio')
        .select('id, nombre, hora, minuto, confirmado')
        .eq('id_usuario', idUsuario)
        .not('confirmado', 'is', null)
        .order('confirmado', { ascending: false })
        .limit(limite)
    );

    return filas
      .filter((f): f is FilaRecordatorio & { confirmado: string } => !!f.confirmado)
      .map((f) => {
        const programado = `${String(f.hora).padStart(2, '0')}:${String(f.minuto).padStart(2, '0')}`;

        // Se compara contra la hora programada en la fecha en que se confirmó.
        // Con `setHours` se usa la fecha local, que es la del teléfono: la
        // alarma suena a la hora que ve la persona, no a la de UTC.
        const programadoEn = new Date(f.confirmado);
        programadoEn.setHours(f.hora, f.minuto, 0, 0);

        const atraso = Math.round(
          (Date.parse(f.confirmado) - programadoEn.getTime()) / 60000
        );

        return {
          id: `rec-${f.id}`,
          id_usuario: idUsuario,
          tipo: 'recordatorio' as const,
          titulo: `Confirmó: ${f.nombre}`,
          detalle:
            atraso > 0 && atraso < 180
              ? `Programado ${programado} · confirmado ${atraso} min después`
              : `Programado ${programado}`,
          fecha: f.confirmado,
          id_origen: f.id
        };
      });
  }


  // -------------------------------------------------------------
  // VINCULACIONES
  // -------------------------------------------------------------

  private async leerVinculaciones(idUsuario: string): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro('las solicitudes de vinculación', () =>
      this.supabase
        .from('solicitud_vinculacion')
        .select('id, estado, fecha_solicitud, fecha_respuesta')
        .eq('id_usuario', idUsuario)
        .order('fecha_solicitud', { ascending: false })
        .limit(20)
    );

    const textos: Record<string, string> = {
      pendiente: 'Esperando respuesta',
      aceptada: 'Vinculación aceptada',
      rechazada: 'Vinculación rechazada'
    };

    return filas.map((f) => {
      const titulo = f.estado === 'aceptada'
        ? 'Se vinculó un cuidador'
        : f.estado === 'rechazada'
          ? 'Rechazó una vinculación'
          : 'Pidió ser cuidado/a';

      return {
        id: `vin-${f.id}`,
        id_usuario: idUsuario,
        tipo: 'manual' as const,
        titulo,
        detalle: textos[f.estado] || f.estado,
        fecha: f.fecha_respuesta || f.fecha_solicitud,
        id_origen: f.id
      };
    });
  }


  // -------------------------------------------------------------
  // SOLICITUDES DE SALUD
  // -------------------------------------------------------------

  private async leerSolicitudesSalud(idUsuario: string, limite: number): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro<FilaSolicitudSalud>('las solicitudes de salud', () =>
      this.supabase
        .from('solicitud_actualizacion_salud')
        .select('id, solicitada_en, atendida_en, motivo')
        .eq('id_usuario', idUsuario)
        .order('solicitada_en', { ascending: false })
        .limit(limite)
    );

    return filas.map((f) => ({
      id: `ssal-${f.id}`,
      id_usuario: idUsuario,
      tipo: 'salud' as const,
      titulo: 'Pidió actualizar sus datos de salud',
      detalle: f.atendida_en
        ? `Atendida · ${f.motivo || 'sin motivo indicado'}`
        : `Pendiente · ${f.motivo || 'sin motivo indicado'}`,
      fecha: f.solicitada_en,
      id_origen: f.id
    }));
  }


  // -------------------------------------------------------------
  // SALUD (última lectura)
  // -------------------------------------------------------------

  /**
   * Última lectura de signos vitales.
   *
   * `signos_vitales` tiene `id_usuario UNIQUE`: es estado actual y se
   * sobrescribe en cada sincronización. Con esta tabla NO se puede armar un
   * historial de salud; para eso haría falta una tabla de series por día
   * (`signos_vitales_historico`), que es un cambio de esquema aparte.
   *
   * Mientras tanto se muestra la última lectura, que ya es información real:
   * dice si hay pasos y si el reloj está mandando algo.
   */
  private async leerSalud(idUsuario: string): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro<FilaSignosVitales>('los signos vitales', () =>
      this.supabase
        .from('signos_vitales')
        .select('id, pasos, calorias, spo2, sueno_minutos, fuente, fecha_actualizacion')
        .eq('id_usuario', idUsuario)
        .limit(1)
    );

    const f = filas[0];
    if (!f || !f.fecha_actualizacion) return [];

    const partes: string[] = [];
    if (f.pasos !== null && f.pasos !== undefined) {
      partes.push(`${Number(f.pasos).toLocaleString('es-CL')} pasos`);
    }
    if (f.spo2 !== null && f.spo2 !== undefined) partes.push(`SpO2 ${f.spo2}%`);
    if (f.sueno_minutos !== null && f.sueno_minutos !== undefined) {
      partes.push(`${duracionBonita(f.sueno_minutos * 60)} de sueño`);
    }

    return [{
      id: `salud-${f.id}`,
      id_usuario: idUsuario,
      tipo: 'salud' as const,
      titulo: 'Actualizó sus signos vitales',
      detalle: partes.length > 0 ? partes.join(' · ') : 'Sin cifras en esta lectura',
      fecha: f.fecha_actualizacion,
      id_origen: f.id
    }];
  }


  // -------------------------------------------------------------
  // EVENTOS MANUALES (llamadas, notas)
  // -------------------------------------------------------------

  private async leerManuales(idUsuario: string, limite: number): Promise<EventoHistorialFila[]> {
    const filas = await this.leerSeguro<FilaEventoManual>('los eventos manuales', () =>
      this.supabase
        .from('historial_evento')
        .select('id, id_usuario, tipo, titulo, detalle, fecha, id_origen')
        .eq('id_usuario', idUsuario)
        .order('fecha', { ascending: false })
        .limit(limite)
    );

    // La tabla sólo admite manual|llamada|nota|ubicacion; si alguien metió otro
    // valor a mano, se muestra como manual en vez de dejar la fila fuera.
    const permitidos = new Set(['manual', 'llamada', 'nota', 'ubicacion']);

    return filas.map((f) => ({
      id: `man-${f.id}`,
      id_usuario: idUsuario,
      tipo: (permitidos.has(f.tipo) ? f.tipo : 'manual') as TipoEventoHistorial,
      titulo: f.titulo,
      detalle: f.detalle,
      fecha: f.fecha,
      id_origen: f.id_origen
    }));
  }


  /**
   * Anota que el adulto mayor avisó que está en casa o que salió.
   *
   * Esto antes no se guardaba en ninguna parte: el botón "Estoy aquí" sólo
   * mandaba un push al cuidador. El push se queda en la barra de notificaciones
   * y a los dos días no queda rastro, así que el historial no tenía forma de
   * mostrarlo.
   *
   * OJO CON EL TIPO: la tabla `historial_evento` tiene un CHECK que sólo
   * admite `manual | llamada | nota | ubicacion`, así que `estado_casa` no se
   * puede guardar todavía y va como `manual`. El texto del título lo deja claro
   * de todos modos.
   *
   * Para usar el tipo propio (y tener su ícono y color en la línea de tiempo),
   * hay que ampliar el CHECK en la base: ver `supabase/sql/estado_casa_tipo.sql`.
   * Aplicado eso, acá alcanza con cambiar 'manual' por 'estado_casa'.
   */
  async registrarEstadoCasa(idUsuario: string, enCasa: boolean): Promise<EventoHistorialFila | null> {
    return this.registrarEvento({
      id_usuario: idUsuario,
      // Ver nota de arriba: 'estado_casa' requiere ampliar el CHECK en la base.
      tipo: 'manual',
      titulo: enCasa ? 'Marcó: Estoy en casa' : 'Marcó: Salí de casa',
      detalle: enCasa
        ? 'Avisó que está en su casa'
        : 'Avisó que salió de su casa'
    });
  }


  // =====================================================
  // ESCRIBIR UN EVENTO MANUAL
  // =====================================================

  /**
   * Registra un evento que no tiene tabla propia: una llamada hecha desde la
   * app, una nota del cuidador, una ubicación fijada.
   *
   * Estos son los únicos eventos que hay que escribir a mano. El resto (SOS,
   * desplazamientos, zona, recordatorios) ya los guarda la app o el servidor en
   * su propia tabla, y duplicarlos acá sería mostrar el mismo hecho dos veces.
   *
   * La tabla tiene un CHECK que sólo admite manual|llamada|nota|ubicacion, así
   * que el tipo se acota antes de guardar.
   */
  async registrarEvento(
    evento: EventoManualEntrada
  ): Promise<EventoHistorialFila | null> {
    const tipo = evento.tipo || 'manual';

    if (!['manual', 'llamada', 'nota', 'ubicacion'].includes(tipo)) {
      console.warn('[Historial] Tipo de evento no permitido, se guarda como manual:', tipo);
    }

    try {
      const { data, error } = await this.supabase
        .from('historial_evento')
        .insert({
          id_usuario: evento.id_usuario,
          id_origen: evento.id_origen || null,
          tipo: ['manual', 'llamada', 'nota', 'ubicacion'].includes(tipo) ? tipo : 'manual',
          titulo: evento.titulo.slice(0, 120),
          detalle: evento.detalle ? evento.detalle.slice(0, 500) : null,
          fecha: evento.fecha || new Date().toISOString()
        })
        .select('id, id_usuario, tipo, titulo, detalle, fecha, id_origen')
        .maybeSingle();

      if (error || !data) {
        console.warn('Error registrando el evento:', error?.message);
        return null;
      }

      return data as EventoHistorialFila;
    } catch (error) {
      console.error('Error registrando el evento:', error);
      return null;
    }
  }

}
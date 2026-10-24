import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { ApagadaNativa, SiempreCerca, SonandoNativa } from './siempre-cerca';
import { SupabaseService } from '../supabase/supabase';

interface OperacionCola {
  id: string;
  op: 'insert' | 'update' | 'delete';
  payload: Partial<AlarmaRecordatorio>;
  ts: number;
}

export interface AlarmaRecordatorio {
  id: string;
  id_usuario: string;
  nombre: string;
  hora: number;
  minuto: number;
  descripcion: string;
  activa: boolean;
  /**
   * Fecha (YYYY-MM-DD) del último apagado. Es un dato de auditoría: dice cuándo
   * se paró por última vez, no qué ocurrencias están cubiertas.
   *
   * Antes se escribía pero no se leía nunca, y el comentario lo reconocía. No
   * puede usarse para decidir si una alarma sonó, porque el servidor guarda solo
   * el día: una alarma confirmada a las 13:10 parecería haber tapado también la
   * de las 18:00. El estado real de cada ocurrencia vive en `apagadas` (claves
   * `id:YYYY-MM-DDTHH:mm`), que sí distingue hora.
   */
  confirmado: string | null;
  dias: number[];
  fecha_creacion?: string;
  fecha_actualizacion?: string;
}

export const DIAS_SEMANA_TODOS = [1, 2, 3, 4, 5, 6, 7];

const TABLA = 'alarma_recordatorio';
const ACCION_APAGAR = 'apagar';

/** Longitudes maximas. El nombre se ve entero en la tarjeta; la descripcion se
 *  muestra como cuerpo de la notificacion, donde Android la corta igual. */
export const LIMITE_NOMBRE = 40;
export const LIMITE_DESCRIPCION = 140;

export interface ProblemaAlarma {
  campo: 'nombre' | 'hora' | 'minuto' | 'descripcion' | 'dias';
  mensaje: string;
}

/**
 * Revisa un recordatorio antes de crearlo o cambiarlo.
 *
 * La pantalla ya valida el nombre, pero esta es la capa por la que pasan todas
 * las demas: la sincronizacion, la API y cualquier llamada futura. Sin esto, un
 * valor fuera de rango no daba error, se guardaba y producia una alarma que
 * nunca sonaba:
 *
 *  - `hora`/`minuto` fuera de rango entran en generarOcurrencias() y el Date se
 *    desborda a otro dia, asi que la alarma salta en un momento que nadie pidio.
 *  - Un dia de la semana que no es 1..7 no coincide jamas con `getDay() + 1`,
 *    y un dia invalido se colaba en generarOcurrencias() sin encontrar su dia.
 *    Dias vacios SI son validos: significan "una sola vez" (ver mas abajo).
 */
export function validarAlarma(
  nombre: string,
  hora: number,
  minuto: number,
  descripcion: string,
  dias: number[]
): ProblemaAlarma[] {
  const problemas: ProblemaAlarma[] = [];

  const nom = (nombre ?? '').trim();
  if (nom.length === 0) {
    problemas.push({ campo: 'nombre', mensaje: 'Escribe un nombre para el recordatorio.' });
  } else if (nom.length > LIMITE_NOMBRE) {
    problemas.push({
      campo: 'nombre',
      mensaje: `El nombre no puede pasar de ${LIMITE_NOMBRE} caracteres.`
    });
  } else if (/[\u0000-\u001F\u007F]/.test(nom)) {
    problemas.push({ campo: 'nombre', mensaje: 'El nombre tiene caracteres no permitidos.' });
  }

  if (!Number.isInteger(hora) || hora < 0 || hora > 23) {
    problemas.push({ campo: 'hora', mensaje: 'La hora debe estar entre 0 y 23.' });
  }
  if (!Number.isInteger(minuto) || minuto < 0 || minuto > 59) {
    problemas.push({ campo: 'minuto', mensaje: 'El minuto debe estar entre 0 y 59.' });
  }

  if ((descripcion ?? '').length > LIMITE_DESCRIPCION) {
    problemas.push({
      campo: 'descripcion',
      mensaje: `La descripcion no puede pasar de ${LIMITE_DESCRIPCION} caracteres.`
    });
  }

  // Dias vacios = "una sola vez": es un caso valido y se trata aparte
  // (generarOcurrencias() le asigna la proxima hora elegida y una vez sonada
  // se apaga sola).
  const lista = dias ?? [];
  if (lista.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    problemas.push({ campo: 'dias', mensaje: 'Los dias de la semana no son validos.' });
  }

  return problemas;
}

/**
 * Deja los dias en 1..7, sin repetir y ordenados.
 *
 * Aplicarlo en un solo sitio evita depender de que cada quien filtre: un `dias`
 * con 0 o con 8 se guardaba tal cual y hacia que la alarma nunca encontrara su
 * dia.
 *
 * Un `dias` vacio NO se rellena: vacio significa "una sola vez" y se respeta
 * tal cual (antes se convertia en "todos los dias", que sonaba a diario sin
 * que nadie lo pidiera).
 */
export function normalizarDias(dias: number[]): number[] {
  const validos = (dias ?? []).filter(
    (d) => Number.isInteger(d) && d >= 1 && d <= 7
  );
  return [...new Set(validos)].sort((a, b) => a - b);
}

@Injectable({
  providedIn: 'root'
})
export class AlarmasService {

  /**
   * Se emite el id de la alarma cada vez que se apaga, sin importar desde dónde
   * (la tarjeta de la página principal, la de Recordatorios o el botón de la
   * barra de notificaciones). Las páginas se suscriben para quitar la tarjeta al
   * instante: antes quedaba mostrando "Apagar alarma" hasta el siguiente refresco.
   */
  readonly alarmaApagada$ = new Subject<string>();

  /**
   * Se emite el id de la alarma en el momento en que empieza a sonar. Las
   * páginas lo escuchan para mostrar la tarjeta "Apagar alarma" al instante,
   * sin depender de que la persona entre y vuelva a la pantalla.
   */
  readonly alarmaSonando$ = new Subject<string>();

  /**
   * Handlers de toque y de disparo, indexados por quién los registró.
   *
   * Antes eran dos campos sueltos y el último que llegaba se imponía. Con eso,
   * que una pantalla se desregistrara en su ngOnDestroy apagaba también el
   * handler que había puesto `app.component`, que es la red de seguridad de la
   * app: el root nunca vuelve a ejecutar su constructor, así que esa red no se
   * recuperaba en toda la sesión. Con un mapa, `desescuchar` quita solo lo suyo
   * y las demás pantallas siguen registrando su handler.
   */
  private readonly tapHandlers = new Map<string, (idAlarma: string) => void>();
  private suspendida = false;
  /** Ids que esta app se sabe haber programado en Android. */
  private programadasAnteriormente = new Set<string>();
  private apagadas = new Set<string>();
  private apagadasCargadas = false;
  private readonly CLAVE_APAGADAS = 'alarmas.apagadas';
  private readonly CLAVE_ESPEJO = 'alarmas.mirror.v1';
  private readonly CLAVE_COLA = 'alarmas.queue.v1';
  private redConectada: boolean | null = null;
  private redRegistrada = false;
  private sincronizando = false;
  /** Apagados ya atendidos, para no repetir cuando llegan por las dos rutas. */
  private accionesProcesadas = new Set<string>();

  private alarmasCache: AlarmaRecordatorio[] = [];

  private readonly CLAVE_USUARIO = 'sc.userid';
  private userIdActual: string | null = localStorage.getItem('sc.userid');

  constructor(private supabaseService: SupabaseService) {}


  // =====================================================
  // USUARIO ACTUAL
  // =====================================================

  private async obtenerUsuarioId(): Promise<string | null> {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase.auth.getUser();
    const id = data?.user?.id ?? null;

    // Cambio de cuenta sin logout limpio: se desecha todo lo local de la
    // cuenta anterior.
    //
    // El botón "Cerrar sesión" es el único que limpia esto, y no siempre se usa:
    // la sesión puede expirar, el usuario puede entrar a otra cuenta, o basta con
    // que Android mate la app. Sin este aviso, el espejo y la cola del usuario
    // anterior seguían vivos, y como la cola pendiente se mezclaba al leer del
    // servidor, la cuenta nueva veía los recordatorios de la otra en la lista.
    if (id && this.userIdActual && id !== this.userIdActual) {
      console.warn('[Alarmas] cambió la cuenta: se descarta el estado local anterior');
      this.descartarEstadoLocal();
    }

    this.userIdActual = id;
    if (id) {
      try {
        localStorage.setItem(this.CLAVE_USUARIO, id);
      } catch {
        // sin persistencia
      }
    }
    return id;
  }

  /** Borra espejo, cola y marcas de apagado. No toca el id de usuario. */
  private descartarEstadoLocal(): void {
    this.alarmasCache = [];
    this.apagadas = new Set<string>();
    this.apagadasCargadas = true;
    try {
      localStorage.removeItem(this.CLAVE_ESPEJO);
      localStorage.removeItem(this.CLAVE_COLA);
      localStorage.removeItem(this.CLAVE_APAGADAS);
    } catch {
      // sin persistencia
    }
  }


  // =====================================================
  // CONSULTA A BD
  // =====================================================

  async getAlarmas(): Promise<AlarmaRecordatorio[]> {
    const userId = await this.obtenerUsuarioId();
    if (!userId) {
      return [];
    }

    const sinRed = this.redConectada === false;
    if (sinRed) {
      return this.espejoDelUsuario(userId);
    }

    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase
        .from(TABLA)
        .select('*')
        .eq('id_usuario', userId)
        .order('hora', { ascending: true })
        .order('minuto', { ascending: true });

      if (error) {
        if (this.esErrorDeRed(error.message)) {
          this.redConectada = false;
        }
        return this.espejoDelUsuario(userId);
      }

      this.redConectada = true;
      // `dias` vacio significa "una sola vez" y se conserva tal cual. Solo un
      // `dias` nulo (filas viejas) se interpreta como "todos los dias", que
      // era el valor por defecto de esas versiones.
      const filas = (data || []).map((row: any) => ({
        ...row,
        dias: Array.isArray(row.dias) ? row.dias : [...DIAS_SEMANA_TODOS]
      }));
      const resultado = this.aplicarCambiosPendientes(filas)
        // Última barrera contra la fuga entre cuentas: por muy filtrada que
        // venga la consulta, la mezcla con el espejo local no puede devolver
        // filas de otra cuenta. getAlarmasLocales() ya lo hacía; esta ruta, que
        // es la que pinta la lista de Recordatorios, no.
        .filter((a) => a.id_usuario === userId);
      this.guardarEspejo(resultado);
      this.alarmasCache = resultado;

      return resultado;
    } catch (e) {
      console.error('Error inesperado al obtener alarmas:', e);
      return this.espejoDelUsuario(userId);
    }
  }

  getAlarmasCache(): AlarmaRecordatorio[] {
    return this.alarmasCache;
  }

  /**
   * Limpia toda la información local de recordatorios al cerrar sesión:
   * evita que la siguiente cuenta vea por un instante los datos del
   * usuario anterior mientras llegan los propios de la red.
   */
  limpiarDatosLocal() {
    this.userIdActual = null;
    this.descartarEstadoLocal();
    this.apagadasCargadas = false;
    try {
      localStorage.removeItem(this.CLAVE_USUARIO);
    } catch {
      // sin persistencia: ignorar
    }

    // Y se sacan de Android las alarmas de la cuenta que se acaba de ir. Sin
    // esto, cerrar sesión dejaba los recordatorios armed en AlarmManager: el
    // teléfono seguía sonando avisos de una cuenta que ya no está y no hay
    // ninguna pantalla desde la que pararlos.
    const salientes = [...this.programadasAnteriormente];
    this.programadasAnteriormente = new Set();
    for (const id of salientes) {
      if (!Capacitor.isNativePlatform()) {
        continue;
      }
      SiempreCerca.desprogramarAlarmas({ idAlarma: id }).catch(() => {});
    }
  }

  /**
   * Devolución instantánea para pintar la pantalla sin esperar la red:
   * usa la caché en memoria si existe, o el espejo local del dispositivo,
   * SIEMPRE filtrando por el usuario actual para no filtrar datos de
   * otras cuentas ni registros eliminados en la base de datos.
   */
  getAlarmasLocales(): AlarmaRecordatorio[] {
    if (!this.userIdActual) {
      return [];
    }
    const lista = this.alarmasCache.length > 0
      ? this.alarmasCache
      : this.leerEspejo();
    return lista
      .filter((a) => a.id_usuario === this.userIdActual)
      .slice()
      .sort((a, b) => a.hora - b.hora || a.minuto - b.minuto);
  }


  // =====================================================
  // CREAR ALARMA (local-first)
  // =====================================================

  async crearAlarma(
    nombre: string,
    hora: number,
    minuto: number,
    descripcion: string,
    activa = true,
    dias: number[] = DIAS_SEMANA_TODOS
  ): Promise<AlarmaRecordatorio | null> {
    const problemas = validarAlarma(nombre, hora, minuto, descripcion, dias);
    if (problemas.length > 0) {
      console.warn('Recordatorio no valido, no se crea', problemas);
      return null;
    }

    const userId = await this.obtenerUsuarioId();
    if (!userId) {
      return null;
    }

    const alarma: AlarmaRecordatorio = {
      id: this.generarId(),
      id_usuario: userId,
      nombre: nombre.trim(),
      hora,
      minuto,
      descripcion: (descripcion ?? '').trim(),
      activa,
      confirmado: null,
      dias: normalizarDias(dias)
    };

    this.espejoUpsert(alarma);
    // descartar inserts previos de un borrado-no-trasladado con el mismo id
    const restantes = this.leerCola().filter(
      (o) => o.op !== 'insert' || o.id !== alarma.id
    );
    restantes.push({ id: alarma.id, op: 'insert', payload: alarma, ts: Date.now() });
    this.guardarCola(restantes);

    void this.flushCola();

    this.alarmasCache = this.leerEspejo();
    return alarma;
  }


  // =====================================================
  // ACTUALIZAR ALARMA (local-first)
  // =====================================================

  async actualizarAlarma(
    id: string,
    cambios: Partial<Pick<AlarmaRecordatorio, 'nombre' | 'hora' | 'minuto' | 'descripcion' | 'activa' | 'dias' | 'confirmado'>>
  ): Promise<boolean> {
    const userId = await this.obtenerUsuarioId();
    if (!userId) {
      return false;
    }

    // Se valida SOLO lo que trae este cambio. Validar el registro entero
    // ataba a `actualizarAlarma({ confirmado })` y `{ activa }` —que no tocan
    // ni el nombre ni los dias— a que el registro viejo ya fuera valido, y una
    // fila antigua con `dias` vacio o nulo dejaba de poder confirmarse.
    const problemas = validarAlarma(
      cambios.nombre ?? '',
      cambios.hora ?? 0,
      cambios.minuto ?? 0,
      cambios.descripcion ?? '',
      cambios.dias ?? DIAS_SEMANA_TODOS
    ).filter((p) => {
      if (p.campo === 'nombre') return cambios.nombre !== undefined;
      if (p.campo === 'hora') return cambios.hora !== undefined;
      if (p.campo === 'minuto') return cambios.minuto !== undefined;
      if (p.campo === 'descripcion') return cambios.descripcion !== undefined;
      return cambios.dias !== undefined;
    });

    if (problemas.length > 0) {
      console.warn('Cambio de recordatorio no valido, no se aplica', id, problemas);
      return false;
    }

    // Normalizar antes de encolar, no despues: lo que se manda al servidor y lo
    // que se guarda en el espejo tienen que ser el mismo dato.
    const limpio: Partial<AlarmaRecordatorio> = { ...cambios };
    if (cambios.nombre !== undefined) limpio.nombre = cambios.nombre.trim();
    if (cambios.descripcion !== undefined) {
      limpio.descripcion = (cambios.descripcion ?? '').trim();
    }
    if (cambios.dias !== undefined) limpio.dias = normalizarDias(cambios.dias);

    const espejo = this.leerEspejo();
    const existente = espejo.find((e) => e.id === id && e.id_usuario === userId);
    if (existente) {
      this.espejoUpsert({ ...existente, ...limpio });
    }

    const restantes = this.leerCola().filter(
      (o) => o.op !== 'insert' || o.id !== id
    );
    restantes.push({ id, op: 'update', payload: limpio, ts: Date.now() });
    this.guardarCola(restantes);

    void this.flushCola();

    const cache = this.leerEspejo().filter((e) => e.id_usuario === userId);
    this.alarmasCache = cache;
    return true;
  }


  // =====================================================
  // ELIMINAR ALARMA (local-first)
  // =====================================================

  async eliminarAlarma(id: string): Promise<boolean> {
    const userId = await this.obtenerUsuarioId();
    if (!userId) {
      return false;
    }

    this.espejoQuitar(id);

    // El borrado se encola siempre, aunque haya un insert pendiente de este id.
    //
    // Antes, al encontrar un insert en la cola se daba por perdido y no se
    // mandaba el delete, creyendo que la fila nunca había llegado al servidor.
    // El problema es que el insert podía haber salido justo antes, mientras la
    // red respondía: en ese caso la fila SÍ estaba en el servidor, y como no
    // había delete, volvía a aparecer sola en la lista en la siguiente carga.
    //
    // La cola se recorre en orden y el delete va detrás del insert, así que
    // mandarlo siempre da el resultado correcto en los dos casos: si el insert
    // aún no salió, se borra lo que se acababa de crear; si ya salió, se borra
    // eso. Un delete de una fila que no existe no da error, no cuesta nada.
    const cola = this.leerCola().filter((o) => o.op !== 'insert' || o.id !== id);
    cola.push({ id, op: 'delete', payload: {}, ts: Date.now() });
    this.guardarCola(cola);

    void this.flushCola();

    const cache = this.leerEspejo().filter((e) => e.id_usuario === userId);
    this.alarmasCache = cache;
    return true;
  }


  // =====================================================
  // MODO OFFLINE: ESPEJO LOCAL + COLA DE SINCRONIZACIÓN
  // =====================================================

  private generarId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `local-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
  }

  private leerEspejo(): AlarmaRecordatorio[] {
    try {
      return JSON.parse(localStorage.getItem(this.CLAVE_ESPEJO) || '[]');
    } catch {
      return [];
    }
  }

  private guardarEspejo(alarmas: AlarmaRecordatorio[]) {
    try {
      localStorage.setItem(this.CLAVE_ESPEJO, JSON.stringify(alarmas));
    } catch (e) {
      console.error('No se pudo guardar el espejo local', e);
    }
  }

  private espejoUpsert(alarma: AlarmaRecordatorio) {
    const espejo = this.leerEspejo();
    const idx = espejo.findIndex((e) => e.id === alarma.id);
    if (idx >= 0) {
      espejo[idx] = alarma;
    } else {
      espejo.push(alarma);
    }
    this.guardarEspejo(espejo);
  }

  private espejoQuitar(id: string) {
    this.guardarEspejo(this.leerEspejo().filter((e) => e.id !== id));
  }

  private espejoDelUsuario(userId: string): AlarmaRecordatorio[] {
    return this.leerEspejo()
      .filter((r) => r.id_usuario === userId)
      .sort((a, b) => a.hora - b.hora || a.minuto - b.minuto);
  }

  private leerCola(): OperacionCola[] {
    try {
      return JSON.parse(localStorage.getItem(this.CLAVE_COLA) || '[]');
    } catch {
      return [];
    }
  }

  private guardarCola(cola: OperacionCola[]) {
    try {
      localStorage.setItem(this.CLAVE_COLA, JSON.stringify(cola));
    } catch (e) {
      console.error('No se pudo guardar la cola de sincronización', e);
    }
  }

  /**
   * Detecta mensajes de error típicos de "sin conexión" para no retomar
   * con un pull que piensa que el servidor "respondió".
   */
  private esErrorDeRed(mensaje: string): boolean {
    const m = (mensaje || '').toLowerCase();
    return (
      m.includes('failed to fetch') ||
      m.includes('network') ||
      m.includes('internet') ||
      m.includes('fetch failed') ||
      m.includes('socket') ||
      m.includes('timed out') ||
      m.includes('typeerror') ||
      m === ''
    );
  }

  /**
   * Vacía la cola de operaciones pendientes hacia el servidor.
   *
   * Antes esta función leía la cola, esperaba la red y al final escribía la cola
   * COMPLETA que había leído al principio. Todo lo que se encolara durante esos
   * esperas se perdía sin aviso: sin fila en la cola, sin reintento y sin error.
   *
   * Se notaba justo en Recordatorios: al crear un recordatorio y borrarlo enseguida,
   * al editarlo y apagarlo, o al tocar dos seguidos. La operación desaparecía y el
   * servidor acababa con datos que la app ya no tenía. En el caso del borrado la
   * fila volvía a aparecer sola en la lista en la siguiente carga, y en el de la
   * activación el recordatorio se quedaba "apagado" en la pantalla pero armado en
   * el teléfono, sonando igual.
   *
   * Ahora los vaciados se serializan y, al escribir, solo se quitan de la cola las
   * operaciones que este volcado sí resolvió. Lo que se haya encolado mientras
   * esperaba la red se queda, y también lo que falló, para el siguiente intento.
   */
  private vaciandoCola = false;
  private colaPorVaciar = false;
  private esperaCola: Promise<void> = Promise.resolve();

  private flushCola(): Promise<void> {
    if (this.vaciandoCola) {
      this.colaPorVaciar = true;
      return this.esperaCola;
    }

    this.vaciandoCola = true;
    this.esperaCola = this.drenarCola().finally(() => {
      this.vaciandoCola = false;
      this.esperaCola = Promise.resolve();
    });
    return this.esperaCola;
  }

  /** Repasa la cola hasta que nadie haya encolado nada nuevo durante el volcado. */
  private async drenarCola(): Promise<void> {
    do {
      this.colaPorVaciar = false;
      await this.procesarCola();
    } while (this.colaPorVaciar);
  }

  private async procesarCola(): Promise<void> {
    const cola = this.leerCola();
    if (cola.length === 0) {
      return;
    }
    if (this.redConectada === false) {
      return;
    }

    const supabase = this.supabaseService.getClient();
    /** Operaciones de este volcado que ya quedaron resueltas y se pueden quitar. */
    const resueltas = new Set<OperacionCola>();

    for (const op of cola) {
      // Una operación que pertenece a otra cuenta no se puede mandar: RLS la
      // rechaza siempre. Antes se quedaba en la cola para siempre y envejeciendo
      // el error, y hacía que la sincronización nunca terminara de vaciarse.
      if (op.payload.id_usuario && op.payload.id_usuario !== this.userIdActual) {
        console.warn('[Alarmas] se descarta una operación de otra cuenta:', op.op, op.id);
        resueltas.add(op);
        continue;
      }

      let error: any = null;
      try {
        if (op.op === 'insert') {
          const { error: err } = await supabase
            .from(TABLA)
            .insert(op.payload)
            .maybeSingle();
          error = err;
        } else if (op.op === 'update') {
          const { error: err } = await supabase
            .from(TABLA)
            .update(op.payload)
            .eq('id', op.id);
          error = err;
        } else if (op.op === 'delete') {
          const { error: err } = await supabase
            .from(TABLA)
            .delete()
            .eq('id', op.id);
          error = err;
        }
      } catch (e: any) {
        error = e;
      }

      if (!error) {
        resueltas.add(op);
        continue;
      }

      const mensaje = (error?.message || '').toLowerCase();
      const duplicado =
        op.op === 'insert' &&
        (mensaje.includes('duplicate') || mensaje.includes('unique constraint') || mensaje.includes('ya existe'));

      if (duplicado) {
        // el registro ya está en el servidor (lo envió otra sincronización)
        resueltas.add(op);
        continue;
      }

      console.error('Sincronización pendiente falló (op ' + op.op + '):', error.message);
      // No entra en `resueltas`: sigue en la cola para el siguiente intento.
      if (this.esErrorDeRed(error.message)) {
        this.redConectada = false;
        break;
      }
    }

    // No se reescribe la cola del principio: se relee y solo se quitan las
    // operaciones que este volcado resolvió. Así lo encolado durante los esperas
    // no se pierde, que era justo lo que se perdía.
    this.guardarCola(this.leerCola().filter((op) => !resueltas.has(op)));
  }

  /**
   * Mientras haya operaciones pendientes en la cola, lo que llegue del
   * servidor NO debe pisar lo editado/creado/borrado localmente.
   * - update/insert pendiente: gana la versión local.
   * - delete pendiente: la fila se quita.
   */
  private aplicarCambiosPendientes(filasServidor: AlarmaRecordatorio[]): AlarmaRecordatorio[] {
    const cola = this.leerCola();
    if (cola.length === 0) {
      return filasServidor;
    }

    const idsUpdate = new Set(cola.filter((o) => o.op === 'update').map((o) => o.id));
    const idsInsert = new Set(cola.filter((o) => o.op === 'insert').map((o) => o.id));
    const idsDelete = new Set(cola.filter((o) => o.op === 'delete').map((o) => o.id));
    const espejoLocal = this.leerEspejo();

    const porId = new Map<string, AlarmaRecordatorio>();
    for (const f of filasServidor) {
      if (!idsDelete.has(f.id)) {
        porId.set(f.id, f);
      }
    }

    for (const local of espejoLocal) {
      if (idsInsert.has(local.id) || idsUpdate.has(local.id)) {
        porId.set(local.id, local);
      }
    }

    return [...porId.values()];
  }


  // =====================================================
  // FECHAS
  // =====================================================

  /**
   * Identifica UNA ocurrencia concreta (dia y hora). Es la clave con que se
   * marca "esta alarma ya se apagó".
   *
   * Antes se usaba solo el dia, y eso hacia que al apagar una alarma quedaban
   * bloqueadas TODAS las de ese dia: la tarjeta no volvia a aparecer aunque la
   * alarma sonara de nuevo. Con la hora incluida solo se apaga esa.
   */
  private claveOcurrencia(fecha: Date): string {
    const hh = String(fecha.getHours()).padStart(2, '0');
    const mi = String(fecha.getMinutes()).padStart(2, '0');
    return `${this.fechaClave(fecha)}T${hh}:${mi}`;
  }

  private fechaClave(fecha: Date): string {
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mm}-${dd}`;
  }

  fechaOcurrencia(alarma: AlarmaRecordatorio, base = new Date()): Date {
    return new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      alarma.hora,
      alarma.minuto,
      0,
      0
    );
  }

  proximaSonara(
    dias: number[],
    hora: number,
    minuto: number,
    ahora = new Date()
  ): Date | null {
    if (!dias || dias.length === 0) {
      // Una sola vez: suena en la proxima hora elegida (hoy si ainda no paso,
      // manana si ya paso).
      const hoy = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate(),
        hora,
        minuto,
        0,
        0
      );
      if (hoy.getTime() > ahora.getTime()) {
        return hoy;
      }
      return new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate() + 1,
        hora,
        minuto,
        0,
        0
      );
    }

    for (let offset = 0; offset <= 7; offset++) {
      const fecha = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate() + offset,
        hora,
        minuto,
        0,
        0
      );

      const diaPlanet = fecha.getDay() + 1;
      if (!dias.includes(diaPlanet)) {
        continue;
      }

      if (offset === 0 && fecha.getTime() <= ahora.getTime()) {
        continue;
      }

      return fecha;
    }

    return null;
  }


  // =====================================================
  // ALARMAS SONANDO
  // =====================================================

  /**
   * Ids que Android tiene sonando ahora mismo. Es la fuente de la verdad: una
   * alarma puede seguir sonando las horas que haga falta, y si la app la
   * olvidara por un reloj propio la tarjeta se esconderia sin dejar apagarla.
   */
  private sonandoNativo = new Map<string, number>();

  private async refrescarSonandoNativo(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const { sonando } = await SiempreCerca.leerAlarmasSonando();
      const filas: SonandoNativa[] = sonando ? JSON.parse(sonando) : [];
      // Se guarda el id con el que quedó sonando de verdad, no solo el id de la
      // alarma. Android lo publica justamente para esto, y la app lo descartaba:
      // al apagar había que recalcular el id desde la fecha de la ocurrencia, y
      // si esa fecha no era la que estaba sonando, el cancel iba al requestCode
      // equivocado y la cadena de reemisión seguía viva.
      this.sonandoNativo = new Map(
        filas
          .filter((f) => typeof f.idAlarma === 'string' && f.idNotificacion)
          .map((f) => [f.idAlarma, f.idNotificacion])
      );
    } catch (e) {
      // Si no se puede preguntar, se sigue con la cuenta por hora de abajo.
    }
  }

  /**
   * Id con el que la alarma está sonando ahora mismo en Android, si el sistema
   * lo dice. Es el único dato fiable para llamar a AlarmManager.cancel.
   */
  private idSonandoReal(alarmaId: string, respaldo: number): number {
    return this.sonandoNativo.get(alarmaId) ?? respaldo;
  }

  private ocurrenciaEnCurso(alarma: AlarmaRecordatorio, ahora: Date): Date | null {
    if (!alarma.activa) {
      return null;
    }

    let ocurrencia = this.fechaOcurrencia(alarma, ahora);
    if (ocurrencia.getTime() > ahora.getTime()) {
      // La de hoy todavia no llego, asi que solo puede estar sonando la de ayer.
      // OJO: esto antes se aplicaba siempre, y devolvia la de ayer aunque la
      // alarma no estuviera sonando: ahi nacia el "apago la clave y el id
      // equivocados". Ahora solo se acepta la de ayer si el sistema confirma que
      // esa alarma sigue sonando, que es el unico caso en que la de ayer es la
      // correcta (la alarma no tiene tope y puede sonar muchas horas).
      if (!this.sonandoNativo.has(alarma.id)) {
        return null;
      }
      ocurrencia = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate() - 1,
        alarma.hora,
        alarma.minuto,
        0,
        0
      );
    }

    const dia = ocurrencia.getDay() + 1;
    // Dias vacios = una sola vez: no hay filtro de dia, la ocurrencia es la
    // proxima hora elegida (puede ser la de ayer si la alarma anoche no se
    // apago).
    if (alarma.dias.length > 0 && !alarma.dias.includes(dia)) {
      return null;
    }

    const inicio = ocurrencia.getTime() - 2 * 60 * 1000;
    const ahoraMs = ahora.getTime();

    if (ahoraMs < inicio) {
      return null;
    }

    // Si Android dice que esta sonando, manda el sistema: la alarma suena hasta
    // que la apaguen y la app no puede ponerla un limite, o la tarjeta
    // desapareceria y no habria forma de pararla desde la app.
    if (this.sonandoNativo.has(alarma.id)) {
      return ocurrencia;
    }

    if (ahoraMs - ocurrencia.getTime() > this.VENTANA_SONANDO_MS) {
      return null;
    }

    return ocurrencia;
  }

  private ocurrenciaSonando(alarma: AlarmaRecordatorio, ahora: Date): string | null {
    const ocurrencia = this.ocurrenciaEnCurso(alarma, ahora);
    if (!ocurrencia) {
      return null;
    }

    if (this.estaApagada(`${alarma.id}:${this.claveOcurrencia(ocurrencia)}`)) {
      return null;
    }

    // No se compara "confirmado": el servidor guarda solo el dia, asi que
    // una alarma confirmada a las 13:10 tapaba tambien la de las 18:00.
    return this.claveOcurrencia(ocurrencia);
  }

  async estanSonando(alarmas?: AlarmaRecordatorio[], ahora = new Date()): Promise<AlarmaRecordatorio[]> {
    // Con la app abierta se puede apagar la alarma desde la barra, y ese apagado
    // queda anotado en el sistema: sin esto la tarjeta seguiria pidiendo apagarla
    // hasta la proxima sincronizacion.
    await Promise.all([this.importarApagadasNativas(), this.refrescarSonandoNativo()]);

    const lista = alarmas ?? (await this.getAlarmas());
    const sonando = lista.filter((alarma) => this.ocurrenciaSonando(alarma, ahora) !== null);

    // La alarma la publica Android, asi que ya no llega el evento del plugin al
    // empezar a sonar. Aqui se avisa de las que aparecen, para que la tarjeta no
    // espere al siguiente sondeo. El Set se recalcula en cada llamada porque si
    // se fuera acumulando, la misma alarma no volveria a avisar al sonar otra vez
    // (13:10, se apaga, 18:00) y la tarjeta no apareceria.
    const sonandoIds = new Set(sonando.map((a) => a.id));
    for (const alarma of sonando) {
      if (!this.sonandoActual.has(alarma.id)) {
        this.alarmaSonando$.next(alarma.id);
      }
    }
    this.sonandoActual = sonandoIds;

    return sonando;
  }

  private sonandoActual = new Set<string>();

  private cargarApagadas(): void {
    if (this.apagadasCargadas) {
      return;
    }
    this.apagadasCargadas = true;
    try {
      const raw = localStorage.getItem(this.CLAVE_APAGADAS);
      if (raw) {
        this.apagadas = new Set<string>(JSON.parse(raw));
      }
    } catch {
      this.apagadas = new Set<string>();
    }
  }

  private marcarApagada(clave: string): void {
    this.cargarApagadas();
    this.apagadas.add(clave);
    try {
      const vivas = [...this.apagadas].slice(-200);
      localStorage.setItem(this.CLAVE_APAGADAS, JSON.stringify(vivas));
    } catch {
      // sin persistencia: solo memoria
    }
  }

  private estaApagada(clave: string): boolean {
    this.cargarApagadas();
    return this.apagadas.has(clave);
  }


  // =====================================================
  // RECORDATORIO "UNA SOLA VEZ"
  // =====================================================

  /**
   * Ocurrencia pendiente de cada recordatorio sin dias (una sola vez): el
   * instante (ms) para el que quedo programado.
   *
   * Sin esta marca no habia forma de saber, en la siguiente sincronizacion, si
   * la unica ocurrencia ya sonó o todavia estaba pendiente: se generaba la de
   * manana y el recordatorio volvia a sonar cada dia.
   */
  private readonly CLAVE_UNA_VEZ = 'alarmas.once.v1';

  private leerMarcasUnaVez(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(this.CLAVE_UNA_VEZ) || '{}');
    } catch {
      return {};
    }
  }

  private marcaUnaVez(id: string): number | null {
    const valor = this.leerMarcasUnaVez()[id];
    return typeof valor === 'number' ? valor : null;
  }

  private guardarMarcaUnaVez(id: string, fechaMs: number) {
    try {
      const mapa = this.leerMarcasUnaVez();
      mapa[id] = fechaMs;
      localStorage.setItem(this.CLAVE_UNA_VEZ, JSON.stringify(mapa));
    } catch {
      // sin persistencia: la autocancelacion queda en manos del apagado
    }
  }

  private quitarMarcaUnaVez(id: string) {
    try {
      const mapa = this.leerMarcasUnaVez();
      if (id in mapa) {
        delete mapa[id];
        localStorage.setItem(this.CLAVE_UNA_VEZ, JSON.stringify(mapa));
      }
    } catch {
      // sin persistencia
    }
  }


  // =====================================================
  // IDS DE NOTIFICACIÓN POR OCURRENCIA
  // =====================================================

  private readonly VENTANA_DIAS = 8;
  /** Minutos de margen: si la hora acaba de pasar, se avisa igual. */
  private readonly TOLERANCIA_HORA_MS = 3 * 60 * 1000;

  /**
   * Margen de seguridad para la cuenta por reloj. La alarma NO se detiene a la
   * hora: mientras Android diga que suena, suena (ver sonandoNativo). Esta hora
   * solo se usa cuando no se puede preguntar al sistema, para que una alarma
   * que ya no suena no se quede con la tarjeta puesta eternamente.
   */
  private readonly VENTANA_SONANDO_MS = 60 * 60 * 1000;


  /**
   * Hash de 21 bits del id de la alarma, para usarlo de requestCode.
   *
   * Antes era un hash de 20 bits con multiplicador 31, y el requestCode era
   * `dia * 1_000_000 + base`. Dos cosas estaban mal:
   *
   *  1. El requestCode no depende de la hora, solo del día. Dos ocurrencias de
   *     la MISMA alarma en el mismo día compartían PendingIntent, fila de
   *     preferencias y id de notificación. Hoy no ocurre porque se genera una
   *     ocurrencia por día, pero es una fragilidad que el código ya contemplaba
   *     en un comentario ("13:10, se apaga, 18:00").
   *  2. Con 20 bits, dos alarmas distintas podían caer en el mismo `base` y el
   *     mismo día UTC. La segunda sobrescribía el PendingIntent de la primera
   *     (FLAG_UPDATE_CURRENT), su fila y su notificación: la primera quedaba
   *     muda y sin forma de recuperarse. Probabilidad baja, consecuencia grave.
   *
   * Ahora son 21 bits de alarma y 10 de día, con un hash de mezcla final. El
   * máximo es 1023 * 2^21 + (2^21 - 1) = 2_147_483_647, exactamente
   * Integer.MAX_VALUE: cabe en un int de Java sin volverse negativo, pero sin
   * ningún margen. Si alguna vez se sube a 11 bits de día o 22 de alarma, hay
   * que volver a recalcularlo.
   */
  private idNumerico(id: string): number {
    if (!id) {
      return 0;
    }
    // FNV-1a de 32 bits: reparte mucho mejor que el "hash*31 + c" de antes.
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return hash & 0x1fffff;
  }

  private idOcurrencia(base: number, fecha: Date): number {
    // Día en epochs, con 10 bits. Dos ocurrencias distintas solo pueden coincidir
    // si caen el mismo día, y 1024 días de margen hace imposible que eso pase
    // entre dos alarmas dentro de la ventana de 8 días.
    const dia = Math.abs(Math.floor(fecha.getTime() / 86400000)) % 1024;
    return dia * 0x200000 + base;
  }

  /**
   * Todos los ids que puede tener una alarma: las ocurrencias de la ventana más
   * los formatos de las versiones viejas.
   *
   * Se generan con los MISMOS parámetros que usa programar(), con la tolerancia
   * incluida. Antes iban con tolerancia 0, o sea que el conjunto de ids a
   * cancelar era distinto del que se había agendado.
   */
  private idsNotificacion(alarma: AlarmaRecordatorio): number[] {
    const base = this.idNumerico(alarma.id);
    const estables = this.generarOcurrencias(
      alarma, new Date(), this.VENTANA_DIAS, this.TOLERANCIA_HORA_MS
    ).map((fecha) => this.idOcurrencia(base, fecha));
    const viejos = alarma.dias.map((d) => base * 10 + d);
    const masViejos = Array.from(
      { length: this.VENTANA_DIAS },
      (_, i) => base * 1000 + i
    );
    return [...estables, ...viejos, ...masViejos];
  }

  private generarOcurrencias(
    alarma: AlarmaRecordatorio,
    base: Date,
    ventanaDias: number = this.VENTANA_DIAS,
    toleranciaMs: number = 0
  ): Date[] {
    const ocurrencias: Date[] = [];

    // Dias vacios = una sola vez: no se filtra por dia y la OCURRENCIA UNICA
    // es la proxima hora elegida. Si la de hoy todavia no paso, es la de hoy;
    // si ya paso (mas alla de la tolerancia), la de manana. Una vez sonada se
    // apaga sola (ver programar() y apagarAlarma()).
    const unaVez = alarma.dias.length === 0;

    for (let i = 0; i < ventanaDias; i++) {
      // Una sola vez: maximo dos candidatas (hoy o manana) y se para en la
      // primera que sirva, para no programar ocurrencias repetidas.
      if (unaVez && ocurrencias.length > 0) {
        break;
      }
      if (unaVez && i > 1) {
        break;
      }

      const fecha = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() + i,
        alarma.hora,
        alarma.minuto,
        0,
        0
      );

      // El filtro de días va ANTES de mirar si la hora ya pasó, y no después.
      // Estaba después, así que la rama de tolerancia (que hace un `continue`)
      // se saltaba el filtro entero: una alarma de solo lunes, sincronizada un
      // martes a las 13:11 para las 13:10, se agendaba y sonaba en martes.
      // Peor: ocurrenciaEnCurso() sí valida los días, así que la tarjeta
      // "Apagar alarma" no aparecía y no había forma de pararla desde la app.
      const dia = fecha.getDay() + 1;
      if (!unaVez && !alarma.dias.includes(dia)) {
        continue;
      }

      if (fecha.getTime() <= base.getTime()) {
        // La app sincroniza cada minuto. Si la hora de hoy ya paso por unos
        // segundos, descartarla en silencio dejaba al usuario sin aviso y la
        // alarma se saltaba al dia siguiente. Con margen se deja pasar la
        // ocurrencia tal cual: se programa en un instante ya vencido, asi que
        // Android la dispara de inmediato.
        //
        // OJO: la fecha NO se corre unos segundos. La clave y el id de la
        // notificacion se derivan de ella, y si se moviera, al apagar se
        // marcaria una clave distinta de la que esta sonando y la alarma
        // seguiria reemitiendo con la clave nueva.
        const retraso = base.getTime() - fecha.getTime();
        if (i === 0 && retraso <= toleranciaMs) {
          ocurrencias.push(fecha);
        }
        continue;
      }

      ocurrencias.push(fecha);
    }

    return ocurrencias;
  }


  // =====================================================
  // APAGAR ALARMA
  // =====================================================

  /**
   * Corta en Android la alarma de una ocurrencia: quita la notificacion que
   * esta sonando y detiene la cadena que la vuelve a emitir. Sin esto el
   * sonido seguiria hasta que la app abriera el foco.
   */
  private async detenerEnSistema(idAlarma: string, ocurrencia: Date, marcar = true) {
    if (!Capacitor.isNativePlatform() || !idAlarma) {
      return;
    }
    try {
      // Si Android dice con qué id quedó sonando, ese es el bueno. Recalcularlo
      // desde la fecha de la ocurrencia es un intento a ciegas: si la fecha no
      // es la que está sonando de verdad, el AlarmManager.cancel va al
      // requestCode equivocado y la cadena de reemisión sigue viva.
      const calculado = this.idOcurrencia(this.idNumerico(idAlarma), ocurrencia);
      await SiempreCerca.detenerAlarma({
        idAlarma,
        clave: this.claveOcurrencia(ocurrencia),
        fecha: ocurrencia.getTime(),
        idNotificacion: this.idSonandoReal(idAlarma, calculado),
        marcar
      });
    } catch (e) {
      console.error('No se pudo cortar la alarma en el sistema', e);
    }
  }

  /** Vuelve a construir la fecha de una clave de ocurrencia. */
  private fechaDesdeClave(clave: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(clave);
    if (!m) {
      return null;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  }

  /**
   * Trae las alarmas que se apagaron desde la barra de notificaciones. Puede
   * pasar con la app cerrada (el boton la apaga sin abrirla), y en ese caso la
   * app se entera recien cuando vuelve a abrirse: sin esto la tarjeta seguiria
   * mostrando "Apagar alarma" de algo que ya esta callado.
   */
  private async importarApagadasNativas() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const { apagadas } = await SiempreCerca.leerAlarmasApagadas();
      const filas: ApagadaNativa[] = apagadas ? JSON.parse(apagadas) : [];
      for (const fila of filas) {
        const clave = `${fila.idAlarma}:${fila.clave}`;
        if (this.estaApagada(clave)) {
          continue;
        }
        this.marcarApagada(clave);
        this.sonandoActual.delete(fila.idAlarma);
        this.alarmaApagada$.next(fila.idAlarma);

        const fecha = this.fechaDesdeClave(fila.clave);
        if (!fecha) {
          continue;
        }
        const alarma =
          this.alarmasCache.find((a) => a.id === fila.idAlarma) ||
          this.getAlarmasLocales().find((a) => a.id === fila.idAlarma);
        if (alarma) {
          // El servidor guarda el dia, asi que se le manda el dia de la ocurrencia.
          //
          // Un recordatorio sin dias (una sola vez) queda apagado al
          // confirmarse: no hay otra ocurrencia que esperar.
          const cambios: { confirmado: string; activa?: boolean } = {
            confirmado: this.fechaClave(fecha)
          };
          if (alarma.dias.length === 0) {
            cambios.activa = false;
            this.quitarMarcaUnaVez(alarma.id);
          }
          await this.actualizarAlarma(alarma.id, cambios);
        }
      }
    } catch (e) {
      console.error('No se pudieron leer las alarmas apagadas', e);
    }
  }

  async apagarAlarma(alarma: AlarmaRecordatorio, ahora = new Date()) {
    const ocurrencia = this.ocurrenciaEnCurso(alarma, ahora);
    if (!ocurrencia) {
      return;
    }

    const fecha = this.fechaClave(ocurrencia);
    this.marcarApagada(`${alarma.id}:${this.claveOcurrencia(ocurrencia)}`);

    // Un recordatorio sin dias suena una sola vez: al apagarse se queda
    // apagado, para que la proxima sincronizacion no le genere otra ocurrencia
    // (antes seguía "activa" y volvía a sonar al dia siguiente).
    const unaVez = alarma.dias.length === 0;
    if (unaVez) {
      this.quitarMarcaUnaVez(alarma.id);
    }

    // Avisar ANTES de tocar la red: si no hay internet el aviso igual tiene que
    // llegar, o la tarjeta "Apagar alarma" se quedaría visible en las páginas.
    this.alarmaApagada$.next(alarma.id);

    this.alarmasCache = this.alarmasCache.map((a) =>
      a.id === alarma.id
        ? (unaVez ? { ...a, confirmado: fecha, activa: false } : { ...a, confirmado: fecha })
        : a
    );

    this.sonandoActual.delete(alarma.id);
    await this.detenerEnSistema(alarma.id, ocurrencia);
    await this.quitarNotificacion(alarma.id, ocurrencia);

    try {
      await this.actualizarAlarma(
        alarma.id,
        unaVez ? { confirmado: fecha, activa: false } : { confirmado: fecha }
      );
    } catch (e) {
      // El sonido ya se corto: si la red falla, la alarma queda marcada solo en
      // el telefono y se sincroniza en la proxima conexion.
      console.error('No se pudo registrar el apagado en el servidor', e);
    }
  }


  // =====================================================
  // PERMISOS Y CANAL
  // =====================================================

  private async asegurarCanal() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      await SiempreCerca.crearCanalAlarma();
    } catch (e) {
      console.error('No se pudo asegurar el canal de alarma', e);
    }
  }

  async bateriaIgnorada(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }
    try {
      const r = await SiempreCerca.ignorandoBateria();
      return r.si;
    } catch (e) {
      console.error('No se pudo consultar optimización de batería', e);
      return false;
    }
  }

  async pedirIgnorarBateria(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }
    try {
      await SiempreCerca.pedirIgnorarOptimizacion();
      return await this.bateriaIgnorada();
    } catch (e) {
      console.error('No se pudo pedir ignorar optimización de batería', e);
      return false;
    }
  }

  /**
   * `false` = denegado (se puede avisar y pedir activar). `null` = no se pudo
   * consultar (el plugin falló): no es lo mismo que "denegado", y tratarlo
   * como tal mostraba "no tienes permiso" y apagaba alarmas sin motivo.
   */
  notifPermitidas(): Promise<boolean | null> {
    if (!Capacitor.isNativePlatform()) {
      return Promise.resolve(true);
    }
    return LocalNotifications.checkPermissions()
      .then((p) => p.display === 'granted')
      .catch(() => null);
  }

  async pedirPermisoNotif(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }
    try {
      const p = await LocalNotifications.requestPermissions();
      return p.display === 'granted';
    } catch (e) {
      console.error('No se pudo pedir permiso de notificaciones', e);
      return false;
    }
  }

  /**
   * Igual que `notifPermitidas`: `null` = no se pudo consultar, que no es
   * "denegado". Quien programe alarmas con `null` sigue haciéndolo en modo
   * inexacto, que es el peor caso conocido.
   */
  checarAlarmaExacta(): Promise<boolean | null> {
    if (Capacitor.getPlatform() !== 'android') {
      return Promise.resolve(true);
    }
    return LocalNotifications.checkExactNotificationSetting()
      .then((s) => s.exact_alarm === 'granted')
      .catch(() => null);
  }

  async abrirAjustesAlarmaExacta(): Promise<boolean> {
    if (Capacitor.getPlatform() !== 'android') {
      return true;
    }
    try {
      await LocalNotifications.changeExactNotificationSetting();
      return (await this.checarAlarmaExacta()) === true;
    } catch (e) {
      console.error('No se pudo abrir el ajuste de alarma exacta', e);
      return false;
    }
  }

  async asegurarPermisos(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }

    try {
      const permiso = await LocalNotifications.checkPermissions();
      if (permiso.display !== 'granted') {
        return false;
      }
    } catch (e) {
      console.error('No se pudo comprobar el permiso de notificaciones', e);
      return false;
    }

    await this.asegurarCanal();

    return true;
  }


  // =====================================================
  // PROGRAMAR / CANCELAR
  // =====================================================

  private async programar(alarma: AlarmaRecordatorio) {
    if (!Capacitor.isNativePlatform() || !alarma.activa) {
      return;
    }

    // Recordatorio sin dias (una sola vez): si su unica ocurrencia ya sonó,
    // se apaga solo. Con margen de una hora para no apagarla mientras aun
    // pueda estar sonando (la tarjeta "Apagar alarma" depende de `activa`).
    const unaVez = alarma.dias.length === 0;
    if (unaVez) {
      const marcada = this.marcaUnaVez(alarma.id);
      if (marcada !== null && marcada + this.VENTANA_SONANDO_MS <= Date.now()) {
        await this.refrescarSonandoNativo();
        if (this.sonandoNativo.has(alarma.id) || this.sonandoActual.has(alarma.id)) {
          return;
        }
        this.quitarMarcaUnaVez(alarma.id);
        await this.cancelarAlarma(alarma);
        await this.actualizarAlarma(alarma.id, { activa: false });
        return;
      }
    }

    const ok = await this.asegurarPermisos();
    if (!ok) {
      return;
    }

    const exacta = (await this.checarAlarmaExacta()) === true;

    const ocurrencias = this.generarOcurrencias(
      alarma,
      new Date(),
      this.VENTANA_DIAS,
      this.TOLERANCIA_HORA_MS
    );
    if (ocurrencias.length === 0) {
      return;
    }

    try {
      await LocalNotifications.cancel({
        notifications: this.idsNotificacion(alarma).map((id) => ({ id }))
      });

      // La publica Android, no la app: asi sigue sonando con la app cerrada y el
      // boton "Apagar" funciona sin abrirla.
      const base = this.idNumerico(alarma.id);
      const resultado = await SiempreCerca.programarAlarmas({
        exacta,
        alarmas: ocurrencias.map((fecha) => ({
          idAlarma: alarma.id,
          clave: this.claveOcurrencia(fecha),
          titulo: `🔔 ${alarma.nombre}`,
          cuerpo: alarma.descripcion || 'Tienes un recordatorio programado',
          fecha: fecha.getTime(),
          idNotificacion: this.idOcurrencia(base, fecha)
        }))
      });

      if (resultado.programadas === 0) {
        console.warn('Ninguna alarma quedo programada', alarma.id);
      } else if (unaVez) {
        // Anota para qué instante quedó la unica ocurrencia: en la proxima
        // sincronizacion, si esa hora ya paso, el recordatorio se apaga solo.
        this.guardarMarcaUnaVez(alarma.id, ocurrencias[0].getTime());
      }
    } catch (e) {
      console.error('No se pudo programar la alarma', e);
    }
  }

  async cancelarAlarma(alarma: AlarmaRecordatorio) {
    this.quitarMarcaUnaVez(alarma.id);

    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      await LocalNotifications.cancel({
        notifications: this.idsNotificacion(alarma).map((id) => ({ id }))
      });

      // La alarma publica por Android tambien hay que sacarla de AlarmManager.
      // Sin "marcar": desactivar un recordatorio no puede dejar anotados los
      // próximos dias como apagados, o al reactivarlo no volveria a sonar.
      for (const fecha of this.generarOcurrencias(alarma, new Date())) {
        await this.detenerEnSistema(alarma.id, fecha, false);
      }
    } catch (e) {
      console.error('No se pudo cancelar la alarma', e);
    }
  }

  async activarDesactivar(alarma: AlarmaRecordatorio, activa: boolean) {
    await this.actualizarAlarma(alarma.id, { activa });

    if (activa) {
      await this.programar({ ...alarma, activa: true });
    } else {
      await this.cancelarAlarma({ ...alarma });
    }
  }

  async sincronizar() {
    if (this.sincronizando) {
      return;
    }
    this.sincronizando = true;
    try {
      await this.importarApagadasNativas();
      await this.flushCola();
      const alarmas = await this.getAlarmas();
      for (const alarma of alarmas) {
        if (alarma.activa) {
          await this.programar(alarma);
        } else {
          await this.cancelarAlarma(alarma);
        }
      }
      await this.desprogramarDesconocidas(alarmas);
      await this.limpiarApagadas(alarmas);
      await this.limpiarNotificacionesVencidas();
    } finally {
      this.sincronizando = false;
    }
  }

  /**
   * Saca de Android las alarmas que este dispositivo tenía programadas y que ya
   * no están en la cuenta.
   *
   * Antes el bucle de sincronizar() solo repasaba las que existía, así que una
   * alarma borrada por otro camino —otro dispositivo, la base de datos, o una
   * lectura que devolvió vacío— se quedaba armada en AlarmManager y seguía
   * sonando hasta que el teléfono se reiniciara. El camino de la UI sí llama a
   * cancelarAlarma antes de borrar, por eso el fallo no se notaba: ocurría con
   * cualquier otro camino.
   *
   * Solo se desprograma si la lista vino de la red. Si estamos sin conexión, la
   * lista es un espejo y no hay forma de saber qué es un borrado real y qué es
   * solo que no se pudo leer.
   */
  private async desprogramarDesconocidas(alarmas: AlarmaRecordatorio[]) {
    if (!Capacitor.isNativePlatform() || this.redConectada === false) {
      return;
    }
    const conocidas = new Set(alarmas.map((a) => a.id));
    const programadas = this.programadasAnteriormente;
    this.programadasAnteriormente = new Set(conocidas);

    for (const id of programadas) {
      if (conocidas.has(id)) {
        continue;
      }
      try {
        await SiempreCerca.desprogramarAlarmas({ idAlarma: id });
      } catch (e) {
        console.warn('No se pudo desprogramar una alarma que ya no existe', id, e);
      }
    }
  }

  private async limpiarNotificacionesVencidas() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const entregadas = await LocalNotifications.getDeliveredNotifications();
      const ahora = Date.now();
      // En Android el plugin entrega el bundle de extras bajo "data", no bajo
      // "extra" (ese solo lo pone el migrador de notificaciones antiguas). Con
      // "extra" el filtro no encontraba nada y esto era código muerto.
      const vencidas = (entregadas.notifications ?? [])
        .map((n: any) => ({ id: n.id, ...(n.data || {}) }))
        .filter((n: any) => n.tipo === 'recordatorio' && typeof n.fecha === 'number')
        .filter((n: any) => ahora - Number(n.fecha) > this.VENTANA_SONANDO_MS)
        .map((n: any) => n.id);

      if (vencidas.length > 0) {
        await LocalNotifications.removeDeliveredNotificationsById({ ids: vencidas });
      }
    } catch (e) {
      console.error('No se pudieron limpiar las notificaciones vencidas', e);
    }
  }

  private async limpiarApagadas(alarmas: AlarmaRecordatorio[]) {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    for (const alarma of alarmas) {
      const ocurrencia = this.ocurrenciaEnCurso(alarma, new Date());
      if (!ocurrencia) {
        continue;
      }
      const fecha = this.fechaClave(ocurrencia);
      if (this.estaApagada(`${alarma.id}:${this.claveOcurrencia(ocurrencia)}`)) {
        try {
          const idEntregada = this.idOcurrencia(this.idNumerico(alarma.id), ocurrencia);
          await LocalNotifications.removeDeliveredNotificationsById({ ids: [idEntregada] });
        } catch {
          // ignorar: no estaba entregada
        }
      }
    }
  }


  // =====================================================
  // TOQUE EN LA NOTIFICACIÓN
  // =====================================================

  /**
   * Suelta los handlers de esta pantalla. Sin esto, al salir de la pantalla que
   * los registró, un toque en la notificación seguía llamando a una página ya
   * destruida: se hacía un `cargar()` sobre un componente muerto y, en el caso
   * del toque, el usuario aparecía en Recordatorios sin haberlo pedido.
   *
   * Se pasa el nombre de la pantalla para no llevarse por delante el handler de
   * otra, en particular el de `app.component`, que nunca se desregistra.
   */
  desescuchar(donde: string): void {
    this.tapHandlers.delete(donde);
  }

  escucharTap(donde: string, handler: (idAlarma: string) => void) {
    this.tapHandlers.set(donde, handler);

    if (Capacitor.isNativePlatform() && !this.suspendida) {
      // OJO: aquí ya no se escuchan 'localNotificationActionPerformed' ni
      // 'localNotificationReceived', y es a propósito. Ambas alarmas las publica
      // Android (AlarmaNativaReceiver) y no el plugin: el botón "Apagar" es un
      // PendingIntent.getBroadcast y la notificación sale de nm.notify(). Esos
      // dos eventos nunca se disparaban, y con ellos se arrastraba
      // registerActionTypes(), que no hacía falta para nada.
      //
      // El apagado y el aviso de "empezó a sonar" llegan por otros caminos de
      // verdad: leerAlarmasApagadas() en el sondeo, y el estado real de
      // AlarmManager para lo segundo.
      this.suspendida = true;

      App.addListener('appStateChange', (estado) => {
        if (estado.isActive) {
          this.revisarAccionDeArranque();
          this.sincronizar();
        }
      });
    }

    this.registrarRed();

    this.revisarAccionDeArranque();
    this.sincronizar();
  }

  /**
   * Recupera el "Apagar alarma" que se apretó en la barra de notificaciones.
   *
   * El evento del plugin de notificaciones solo se entrega si la app ya estaba
   * viva (viene de onNewIntent). Si Android la habia cerrado, el boton se perdia
   * y la alarma seguia sonando. Por eso el plugin propio lee el intent con el que
   * arranco la app, que es donde quedo guardada esa accion.
   */
  private async revisarAccionDeArranque() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const { accion, notificacion } = await SiempreCerca.accionNotificacion();
      if (!accion || !notificacion) {
        return;
      }

      const extra = JSON.parse(notificacion)?.extra;
      const idAlarma = extra?.idAlarma;
      if (typeof idAlarma !== 'string') {
        return;
      }

      if (accion !== ACCION_APAGAR) {
        // Toque normal sobre la notificacion: se abre la app en esa alarma.
        this.notificarToque(idAlarma);
        return;
      }

      const fechaMs = typeof extra?.fecha === 'number' ? extra.fecha : undefined;
      // Con la app viva llegan las dos rutas (el evento del plugin y esta). Con
      // este guardia se apaga una sola vez.
      const dedupe = `${idAlarma}:${fechaMs ?? 0}`;
      if (this.accionesProcesadas.has(dedupe)) {
        return;
      }
      this.accionesProcesadas.add(dedupe);

      await this.apagarDesdeNotificacion(idAlarma, fechaMs);
    } catch (e) {
      console.error('No se pudo recuperar la acción de la notificación', e);
    }
  }

  /**
   * Reparte un toque entre todas las pantallas que registraron un handler.
   *
   * Todas hacen lo mismo (refrescar y abrir Recordatorios), así que se ejecutan
   * todas: la que está en pantalla pinta al momento, y la de app.component
   * garantiza que el toque nunca se pierda aunque no haya ninguna montada.
   */
  private notificarToque(idAlarma: string): void {
    for (const handler of [...this.tapHandlers.values()]) {
      try {
        handler(idAlarma);
      } catch (e) {
        console.warn('Un handler de toque falló', e);
      }
    }
  }

  private registrarRed() {
    if (this.redRegistrada) {
      return;
    }
    this.redRegistrada = true;

    Network.addListener('networkStatusChange', (estado) => {
      this.redConectada = estado.connected;
      if (estado.connected) {
        this.sincronizar();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.redConectada = true;
        this.sincronizar();
      });
      window.addEventListener('offline', () => {
        this.redConectada = false;
      });
    }

    Network.getStatus()
      .then((estado) => {
        this.redConectada = estado.connected;
      })
      .catch(() => {
        this.redConectada = true;
      });
  }

  private async apagarDesdeNotificacion(idAlarma: string, fechaMs?: number) {
    if (!idAlarma) {
      return;
    }
    const ocurrencia = fechaMs ? new Date(fechaMs) : new Date();
    const clave = fechaMs ? `${idAlarma}:${this.claveOcurrencia(ocurrencia)}` : '';

    // 1) Se corta el sonido y se apaga la notificacion SIEMPRE, aunque no
    //    tengamos el objeto de la alarma (app recien abierta o sin internet).
    //    Antes se hacia un return temprano y la alarma seguia sonando.
    if (clave) {
      this.marcarApagada(clave);
    }
    await this.detenerEnSistema(idAlarma, ocurrencia);
    await this.quitarNotificacion(idAlarma, ocurrencia);
    this.alarmaApagada$.next(idAlarma);
    // La alarma ya no esta sonando: se saca del Set para que la proxima vez que
    // suene a otra hora vuelva a avisar.
    this.sonandoActual.delete(idAlarma);

    // 2) Con la alarma a mano se actualiza en el servidor. Si la red falla, el
    //    sonido ya esta cortado: no se revierte nada.
    try {
      const alarma =
        this.alarmasCache.find((a) => a.id === idAlarma) ||
        (await this.getAlarmas()).find((a) => a.id === idAlarma);

      if (alarma && clave) {
        await this.actualizarAlarma(alarma.id, { confirmado: this.fechaClave(ocurrencia) });
      }
    } catch (e) {
      console.error('No se pudo registrar el apagado en el servidor', e);
    }
  }

  /**
   * Quita la notificacion que esta sonando (con eso se corta el sonido) y
   * tambien cancela lo que quedara programado, para que no vuelva a aparecer
   * despues de apagarla.
   */
  private async quitarNotificacion(idAlarma: string, ocurrencia: Date) {
    if (!Capacitor.isNativePlatform() || !idAlarma) {
      return;
    }
    try {
      const idEntregada = this.idSonandoReal(
        idAlarma,
        this.idOcurrencia(this.idNumerico(idAlarma), ocurrencia)
      );
      if (idEntregada <= 0) {
        return;
      }
      await LocalNotifications.cancel({ notifications: [{ id: idEntregada }] });
      await LocalNotifications.removeDeliveredNotificationsById({ ids: [idEntregada] });
    } catch (e) {
      console.error('No se pudo quitar la notificacion', e);
    }
  }
}

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
  confirmado: string | null;
  dias: number[];
  fecha_creacion?: string;
  fecha_actualizacion?: string;
}

export const DIAS_SEMANA_TODOS = [1, 2, 3, 4, 5, 6, 7];

const TABLA = 'alarma_recordatorio';
const TIPO_ACCION = 'apagar-alarma';
const ACCION_APAGAR = 'apagar';

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

  private tapHandler: ((idAlarma: string) => void) | null = null;
  private disparoHandler: (() => void) | null = null;
  private suscripcion: any = null;
  private accionesRegistradas = false;
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
      const filas = (data || []).map((row: any) => ({
        ...row,
        dias: Array.isArray(row.dias) && row.dias.length > 0
          ? row.dias
          : [...DIAS_SEMANA_TODOS]
      }));
      const resultado = this.aplicarCambiosPendientes(filas);
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
    this.alarmasCache = [];
    try {
      localStorage.removeItem(this.CLAVE_ESPEJO);
      localStorage.removeItem(this.CLAVE_COLA);
      localStorage.removeItem(this.CLAVE_APAGADAS);
      localStorage.removeItem(this.CLAVE_USUARIO);
    } catch {
      // sin persistencia: ignorar
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
    const userId = await this.obtenerUsuarioId();
    if (!userId) {
      return null;
    }

    const alarma: AlarmaRecordatorio = {
      id: this.generarId(),
      id_usuario: userId,
      nombre,
      hora,
      minuto,
      descripcion,
      activa,
      confirmado: null,
      dias: dias.length > 0 ? dias : [...DIAS_SEMANA_TODOS]
    };

    this.espejoUpsert(alarma);
    // descartar inserts previos de un borrado-no-trasladado con el mismo id
    const restantes = this.leerCola().filter(
      (o) => o.op !== 'insert' || o.id !== alarma.id
    );
    restantes.push({ id: alarma.id, op: 'insert', payload: alarma, ts: Date.now() });
    this.guardarCola(restantes);

    this.flushCola();

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

    const espejo = this.leerEspejo();
    const existente = espejo.find((e) => e.id === id && e.id_usuario === userId);
    if (existente) {
      this.espejoUpsert({ ...existente, ...cambios });
    }

    const restantes = this.leerCola().filter(
      (o) => o.op !== 'insert' || o.id !== id
    );
    restantes.push({ id, op: 'update', payload: cambios, ts: Date.now() });
    this.guardarCola(restantes);

    this.flushCola();

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

    let cola = this.leerCola();
    if (cola.some((o) => o.op === 'insert' && o.id === id)) {
      // la fila nunca llegó al servidor: solo se quita la cola, sin delete
      cola = cola.filter((o) => o.id !== id);
    } else {
      cola = cola.filter((o) => o.op !== 'insert' || o.id !== id);
      cola.push({ id, op: 'delete', payload: {}, ts: Date.now() });
    }
    this.guardarCola(cola);

    this.flushCola();

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

  private async flushCola() {
    const cola = this.leerCola();
    if (cola.length === 0) {
      return;
    }
    if (this.redConectada === false) {
      return;
    }

    const supabase = this.supabaseService.getClient();
    const restantes: OperacionCola[] = [];
    let indice = 0;

    for (const op of cola) {
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

      if (error) {
        const mensaje = (error?.message || '').toLowerCase();
        const duplicado =
          op.op === 'insert' &&
          (mensaje.includes('duplicate') || mensaje.includes('unique constraint') || mensaje.includes('ya existe'));

        if (duplicado) {
          // el registro ya está en el servidor (lo envió otra sincronización)
          indice++;
          continue;
        }

        console.error('Sincronización pendiente falló (op ' + op.op + '):', error.message);
        restantes.push(op);
        if (this.esErrorDeRed(error.message)) {
          this.redConectada = false;
          indice++;
          break;
        }
      }
      indice++;
    }

    if (indice < cola.length) {
      restantes.push(...cola.slice(indice));
    }
    this.guardarCola(restantes);
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
      return null;
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
  private sonandoNativo = new Set<string>();

  private async refrescarSonandoNativo(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const { sonando } = await SiempreCerca.leerAlarmasSonando();
      const filas: SonandoNativa[] = sonando ? JSON.parse(sonando) : [];
      this.sonandoNativo = new Set(filas.map((f) => f.idAlarma));
    } catch (e) {
      // Si no se puede preguntar, se sigue con la cuenta por hora de abajo.
    }
  }

  private ocurrenciaEnCurso(alarma: AlarmaRecordatorio, ahora: Date): Date | null {
    if (!alarma.activa) {
      return null;
    }

    let ocurrencia = this.fechaOcurrencia(alarma, ahora);
    if (ocurrencia.getTime() > ahora.getTime()) {
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
    if (!alarma.dias.includes(dia)) {
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


  private idNumerico(id: string): number {
    if (!id) {
      return 0;
    }
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 900000 + 100000;
  }

  private idOcurrencia(base: number, fecha: Date): number {
    const dia = Math.floor(fecha.getTime() / 86400000) % 2147;
    return dia * 1000000 + base;
  }

  private idsNotificacion(alarma: AlarmaRecordatorio): number[] {
    const base = this.idNumerico(alarma.id);
    const estables = this.generarOcurrencias(alarma, new Date())
      .map((fecha) => this.idOcurrencia(base, fecha));
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

    for (let i = 0; i < ventanaDias; i++) {
      const fecha = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() + i,
        alarma.hora,
        alarma.minuto,
        0,
        0
      );

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

      const dia = fecha.getDay() + 1;
      if (!alarma.dias.includes(dia)) {
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
      await SiempreCerca.detenerAlarma({
        idAlarma,
        clave: this.claveOcurrencia(ocurrencia),
        fecha: ocurrencia.getTime(),
        idNotificacion: this.idOcurrencia(this.idNumerico(idAlarma), ocurrencia),
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
          await this.actualizarAlarma(alarma.id, { confirmado: this.fechaClave(fecha) });
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

    // Avisar ANTES de tocar la red: si no hay internet el aviso igual tiene que
    // llegar, o la tarjeta "Apagar alarma" se quedaría visible en las páginas.
    this.alarmaApagada$.next(alarma.id);

    this.alarmasCache = this.alarmasCache.map((a) =>
      a.id === alarma.id ? { ...a, confirmado: fecha } : a
    );

    this.sonandoActual.delete(alarma.id);
    await this.detenerEnSistema(alarma.id, ocurrencia);
    await this.quitarNotificacion(alarma.id, ocurrencia);

    try {
      await this.actualizarAlarma(alarma.id, { confirmado: fecha });
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

  notifPermitidas(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return Promise.resolve(true);
    }
    return LocalNotifications.checkPermissions()
      .then((p) => p.display === 'granted')
      .catch(() => false);
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

  checarAlarmaExacta(): Promise<boolean> {
    if (Capacitor.getPlatform() !== 'android') {
      return Promise.resolve(true);
    }
    return LocalNotifications.checkExactNotificationSetting()
      .then((s) => s.exact_alarm === 'granted')
      .catch(() => false);
  }

  async abrirAjustesAlarmaExacta(): Promise<boolean> {
    if (Capacitor.getPlatform() !== 'android') {
      return true;
    }
    try {
      await LocalNotifications.changeExactNotificationSetting();
      return await this.checarAlarmaExacta();
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

    const ok = await this.asegurarPermisos();
    if (!ok) {
      return;
    }

    const exacta = await this.checarAlarmaExacta();

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
      }
    } catch (e) {
      console.error('No se pudo programar la alarma', e);
    }
  }

  async cancelarAlarma(alarma: AlarmaRecordatorio) {
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
      await this.limpiarApagadas(alarmas);
      await this.limpiarNotificacionesVencidas();
    } finally {
      this.sincronizando = false;
    }
  }

  private async limpiarNotificacionesVencidas() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const entregadas = await LocalNotifications.getDeliveredNotifications();
      const ahora = Date.now();
      const vencidas = (entregadas.notifications ?? [])
        .filter((n) => n.extra?.tipo === 'recordatorio' && typeof n.extra?.fecha === 'number')
        .filter((n) => ahora - Number(n.extra.fecha) > this.VENTANA_SONANDO_MS)
        .map((n) => n.id);

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

  onDisparo(handler: () => void) {
    this.disparoHandler = handler;
  }

  escucharTap(handler: (idAlarma: string) => void) {
    this.tapHandler = handler;

    if (Capacitor.isNativePlatform() && !this.suscripcion) {
      this.suscripcion = LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (data: any) => {
          const idAlarma = data?.notification?.extra?.idAlarma;
          const fechaMs = data?.notification?.extra?.fecha;
          if (data?.actionId === ACCION_APAGAR && typeof idAlarma === 'string') {
            const dedupe = `${idAlarma}:${typeof fechaMs === 'number' ? fechaMs : 0}`;
            if (this.accionesProcesadas.has(dedupe)) {
              return;
            }
            this.accionesProcesadas.add(dedupe);
            this.apagarDesdeNotificacion(idAlarma, typeof fechaMs === 'number' ? fechaMs : undefined);
          } else if (typeof idAlarma === 'string' && this.tapHandler) {
            this.tapHandler(idAlarma);
          }
        }
      );

      LocalNotifications.addListener(
        'localNotificationReceived',
        (data: any) => {
          const idAlarma = data?.notification?.extra?.idAlarma;
          if (typeof idAlarma === 'string') {
            this.alarmaSonando$.next(idAlarma);
          }
          if (this.disparoHandler) {
            this.disparoHandler();
          }
        }
      );

      App.addListener('appStateChange', (estado) => {
        if (estado.isActive) {
          this.revisarAccionDeArranque();
          this.sincronizar();
        }
      });
    }

    this.registrarRed();

    this.registrarAccionApagar();
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
        if (this.tapHandler) {
          this.tapHandler(idAlarma);
        }
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

  private async registrarAccionApagar() {
    if (!Capacitor.isNativePlatform() || this.accionesRegistradas) {
      return;
    }
    try {
      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: TIPO_ACCION,
            actions: [
              { id: ACCION_APAGAR, title: 'Apagar alarma' }
            ]
          }
        ]
      });
      this.accionesRegistradas = true;
    } catch (e) {
      console.error('No se pudo registrar la acción de apagado', e);
    }
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
      const idEntregada = this.idOcurrencia(this.idNumerico(idAlarma), ocurrencia);
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

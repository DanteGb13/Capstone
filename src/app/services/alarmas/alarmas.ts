import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { SiempreCerca } from './siempre-cerca';
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

const CANAL = 'recordatorios-alarma';
const TABLA = 'alarma_recordatorio';
const TIPO_ACCION = 'apagar-alarma';
const ACCION_APAGAR = 'apagar';

@Injectable({
  providedIn: 'root'
})
export class AlarmasService {

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

  private alarmasCache: AlarmaRecordatorio[] = [];

  constructor(private supabaseService: SupabaseService) {}


  // =====================================================
  // USUARIO ACTUAL
  // =====================================================

  private async obtenerUsuarioId(): Promise<string | null> {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
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
    const fin = ocurrencia.getTime() + 15 * 60 * 1000;
    const ahoraMs = ahora.getTime();

    if (ahoraMs < inicio || ahoraMs > fin) {
      return null;
    }

    return ocurrencia;
  }

  private ocurrenciaSonando(alarma: AlarmaRecordatorio, ahora: Date): string | null {
    const ocurrencia = this.ocurrenciaEnCurso(alarma, ahora);
    if (!ocurrencia) {
      return null;
    }

    const fecha = this.fechaClave(ocurrencia);
    if (this.estaApagada(`${alarma.id}:${fecha}`)) {
      return null;
    }
    if (alarma.confirmado === fecha) {
      return null;
    }

    return fecha;
  }

  async estanSonando(alarmas?: AlarmaRecordatorio[], ahora = new Date()): Promise<AlarmaRecordatorio[]> {
    const lista = alarmas ?? (await this.getAlarmas());
    return lista.filter((alarma) => this.ocurrenciaSonando(alarma, ahora) !== null);
  }

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

  private idNumerico(id: string): number {
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
    ventanaDias: number = this.VENTANA_DIAS
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

  async apagarAlarma(alarma: AlarmaRecordatorio, ahora = new Date()) {
    const ocurrencia = this.ocurrenciaEnCurso(alarma, ahora);
    if (!ocurrencia) {
      return;
    }

    const fecha = this.fechaClave(ocurrencia);
    this.marcarApagada(`${alarma.id}:${fecha}`);

    this.alarmasCache = this.alarmasCache.map((a) =>
      a.id === alarma.id ? { ...a, confirmado: fecha } : a
    );

    if (Capacitor.isNativePlatform()) {
      try {
        const idEntregada = this.idOcurrencia(this.idNumerico(alarma.id), ocurrencia);
        await LocalNotifications.removeDeliveredNotificationsById({ ids: [idEntregada] });
      } catch (e) {
        console.error('No se pudo quitar la notificación', e);
      }
    }

    await this.actualizarAlarma(alarma.id, { confirmado: fecha });
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

    const ocurrencias = this.generarOcurrencias(alarma, new Date());
    if (ocurrencias.length === 0) {
      return;
    }

    try {
      await LocalNotifications.cancel({
        notifications: this.idsNotificacion(alarma).map((id) => ({ id }))
      });

      const notificaciones = ocurrencias.map((fecha) => ({
        id: this.idOcurrencia(this.idNumerico(alarma.id), fecha),
        title: `🔔 ${alarma.nombre}`,
        body: alarma.descripcion || 'Tienes un recordatorio programado',
        channelId: CANAL,
        sound: 'alarmmelodia',
        actionTypeId: TIPO_ACCION,
        schedule: {
          at: fecha,
          allowWhileIdle: true
        },
        foreground: true,
        autoCancel: true,
        isExactNotification: exacta,
        extra: {
          tipo: 'recordatorio',
          idAlarma: alarma.id,
          fecha: fecha.getTime()
        }
      }));

      const resultado = await LocalNotifications.schedule({
        notifications: notificaciones
      });

      if (resultado.warning) {
        console.warn('Alarma programada como INEXACTA (se aviso en Ajustes):',
          resultado.warning.code, resultado.warning.message);
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
    } finally {
      this.sincronizando = false;
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
      if (this.estaApagada(`${alarma.id}:${fecha}`)) {
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
            this.apagarDesdeNotificacion(idAlarma, typeof fechaMs === 'number' ? fechaMs : undefined);
          } else if (typeof idAlarma === 'string' && this.tapHandler) {
            this.tapHandler(idAlarma);
          }
        }
      );

      LocalNotifications.addListener(
        'localNotificationReceived',
        () => {
          if (this.disparoHandler) {
            this.disparoHandler();
          }
        }
      );

      App.addListener('appStateChange', (estado) => {
        if (estado.isActive) {
          this.sincronizar();
        }
      });
    }

    this.registrarRed();

    this.registrarAccionApagar();
    this.sincronizar();
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
    if (fechaMs) {
      this.marcarApagada(`${idAlarma}:${this.fechaClave(new Date(fechaMs))}`);
    }
    const alarma =
      this.alarmasCache.find((a) => a.id === idAlarma) ||
      (await this.getAlarmas()).find((a) => a.id === idAlarma);
    if (!alarma) {
      return;
    }
    await this.apagarAlarma(alarma, fechaMs ? new Date(fechaMs) : new Date());
  }
}

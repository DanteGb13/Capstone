import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SiempreCerca } from './siempre-cerca';
import { SupabaseService } from '../supabase/supabase';

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

@Injectable({
  providedIn: 'root'
})
export class AlarmasService {

  private tapHandler: ((idAlarma: string) => void) | null = null;
  private disparoHandler: (() => void) | null = null;
  private suscripcion: any = null;

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

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(TABLA)
      .select('*')
      .eq('id_usuario', userId)
      .order('hora', { ascending: true })
      .order('minuto', { ascending: true });

    if (error) {
      console.error('Error al obtener alarmas:', error.message);
      return this.alarmasCache;
    }

    this.alarmasCache = (data || []).map((row: any) => ({
      ...row,
      dias: Array.isArray(row.dias) && row.dias.length > 0
        ? row.dias
        : [...DIAS_SEMANA_TODOS]
    }));

    return this.alarmasCache;
  }

  getAlarmasCache(): AlarmaRecordatorio[] {
    return this.alarmasCache;
  }


  // =====================================================
  // CREAR ALARMA
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

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(TABLA)
      .insert({
        id_usuario: userId,
        nombre,
        hora,
        minuto,
        descripcion,
        activa,
        dias: dias.length > 0 ? dias : [...DIAS_SEMANA_TODOS]
      })
      .select()
      .single();

    if (error) {
      console.error('Error al crear alarma:', error.message);
      return null;
    }

    return data as AlarmaRecordatorio;
  }


  // =====================================================
  // ACTUALIZAR ALARMA
  // =====================================================

  async actualizarAlarma(
    id: string,
    cambios: Partial<Pick<AlarmaRecordatorio, 'nombre' | 'hora' | 'minuto' | 'descripcion' | 'activa' | 'dias' | 'confirmado'>>
  ): Promise<boolean> {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from(TABLA)
      .update(cambios)
      .eq('id', id);

    if (error) {
      console.error('Error al actualizar alarma:', error.message);
      return false;
    }
    return true;
  }


  // =====================================================
  // ELIMINAR ALARMA
  // =====================================================

  async eliminarAlarma(id: string): Promise<boolean> {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from(TABLA)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error al eliminar alarma:', error.message);
      return false;
    }
    return true;
  }


  // =====================================================
  // FECHAS
  // =====================================================

  private fechaClave(fecha: Date): string {
    return `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
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
    if (alarma.confirmado === fecha) {
      return null;
    }

    return fecha;
  }

  async estanSonando(ahora = new Date()): Promise<AlarmaRecordatorio[]> {
    const alarmas = await this.getAlarmas();
    return alarmas.filter((alarma) => this.ocurrenciaSonando(alarma, ahora) !== null);
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

  private idsNotificacion(alarma: AlarmaRecordatorio): number[] {
    const base = this.idNumerico(alarma.id);
    const nuevos = Array.from(
      { length: this.VENTANA_DIAS },
      (_, i) => base * 1000 + i
    );
    const viejos = alarma.dias.map((d) => base * 10 + d);
    return [...nuevos, ...viejos];
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
    const ocurrencia = this.ocurrenciaEnCurso(alarma, ahora) ?? this.fechaOcurrencia(alarma, ahora);
    const fecha = this.fechaClave(ocurrencia);

    await this.actualizarAlarma(alarma.id, { confirmado: fecha });

    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      const entregadas = await LocalNotifications.getDeliveredNotifications();
      const aRemover = entregadas.notifications
        .filter((n) => n.extra?.idAlarma === alarma.id)
        .map((n) => n.id);
      if (aRemover.length > 0) {
        await LocalNotifications.removeDeliveredNotificationsById({ ids: aRemover });
      }
    } catch (e) {
      console.error('No se pudo quitar la notificación', e);
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
      let permiso = await LocalNotifications.checkPermissions();
      if (permiso.display !== 'granted') {
        permiso = await LocalNotifications.requestPermissions();
      }

      if (permiso.display !== 'granted') {
        return false;
      }
    } catch (e) {
      console.error('No se pudo pedir permiso de notificaciones', e);
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

      const notificaciones = ocurrencias.map((fecha, i) => ({
        id: this.idNumerico(alarma.id) * 1000 + i,
        title: `🔔 ${alarma.nombre}`,
        body: alarma.descripcion || 'Tienes un recordatorio programado',
        channelId: CANAL,
        sound: 'alarmmelodia',
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
    const alarmas = await this.getAlarmas();
    for (const alarma of alarmas) {
      if (alarma.activa) {
        await this.programar(alarma);
      } else {
        await this.cancelarAlarma(alarma);
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

    if (!Capacitor.isNativePlatform() || this.suscripcion) {
      return;
    }

    this.suscripcion = LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (data: any) => {
        const idAlarma = data?.notification?.extra?.idAlarma;
        if (typeof idAlarma === 'string' && this.tapHandler) {
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

    this.sincronizar();
  }
}

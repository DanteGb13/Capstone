import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../supabase/supabase';
import { PushNotificationService } from '../push-notification/push-notification';
import { PermisosExtra } from '../permisos-extra/permisos-extra';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { AlertController } from '@ionic/angular';

export interface CuidadorVinculado {
  id: string;
  nombre: string;
  apellidopa: string;
  apellidoma: string;
  telefono: string;
  correo: string;
}

export interface ResultadoSOS {
  pushEnviado: boolean;
  llamadaIniciada: boolean;
  smsEnviado: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SOSService {

  private isNative = Capacitor.isNativePlatform();

  // Seguimiento: el reenvío lo hace el servidor (pg_cron) mientras el celular
  // vigila la tabla para avisarle al adulto en cuanto un cuidador contesta.
  private timerReintentosSOS: any = null;
  private intentosSOS = 0;
  private idSosActivo: string = '';

  private static readonly INTERVALO_REINTENTO_MS = 45000;
  private static readonly MAXIMO_REINTENTOS = 40;

  constructor(
    private supabaseService: SupabaseService,
    private pushService: PushNotificationService,
    private alertCtrl: AlertController,
    private router: Router
  ) {
    if (this.isNative) {
      // Al volver a la app, si el cuidador ya contestó mientras estábamos
      // en segundo plano, se cortan los reintentos y se avisa.
      App.addListener('resume', () => {
        this.verificarSosPendiente();
      }).catch(() => {});
    }
  }

  async obtenerCuidadores(): Promise<CuidadorVinculado[]> {
    try {
      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return [];

      const { data: vinculaciones, error } = await client
        .from('cuidador_usuario')
        .select(`
          id_cuidador,
          cuidador (
            id,
            id_usuario,
            usuario (
              id, nombre, apellidopa, apellidoma, telefono, correo
            )
          )
        `)
        .eq('id_usuario', user.id);

      if (error || !vinculaciones) return [];

      const vistos = new Set<string>();
      const cuidadores: CuidadorVinculado[] = [];

      for (const v of vinculaciones) {
        const cuidador = (v as any).cuidador;
        if (cuidador?.usuario && !vistos.has(cuidador.usuario.id)) {
          vistos.add(cuidador.usuario.id);
          cuidadores.push({
            id: cuidador.usuario.id,
            nombre: cuidador.usuario.nombre,
            apellidopa: cuidador.usuario.apellidopa,
            apellidoma: cuidador.usuario.apellidoma,
            telefono: cuidador.usuario.telefono,
            correo: cuidador.usuario.correo
          });
        }
      }

      return cuidadores;
    } catch (e) {
      console.error('Error obteniendo cuidadores:', e);
      return [];
    }
  }

  async obtenerUbicacionActual(): Promise<{ lat: number; lng: number } | null> {
    try {
      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return null;

      const { data } = await client
        .from('ubicacion')
        .select('latitud, longitud')
        .eq('id_usuario', user.id)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return null;

      return {
        lat: parseFloat(data.latitud),
        lng: parseFloat(data.longitud)
      };
    } catch {
      return null;
    }
  }

  async obtenerNombreAdulto(): Promise<string> {
    try {
      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return 'Desconocido';

      const { data } = await client
        .from('usuario')
        .select('nombre, apellidopa')
        .eq('id', user.id)
        .maybeSingle();

      if (!data) return 'Desconocido';
      return `${data.nombre} ${data.apellidopa || ''}`.trim();
    } catch {
      return 'Desconocido';
    }
  }

  async ejecutarSOS(): Promise<ResultadoSOS> {
    const resultado: ResultadoSOS = {
      pushEnviado: false,
      llamadaIniciada: false,
      smsEnviado: false
    };

    console.log('SOS: Iniciando...');

    let cuidadores: CuidadorVinculado[] = [];
    try {
      cuidadores = await this.obtenerCuidadores();
    } catch (e) {
      console.error('SOS: Error obteniendo cuidadores:', e);
    }

    console.log('SOS: Cuidadores encontrados:', cuidadores.length);

    if (cuidadores.length === 0) {
      // Sin cuidador no hay a quién avisar: en vez de un error sin salida,
      // se lleva a la pantalla de contactos para agregar uno.
      // `/contacto-emergencia` es la ruta de contactos del rol adulto mayor
      // (ver app.routes.ts y RUTAS_ADULTO_MAYOR); con el rol cuidador sería
      // /contactos-cuidador, pero el SOS sólo existe en el panel del adulto.
      const alert = await this.alertCtrl.create({
        header: 'Sin cuidador vinculado',
        message:
          'Tu SOS avisa a tu cuidador, pero todavía no tienes a nadie vinculado. ' +
          'Agrega un contacto de emergencia para poder pedir ayuda.',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Ir a contactos',
            handler: () => {
              void this.router.navigate(['/contacto-emergencia']);
            }
          }
        ]
      });
      await alert.present();
      return resultado;
    }

    // Sólo cuántos cuidadores hay: sus nombres y teléfonos son datos de
    // terceros y no hacen falta para que la alerta funcione.
    console.log(`SOS: cuidadores notificados: ${cuidadores?.length ?? 0}`);

    let ubicacion = null;
    let nombreAdulto = 'Desconocido';
    try { ubicacion = await this.obtenerUbicacionActual(); } catch (e) { console.warn('SOS: Error ubicación:', e); }
    try { nombreAdulto = await this.obtenerNombreAdulto(); } catch (e) { console.warn('SOS: Error nombre:', e); }

    // Ni coordenadas ni nombre: son la ubicación exacta y el nombre de un
    // adulto mayor, en texto plano en el log del sistema.
    console.log(`SOS: ubicación obtenida: ${!!ubicacion ? 'sí' : 'no'}`);

    // La dirección NO va en el texto: al tocar el aviso se abre Google Maps
    // con las coordenadas que viajan en `data`.
    const cuerpoSOS = ubicacion
      ? `${nombreAdulto} necesita ayuda. Toca para ver su ubicación en Google Maps.`
      : `${nombreAdulto} necesita ayuda. Ubicación no disponible.`;

    const datosSOS: { [clave: string]: string } = {
      tipo: 'sos',
      canal: 'sos-alertas',
      id_sos: '',
      latitud: ubicacion?.lat?.toString() || '',
      longitud: ubicacion?.lng?.toString() || ''
    };

    // Sesión SOS: el aviso se reenvía hasta que un cuidador conteste.
    // Si ya había una alerta sin confirmar se sigue esa misma sesión: crear
    // otra abriría un segundo ciclo de avisos en todos los cuidadores.
    let idSos = this.idSosActivo;
    if (!idSos || (await this.sosConfirmado(idSos))) {
      idSos = await this.crearSesionSOS();
    }
    datosSOS['id_sos'] = idSos;

    for (const cuidador of cuidadores) {
      console.log('SOS: Enviando push a:', cuidador.id, cuidador.nombre);
      try {
        const ok = await this.pushService.enviarPushAUsuario(
          cuidador.id,
          'SOS - Alerta de Emergencia',
          cuerpoSOS,
          datosSOS
        );
        console.log('SOS: Push resultado para', cuidador.nombre, ':', ok);
        if (ok) resultado.pushEnviado = true;
      } catch (e) {
        console.error('SOS: Error push para', cuidador.nombre, ':', e);
      }
    }

    this.iniciarReintentosSOS(datosSOS['id_sos']);

    // Sin ningún push entregado no hay ciclo que reintentar
    if (!resultado.pushEnviado) {
      this.detenerReintentosSOS();
      this.idSosActivo = '';
    }

    const cuidadorConTelefono = cuidadores.find(c => c.telefono && c.telefono.length >= 9);
    if (cuidadorConTelefono) {
      console.log('SOS: Llamando a:', cuidadorConTelefono.telefono);
      try {
        await this.realizarLlamada(cuidadorConTelefono.telefono);
        resultado.llamadaIniciada = true;
      } catch (e) {
        console.error('SOS: Error llamada:', e);
      }
    } else {
      console.warn('SOS: No hay cuidador con teléfono válido');
    }

    if (!resultado.pushEnviado && !resultado.llamadaIniciada) {
      await this.avisarSinEntrega();
    }

    return resultado;
  }

  // =====================================================
  // SEGUIMIENTO: SE AVISA EN CUANTO UN CUIDADOR CONTESTA
  // =====================================================

  private async crearSesionSOS(): Promise<string> {
    try {
      const client = this.supabaseService.getClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return '';

      const { data, error } = await client
        .from('sos_alerta')
        .insert({ id_adulto: user.id })
        .select('id')
        .single();

      if (error || !data) {
        console.warn('SOS: no se pudo crear la sesión de alerta:', error?.message);
        return '';
      }
      return data.id;
    } catch (e) {
      console.warn('SOS: no se pudo crear la sesión de alerta:', e);
      return '';
    }
  }

  private iniciarReintentosSOS(idSos: string): void {
    this.detenerReintentosSOS();
    if (!idSos) return;

    this.idSosActivo = idSos;
    this.intentosSOS = 0;

    this.timerReintentosSOS = setInterval(async () => {
      this.intentosSOS++;

      if (this.intentosSOS > SOSService.MAXIMO_REINTENTOS) {
        this.detenerReintentosSOS();
        return;
      }

      try {
        if (await this.sosConfirmado(idSos)) {
          this.detenerReintentosSOS();
          await this.avisarConfirmacionSOS();
        }
      } catch { /* se vuelve a intentar en el próximo ciclo */ }
    }, SOSService.INTERVALO_REINTENTO_MS);
  }

  /** Avisa al adulto mayor que el SOS no se pudo entregar. */
  private async avisarSinEntrega(): Promise<void> {
    this.idSosActivo = '';

    try {
      const alert = await this.alertCtrl.create({
        header: 'No se pudo enviar el SOS',
        message:
          'No hay conexión a internet o el aviso no pudo entregarse. ' +
          'Intenta de nuevo cuando tengas señal.',
        buttons: ['Entendido']
      });
      await alert.present();
    } catch { /* sin UI disponible */ }
  }

  private detenerReintentosSOS(): void {
    if (this.timerReintentosSOS) {
      clearInterval(this.timerReintentosSOS);
      this.timerReintentosSOS = null;
    }
  }

  private async sosConfirmado(idSos: string): Promise<boolean> {
    if (!idSos) return true;

    try {
      const client = this.supabaseService.getClient();
      const { data } = await client
        .from('sos_alerta')
        .select('confirmada_por, confirmada_en')
        .eq('id', idSos)
        .maybeSingle();
      return !!data?.confirmada_por || !!data?.confirmada_en;
    } catch {
      return false;
    }
  }

  private async verificarSosPendiente(): Promise<void> {
    if (!this.idSosActivo) return;
    try {
      if (await this.sosConfirmado(this.idSosActivo)) {
        this.detenerReintentosSOS();
        await this.avisarConfirmacionSOS();
      }
    } catch { /* sin conexión: lo retoma el siguiente ciclo */ }
  }

  private async avisarConfirmacionSOS(): Promise<void> {
    if (!this.idSosActivo) return;
    this.idSosActivo = '';

    try {
      const alert = await this.alertCtrl.create({
        header: 'Alerta atendida',
        message: 'Tu cuidador vio la alerta SOS. Ya no se reenviarán avisos.',
        buttons: ['Entendido']
      });
      await alert.present();
    } catch { /* sin UI disponible */ }
  }

  async realizarLlamada(telefono: string): Promise<void> {
    const telLimpio = this.limpiarTelefono(telefono);

    if (this.isNative) {
      await PermisosExtra.realizarLlamada({ telefono: telLimpio });
    } else {
      window.location.href = `tel:${telLimpio}`;
    }
  }

  async enviarSMS(telefono: string, mensaje: string): Promise<void> {
    const telLimpio = this.limpiarTelefono(telefono);

    if (this.isNative) {
      await PermisosExtra.enviarSMS({ telefono: telLimpio, mensaje });
    } else {
      window.location.href = `sms:${telLimpio}?body=${encodeURIComponent(mensaje)}`;
    }
  }

  private limpiarTelefono(telefono: string): string {
    let tel = telefono.replace(/[\s\-\(\)\+]/g, '');

    if (tel.length === 9 && tel.startsWith('9')) {
      tel = '+56' + tel;
    }

    if (!tel.startsWith('+')) {
      tel = '+56' + tel;
    }

    return tel;
  }
}

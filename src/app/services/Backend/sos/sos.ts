import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { PushNotificationService } from '../push-notification/push-notification';
import { PermisosExtra } from '../permisos-extra/permisos-extra';
import { Capacitor } from '@capacitor/core';
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

  constructor(
    private supabaseService: SupabaseService,
    private pushService: PushNotificationService,
    private alertCtrl: AlertController
  ) {}

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
      const alert = await this.alertCtrl.create({
        header: 'SOS Error',
        message: 'No hay cuidadores vinculados. No se puede enviar la alerta.',
        buttons: ['OK']
      });
      await alert.present();
      return resultado;
    }

    console.log('SOS: Cuidadores:', JSON.stringify(cuidadores.map(c => ({ id: c.id, nombre: c.nombre, telefono: c.telefono }))));

    let ubicacion = null;
    let nombreAdulto = 'Desconocido';
    try { ubicacion = await this.obtenerUbicacionActual(); } catch (e) { console.warn('SOS: Error ubicación:', e); }
    try { nombreAdulto = await this.obtenerNombreAdulto(); } catch (e) { console.warn('SOS: Error nombre:', e); }

    console.log('SOS: Ubicación:', JSON.stringify(ubicacion));
    console.log('SOS: Nombre:', nombreAdulto);

    const ubicacionTexto = ubicacion
      ? `https://maps.google.com/?q=${ubicacion.lat},${ubicacion.lng}`
      : 'Ubicación no disponible';

    for (const cuidador of cuidadores) {
      console.log('SOS: Enviando push a:', cuidador.id, cuidador.nombre);
      try {
        const ok = await this.pushService.enviarPushAUsuario(
          cuidador.id,
          'SOS - Alerta de Emergencia',
          `${nombreAdulto} necesita ayuda. Ubicación: ${ubicacionTexto}`,
          { tipo: 'sos', latitud: ubicacion?.lat?.toString() || '', longitud: ubicacion?.lng?.toString() || '' }
        );
        console.log('SOS: Push resultado para', cuidador.nombre, ':', ok);
        if (ok) resultado.pushEnviado = true;
      } catch (e) {
        console.error('SOS: Error push para', cuidador.nombre, ':', e);
      }
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

    return resultado;
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

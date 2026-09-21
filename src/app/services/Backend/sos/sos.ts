import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';
import { PushNotificationService } from '../push-notification/push-notification';
import { PermisosExtra } from '../permisos-extra/permisos-extra';
import { Capacitor } from '@capacitor/core';

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
    private pushService: PushNotificationService
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

      const cuidadores: CuidadorVinculado[] = [];

      for (const v of vinculaciones) {
        const cuidador = (v as any).cuidador;
        if (cuidador?.usuario) {
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

    let cuidadores: CuidadorVinculado[] = [];
    try {
      cuidadores = await this.obtenerCuidadores();
    } catch (e) {
      console.error('Error obteniendo cuidadores:', e);
    }

    if (cuidadores.length === 0) {
      console.warn('No hay cuidadores vinculados');
      return resultado;
    }

    let ubicacion = null;
    let nombreAdulto = 'Desconocido';
    try { ubicacion = await this.obtenerUbicacionActual(); } catch (e) { console.warn('Error ubicación:', e); }
    try { nombreAdulto = await this.obtenerNombreAdulto(); } catch (e) { console.warn('Error nombre:', e); }

    const ubicacionTexto = ubicacion
      ? `https://maps.google.com/?q=${ubicacion.lat},${ubicacion.lng}`
      : 'Ubicación no disponible';

    for (const cuidador of cuidadores) {
      this.pushService.enviarPushAUsuario(
        cuidador.id,
        'SOS - Alerta de Emergencia',
        `${nombreAdulto} necesita ayuda. Ubicación: ${ubicacionTexto}`,
        { tipo: 'sos', latitud: ubicacion?.lat, longitud: ubicacion?.lng }
      ).then(ok => { if (ok) resultado.pushEnviado = true; })
       .catch(e => console.error('Error push:', e));
    }

    const cuidadorConTelefono = cuidadores.find(c => c.telefono && c.telefono.length >= 9);
    if (cuidadorConTelefono) {
      try {
        await this.realizarLlamada(cuidadorConTelefono.telefono);
        resultado.llamadaIniciada = true;
      } catch (e) {
        console.error('Error llamada:', e);
      }
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

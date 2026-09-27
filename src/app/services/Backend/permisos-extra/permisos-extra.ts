import { registerPlugin } from '@capacitor/core';

export interface ContactoElegido {
  nombre?: string;
  apellido?: string;
  telefono?: string;
  correo?: string;
}

export interface PermisosExtraPlugin {
  solicitarTelefono(): Promise<{ concedido: boolean }>;
  solicitarContactos(): Promise<{ concedido: boolean }>;
  verificarPermisos(): Promise<{ telefono: boolean; contactos: boolean }>;
  abrirAjustes(): Promise<void>;
  realizarLlamada(options: { telefono: string }): Promise<{ llamada: boolean }>;
  enviarSMS(options: { telefono: string; mensaje: string }): Promise<{ sms: boolean }>;
  /** Abre la agenda del sistema para elegir un contacto. Objeto vacío si se cancela. */
  pickContacto(): Promise<ContactoElegido>;
}

export const PermisosExtra = registerPlugin<PermisosExtraPlugin>('PermisosExtra');

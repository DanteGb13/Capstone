import { registerPlugin } from '@capacitor/core';

export interface PermisosExtraPlugin {
  solicitarTelefono(): Promise<{ concedido: boolean }>;
  solicitarContactos(): Promise<{ concedido: boolean }>;
  verificarPermisos(): Promise<{ telefono: boolean; contactos: boolean }>;
  abrirAjustes(): Promise<void>;
  realizarLlamada(options: { telefono: string }): Promise<{ llamada: boolean }>;
  enviarSMS(options: { telefono: string; mensaje: string }): Promise<{ sms: boolean }>;
}

export const PermisosExtra = registerPlugin<PermisosExtraPlugin>('PermisosExtra');

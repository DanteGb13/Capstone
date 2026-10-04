import { registerPlugin } from '@capacitor/core';

export interface ContactoElegido {
  nombre?: string;
  apellido?: string;
  telefono?: string;
  correo?: string;
  /** true si se cerró la agenda sin elegir a nadie. */
  cancelado?: boolean;
}

export interface PermisosExtraPlugin {
  solicitarTelefono(): Promise<{ concedido: boolean }>;
  /**
   * Pide el permiso de contactos con el diálogo del sistema.
   * `abrirAjustes: false` evita que el plugin abra Ajustes solo si se deniega
   * (la pantalla que llama muestra su propio aviso).
   */
  solicitarContactos(opciones?: { abrirAjustes?: boolean }): Promise<{ concedido: boolean }>;
  verificarPermisos(): Promise<{ telefono: boolean; contactos: boolean }>;
  abrirAjustes(): Promise<void>;
  realizarLlamada(options: { telefono: string }): Promise<{ llamada: boolean }>;
  enviarSMS(options: { telefono: string; mensaje: string }): Promise<{ sms: boolean }>;
  /** Abre la agenda del sistema para elegir un contacto. { cancelado: true } si se cierra sin elegir. */
  pickContacto(): Promise<ContactoElegido>;
}

export const PermisosExtra = registerPlugin<PermisosExtraPlugin>('PermisosExtra');

import { registerPlugin } from '@capacitor/core';

export interface PermisosExtraPlugin {
  solicitarTelefono(): Promise<{ concedido: boolean }>;
  solicitarContactos(): Promise<{ concedido: boolean }>;
  verificarPermisos(): Promise<{ telefono: boolean; contactos: boolean }>;
  abrirAjustes(): Promise<void>;
}

export const PermisosExtra = registerPlugin<PermisosExtraPlugin>('PermisosExtra');

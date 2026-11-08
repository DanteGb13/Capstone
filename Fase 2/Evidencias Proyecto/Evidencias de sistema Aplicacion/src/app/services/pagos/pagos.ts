import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseClientProvider } from '../../core/supabase-client';

export type PlanPago = 'mensual' | 'anual';
export type CodigoPlan = PlanPago | null;
export interface PlanActual {
  codigo: CodigoPlan;
  iniciaEn: string | null;
  venceEn: string | null;
}

export interface MejoraAnual {
  disponible: boolean;
  monto: number;
  precioCompleto: number;
  credito: number;
}

export interface MetodoPagoTarjeta {
  id: string;
  marca: string;
  ultimos_cuatro: string;
  mes_expiracion: number;
  ano_expiracion: number;
  titular: string;
  es_predeterminado: boolean;
}

@Injectable({ providedIn: 'root' })
export class PagosService {
  private readonly supabase: SupabaseClient;
  private readonly claveCache = 'siempre_cerca_plan_actual';
  private readonly claveCacheDetalles = 'siempre_cerca_plan_detalles';

  constructor(cliente: SupabaseClientProvider) {
    this.supabase = cliente.get();
  }

  async iniciar(plan: PlanPago, returnUrl: string): Promise<{ token: string; url: string }> {
    const { data, error } = await this.supabase.functions.invoke('pagos-transbank', {
      body: { accion: 'crear', plan, return_url: returnUrl },
    });
    if (error || !data?.token || !data?.url) {
      let detalle = '';
      try {
        detalle = await error?.context?.clone().text();
      } catch {
        detalle = '';
      }
      throw new Error(detalle || error?.message || 'No se pudo iniciar el pago');
    }
    return data as { token: string; url: string };
  }

  async consultarMejoraAnual(): Promise<MejoraAnual> {
    const { data, error } = await this.supabase.functions.invoke('pagos-transbank', {
      body: { accion: 'consultar_mejora' },
    });
    if (error) {
      throw new Error(error.message || 'No se pudo calcular el precio de mejora');
    }
    return {
      disponible: data?.disponible === true,
      monto: Number(data?.monto ?? 70000),
      precioCompleto: Number(data?.precio_completo ?? 70000),
      credito: Number(data?.credito ?? 0),
    };
  }

  async confirmar(token: string): Promise<{ ok: boolean; estado: string; vence_en?: string }> {
    const { data, error } = await this.supabase.functions.invoke('pagos-transbank', {
      body: { accion: 'confirmar', token },
    });
    if (error) throw new Error(error.message || 'No se pudo confirmar el pago');
    if (data?.ok) {
      await this.esperarSuscripcionActualizada();
    }
    return data as { ok: boolean; estado: string; vence_en?: string };
  }

  private async esperarSuscripcionActualizada(): Promise<void> {
    for (let intento = 0; intento < 6; intento++) {
      const usuario = await this.supabase.auth.getUser();
      if (usuario.error || !usuario.data.user) return;

      const { data, error } = await this.supabase
        .from('suscripcion')
        .select('plan_codigo, inicia_en, vence_en')
        .eq('usuario_id', usuario.data.user.id)
        .eq('estado', 'activa')
        .gt('vence_en', new Date().toISOString())
        .order('actualizada_en', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data?.inicia_en && data?.vence_en) {
        const detalles: PlanActual = {
          codigo: data.plan_codigo === 'mensual' || data.plan_codigo === 'anual'
            ? data.plan_codigo
            : null,
          iniciaEn: data.inicia_en,
          venceEn: data.vence_en,
        };
        this.guardarPlanActual(usuario.data.user.id, detalles.codigo);
        this.guardarDetallesPlan(usuario.data.user.id, detalles);
        return;
      }
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
  }

  async cancelar(): Promise<{ modo: 'inmediata' | 'al_finalizar'; devolucion: string }> {
    const { data, error } = await this.supabase.functions.invoke('pagos-transbank', {
      body: { accion: 'cancelar' },
    });
    if (error) throw new Error(error.message || 'No se pudo anular la suscripción');

    const usuario = await this.supabase.auth.getUser();
    if (!usuario.error && usuario.data.user) {
      localStorage.removeItem(`${this.claveCache}_${usuario.data.user.id}`);
      localStorage.removeItem(`${this.claveCacheDetalles}_${usuario.data.user.id}`);
    }
    return {
      modo: data?.modo === 'al_finalizar' ? 'al_finalizar' : 'inmediata',
      devolucion: data?.devolucion || '',
    };
  }

  async obtenerCancelacion(): Promise<{ data: boolean; error: Error | null }> {
    const { data, error } = await this.supabase.functions.invoke('pagos-transbank', {
      body: { accion: 'consultar_cancelacion' },
    });
    return {
      data: data?.reembolso === true,
      error: error ? new Error(error.message || 'No se pudo consultar la cancelación') : null,
    };
  }

  async obtenerMetodoPago(): Promise<MetodoPagoTarjeta | null> {
    const { data, error } = await this.supabase.functions.invoke('metodo-pago', {
      body: { accion: 'consultar' },
    });
    if (error) throw new Error(error.message || 'No se pudo consultar el método de pago');
    return (data?.metodo ?? null) as MetodoPagoTarjeta | null;
  }

  async guardarMetodoPago(datos: {
    numero: string;
    titular: string;
    mes_expiracion: number;
    ano_expiracion: number;
    cvv: string;
    predeterminado: boolean;
  }): Promise<MetodoPagoTarjeta> {
    const { data, error } = await this.supabase.functions.invoke('metodo-pago', {
      body: { accion: 'guardar', ...datos },
    });
    if (error || !data?.metodo) {
      throw new Error(error?.message || 'No se pudo guardar el método de pago');
    }
    return data.metodo as MetodoPagoTarjeta;
  }

  async eliminarMetodoPago(): Promise<void> {
    const { error } = await this.supabase.functions.invoke('metodo-pago', {
      body: { accion: 'eliminar' },
    });
    if (error) throw new Error(error.message || 'No se pudo eliminar el método de pago');
  }

  obtenerPlanActualCacheado(): CodigoPlan {
    const usuarioId = this.obtenerUsuarioIdGuardado();
    if (!usuarioId) return null;
    const valor = localStorage.getItem(`${this.claveCache}_${usuarioId}`);
    return valor === 'mensual' || valor === 'anual' ? valor : null;
  }

  obtenerDetallesPlanCacheados(): PlanActual {
    const usuarioId = this.obtenerUsuarioIdGuardado();
    if (!usuarioId) return { codigo: null, iniciaEn: null, venceEn: null };
    try {
      const datos = JSON.parse(localStorage.getItem(`${this.claveCacheDetalles}_${usuarioId}`) || '{}');
      if (typeof datos.iniciaEn !== 'string' || typeof datos.venceEn !== 'string') {
        return { codigo: null, iniciaEn: null, venceEn: null };
      }
      const codigo = datos.codigo === 'mensual' || datos.codigo === 'anual' ? datos.codigo : null;
      return { codigo, iniciaEn: datos.iniciaEn, venceEn: datos.venceEn };
    } catch {
      return { codigo: null, iniciaEn: null, venceEn: null };
    }
  }

  private obtenerUsuarioIdGuardado(): string | null {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (!clave?.startsWith('sb-') || !clave.endsWith('-auth-token')) continue;
      try {
        const sesion = JSON.parse(localStorage.getItem(clave) || '{}');
        const usuarioId = sesion.user?.id || sesion.currentSession?.user?.id;
        if (typeof usuarioId === 'string') return usuarioId;
      } catch {
        continue;
      }
    }
    return null;
  }

  private guardarPlanActual(usuarioId: string, plan: CodigoPlan): void {
    const clave = `${this.claveCache}_${usuarioId}`;
    if (plan) localStorage.setItem(clave, plan);
    else localStorage.removeItem(clave);
  }

  private guardarDetallesPlan(usuarioId: string, detalles: PlanActual): void {
    const clave = `${this.claveCacheDetalles}_${usuarioId}`;
    if (detalles.codigo && detalles.iniciaEn && detalles.venceEn) {
      localStorage.setItem(clave, JSON.stringify(detalles));
    } else {
      localStorage.removeItem(clave);
    }
  }

  async obtenerPlanActual(): Promise<CodigoPlan> {
    const usuario = await this.supabase.auth.getUser();
    if (usuario.error || !usuario.data.user) return null;

    const { data, error } = await this.supabase
      .from('suscripcion')
      .select('plan_codigo')
      .eq('usuario_id', usuario.data.user.id)
      .eq('estado', 'activa')
      .gt('vence_en', new Date().toISOString())
      .order('vence_en', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      this.guardarPlanActual(usuario.data.user.id, null);
      return null;
    }
    const plan = data.plan_codigo === 'mensual' || data.plan_codigo === 'anual'
      ? data.plan_codigo
      : null;
    this.guardarPlanActual(usuario.data.user.id, plan);
    return plan;
  }

  async obtenerDetallesPlanActual(): Promise<PlanActual> {
    const usuario = await this.supabase.auth.getUser();
    if (usuario.error || !usuario.data.user) {
      return { codigo: null, iniciaEn: null, venceEn: null };
    }

    const { data, error } = await this.supabase
      .from('suscripcion')
      .select('plan_codigo, inicia_en, vence_en')
      .eq('usuario_id', usuario.data.user.id)
      .eq('estado', 'activa')
      .gt('vence_en', new Date().toISOString())
      .order('vence_en', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      this.guardarPlanActual(usuario.data.user.id, null);
      return { codigo: null, iniciaEn: null, venceEn: null };
    }

    const codigo = data.plan_codigo === 'mensual' || data.plan_codigo === 'anual'
      ? data.plan_codigo
      : null;
    this.guardarPlanActual(usuario.data.user.id, codigo);
    const detalles = {
      codigo,
      iniciaEn: data.inicia_en,
      venceEn: data.vence_en,
    };
    this.guardarDetallesPlan(usuario.data.user.id, detalles);
    return detalles;
  }
}

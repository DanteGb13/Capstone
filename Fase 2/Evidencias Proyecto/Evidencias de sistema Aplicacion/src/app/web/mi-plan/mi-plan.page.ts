import { Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { WebNav } from '../web-nav/web-nav';
import { CodigoPlan, PagosService, PlanPago } from '../../services/pagos/pagos';

@Component({
  selector: 'app-mi-plan',
  templateUrl: 'mi-plan.page.html',
  styleUrls: ['mi-plan.page.scss'],
  imports: [WebNav, IonContent],
})
export class MiPlanPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly pagos = inject(PagosService);

  procesando = false;
  mensajePago = '';
  errorPago = false;
  planActual: CodigoPlan = this.pagos.obtenerPlanActualCacheado();
  inicioPlan = this.formatearFecha(this.pagos.obtenerDetallesPlanCacheados().iniciaEn);
  terminoPlan = this.formatearFecha(this.pagos.obtenerDetallesPlanCacheados().venceEn);
  planDestacado = false;
  precioMejoraAnual = 70000;
  creditoMejoraAnual = 0;
  precioMejoraAnualTexto = '70.000';

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.queryParamMap.get('token_ws');
    if (!token) {
      await this.cargarPlanActual();
      await this.cargarPrecioMejora();
      return;
    }

    this.procesando = true;
    try {
      const resultado = await this.pagos.confirmar(token);
      this.errorPago = !resultado.ok;
      this.mensajePago = resultado.ok
        ? 'Pago autorizado. Tu suscripción ya está activa.'
        : 'El pago no fue autorizado. Puedes intentar nuevamente.';
    } catch (error) {
      this.errorPago = true;
      this.mensajePago = error instanceof Error ? error.message : 'No se pudo confirmar el pago.';
    } finally {
      this.procesando = false;
      await this.cargarPlanActual();
      await this.cargarPrecioMejora();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  private async cargarPrecioMejora(): Promise<void> {
    try {
      const mejora = await this.pagos.consultarMejoraAnual();
      if (mejora.disponible) {
        this.precioMejoraAnual = mejora.monto;
        this.creditoMejoraAnual = mejora.credito;
        this.precioMejoraAnualTexto = this.formatearPrecio(mejora.monto);
      }
    } catch {
      this.precioMejoraAnual = 70000;
      this.creditoMejoraAnual = 0;
    }
  }

  private async cargarPlanActual(): Promise<void> {
    try {
      const detalles = await this.pagos.obtenerDetallesPlanActual();
      this.planActual = detalles.codigo;
      this.inicioPlan = this.formatearFecha(detalles.iniciaEn);
      this.terminoPlan = this.formatearFecha(detalles.venceEn);
    } catch {
      this.planActual = null;
      this.inicioPlan = '';
      this.terminoPlan = '';
    }
  }

  private formatearFecha(fecha: string | null): string {
    if (!fecha) return '';
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(fecha));
  }

  private formatearPrecio(monto: number): string {
    return new Intl.NumberFormat('es-CL').format(monto);
  }

  async pagar(plan: PlanPago): Promise<void> {
    this.procesando = true;
    this.mensajePago = '';
    this.errorPago = false;
    try {
      const retorno = `${window.location.origin}/mi-plan`;
      const resultado = await this.pagos.iniciar(plan, retorno);
      window.location.assign(`${resultado.url}?token_ws=${encodeURIComponent(resultado.token)}`);
    } catch (error) {
      this.errorPago = true;
      this.mensajePago = error instanceof Error ? error.message : 'No se pudo iniciar el pago.';
      this.procesando = false;
    }
  }

  async mejorarSuscripcion(): Promise<void> {
    this.planDestacado = true;
    const anual = document.getElementById('plan-anual');
    anual?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      this.planDestacado = false;
    }, 1800);
  }

  async anularSuscripcion(): Promise<void> {
    this.procesando = true;
    this.mensajePago = '';
    this.errorPago = false;
    try {
      const { data: dentroDeReembolso, error } = await this.pagos.obtenerCancelacion();
      if (error) throw error;
      const confirmado = dentroDeReembolso
        ? window.confirm(
            '¿Estás seguro de que deseas perder todos los beneficios de tu suscripción? ' +
            'Si confirmas, la devolución se procesará dentro de 48 horas hábiles.'
          )
        : window.confirm(
            'Tu suscripción continuará activa hasta el final del período pagado. ' +
            'La cancelación se realizará para el siguiente período y no habrá devolución.'
          );
      if (!confirmado) return;

      const resultado = await this.pagos.cancelar();
      this.planActual = null;
      this.inicioPlan = '';
      this.terminoPlan = '';
      this.mensajePago = resultado.modo === 'inmediata'
        ? 'Suscripción anulada. La devolución se realizará dentro de 48 horas hábiles.'
        : 'La suscripción se cancelará al finalizar el período pagado. No habrá devolución.';
    } catch (error) {
      this.errorPago = true;
      this.mensajePago = error instanceof Error ? error.message : 'No se pudo anular la suscripción.';
    } finally {
      this.procesando = false;
    }
  }
}

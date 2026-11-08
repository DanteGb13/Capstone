import { Component, OnInit, inject } from '@angular/core';
import { AlertController, IonContent, IonIcon, IonModal } from '@ionic/angular';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { WebNav } from '../web-nav/web-nav';
import { CodigoPlan, PagosService, PlanPago } from '../../services/pagos/pagos';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { createOutline, trashOutline } from 'ionicons/icons';

@Component({
  selector: 'app-mi-plan',
  templateUrl: 'mi-plan.page.html',
  styleUrls: ['mi-plan.page.scss'],
  imports: [WebNav, IonContent, IonIcon, IonModal, RouterLink, FormsModule],
})
export class MiPlanPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly pagos = inject(PagosService);
  private readonly alertCtrl = inject(AlertController);

  constructor() {
    addIcons({ createOutline, trashOutline });
  }

  procesando = false;
  mensajePago = '';
  errorPago = false;
  planActual: CodigoPlan = this.pagos.obtenerPlanActualCacheado();
  inicioPlan = this.formatearFecha(this.pagos.obtenerDetallesPlanCacheados().iniciaEn);
  terminoPlan = this.formatearFecha(this.pagos.obtenerDetallesPlanCacheados().venceEn);
  inicioPlanRaw = this.pagos.obtenerDetallesPlanCacheados().iniciaEn ?? '';
  terminoPlanRaw = this.pagos.obtenerDetallesPlanCacheados().venceEn ?? '';
  planDestacado = false;
  precioMejoraAnual = 70000;
  creditoMejoraAnual = 0;
  precioMejoraAnualTexto = '70.000';
  metodoPagoGuardado: {
    marca: string;
    ultimos_cuatro: string;
    mes_expiracion: number;
    ano_expiracion: number;
    titular: string;
    es_predeterminado: boolean;
  } | null = null;
  cargandoMetodoPago = true;
  mostrarFormularioTarjeta = false;
  editandoTarjeta = false;
  tarjetaNumero = '';
  tarjetaTitular = '';
  tarjetaExpiracion = '';
  tarjetaCvv = '';
  tarjetaPredeterminada = true;
  async ngOnInit(): Promise<void> {
    this.metodoPagoGuardado = this.pagos.obtenerMetodoPagoCacheado();
    if (this.metodoPagoGuardado) this.cargandoMetodoPago = false;
    const token = this.route.snapshot.queryParamMap.get('token_ws');
    if (!token) {
      await Promise.all([
        this.cargarPlanActual(),
        this.cargarPrecioMejora(),
        this.cargarMetodoPago(),
      ]);
      return;
    }

    this.procesando = true;
    const alertaProcesando = await this.mostrarProcesandoPago();
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
      await alertaProcesando.dismiss();
      this.procesando = false;
      await this.cargarPlanActual();
      await this.cargarPrecioMejora();
      await this.cargarMetodoPago();
      window.history.replaceState({}, document.title, window.location.pathname);
      await this.mostrarResultadoPago(this.errorPago, this.mensajePago);
    }
  }

    private async cargarMetodoPago(): Promise<void> {
      try {
        this.metodoPagoGuardado = await this.pagos.obtenerMetodoPago();
      } catch {
        this.metodoPagoGuardado = null;
      } finally {
        this.cargandoMetodoPago = false;
      }
    }

    abrirFormularioTarjeta(): void {
      this.editandoTarjeta = this.metodoPagoGuardado !== null;
      if (this.metodoPagoGuardado) {
        this.tarjetaTitular = this.metodoPagoGuardado.titular;
        this.tarjetaExpiracion =
          `${String(this.metodoPagoGuardado.mes_expiracion).padStart(2, '0')}/${String(this.metodoPagoGuardado.ano_expiracion).slice(-2)}`;
        this.tarjetaPredeterminada = this.metodoPagoGuardado.es_predeterminado;
      }
      this.mostrarFormularioTarjeta = true;
    }

    cancelarFormularioTarjeta(): void {
      this.mostrarFormularioTarjeta = false;
      this.limpiarFormularioTarjeta();
    }

    formatearNumeroTarjeta(): void {
      const digitos = this.tarjetaNumero.replace(/\D/g, '').slice(0, 19);
      this.tarjetaNumero = digitos.replace(/(.{4})/g, '$1 ').trim();
    }

    formatearExpiracion(): void {
      const digitos = this.tarjetaExpiracion.replace(/\D/g, '').slice(0, 4);
      this.tarjetaExpiracion = digitos.length > 2
        ? `${digitos.slice(0, 2)}/${digitos.slice(2)}`
        : digitos;
    }

    formatearTitular(): void {
      this.tarjetaTitular = this.tarjetaTitular
        .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 80);
    }

    cerrarOtrosDetalles(evento: Event): void {
      const detallesAbiertos = evento.target as HTMLDetailsElement;
      if (!detallesAbiertos.open) return;

      document.querySelectorAll<HTMLDetailsElement>('.plan__detalles[open]').forEach((detalles) => {
        if (detalles !== detallesAbiertos) detalles.open = false;
      });
    }

    async guardarTarjeta(): Promise<void> {
      this.procesando = true;
      try {
        const [mesTexto, anoTexto = ''] = this.tarjetaExpiracion.split('/');
        const mes = Number(mesTexto);
        const ano = anoTexto ? 2000 + Number(anoTexto) : 0;
        this.metodoPagoGuardado = await this.pagos.guardarMetodoPago({
          numero: this.tarjetaNumero,
          titular: this.tarjetaTitular,
          mes_expiracion: mes,
          ano_expiracion: ano,
          cvv: this.tarjetaCvv,
          predeterminado: this.tarjetaPredeterminada,
          editar: this.editandoTarjeta,
        });
        this.cancelarFormularioTarjeta();
        await this.mostrarResultadoAccion(
          'Tarjeta guardada',
          this.editandoTarjeta
            ? 'Los datos de la tarjeta fueron actualizados.'
            : 'Tu tarjeta se guardó con éxito.',
        );
      } catch (error) {
        await this.mostrarResultadoAccion(
          'No se pudo guardar la tarjeta',
          error instanceof Error ? error.message : 'Intenta nuevamente.',
          true,
        );
      } finally {
        this.procesando = false;
      }
    }

    async eliminarTarjeta(): Promise<void> {
      const confirmada = await this.confirmarEliminacionTarjeta();
      if (!confirmada) return;

      this.procesando = true;
      try {
        await this.pagos.eliminarMetodoPago();
        this.metodoPagoGuardado = null;
      } catch (error) {
        await this.mostrarResultadoAccion(
          'No se pudo eliminar la tarjeta',
          error instanceof Error ? error.message : 'Intenta nuevamente.',
          true,
        );
      } finally {
        this.procesando = false;
      }
    }

    private limpiarFormularioTarjeta(): void {
      this.editandoTarjeta = false;
      this.tarjetaNumero = '';
      this.tarjetaTitular = '';
      this.tarjetaExpiracion = '';
      this.tarjetaCvv = '';
      this.tarjetaPredeterminada = true;
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
      this.inicioPlanRaw = detalles.iniciaEn ?? '';
      this.terminoPlanRaw = detalles.venceEn ?? '';
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

  get porcentajeVigencia(): number {
    const inicio = new Date(this.inicioPlanRaw).getTime();
    const termino = new Date(this.terminoPlanRaw).getTime();
    const ahora = Date.now();
    if (!inicio || !termino || termino <= inicio) return 0;
    return Math.max(0, Math.min(100, Math.round(((ahora - inicio) / (termino - inicio)) * 100)));
  }

  get diasRestantes(): number {
    const termino = new Date(this.terminoPlanRaw).getTime();
    if (!termino) return 0;
    return Math.max(0, Math.ceil((termino - Date.now()) / 86400000));
  }

  get precioPlanActual(): string {
    return this.planActual === 'mensual' ? '$ 7.000 al mes' : '$ 70.000 al año';
  }

  async pagar(plan: PlanPago): Promise<void> {
    if (!this.metodoPagoGuardado) {
      await this.cargarMetodoPago();
    }
    if (!this.metodoPagoGuardado) {
      await this.mostrarResultadoAccion(
        'Agrega un método de pago',
        'Necesitas agregar una tarjeta antes de adquirir un plan.',
        true,
      );
      return;
    }

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
      await this.mostrarResultadoPago(true, this.mensajePago);
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
      const confirmado = await this.confirmarCancelacion(dentroDeReembolso);
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
      if (this.mensajePago) {
        await this.mostrarResultadoAccion(
          this.errorPago ? 'No se pudo anular la suscripción' : 'Suscripción anulada',
          this.mensajePago,
          this.errorPago,
        );
      }
    }
  }

  private async mostrarProcesandoPago() {
    const alerta = await this.alertCtrl.create({
      header: 'Procesando pago',
      message: 'Estamos verificando tu suscripción…',
      backdropDismiss: false,
      buttons: [],
    });
    await alerta.present();
    return alerta;
  }

  private async mostrarResultadoPago(error: boolean, mensaje: string): Promise<void> {
    const alerta = await this.alertCtrl.create({
      header: error ? 'No se pudo completar el pago' : 'Pago completado',
      message: mensaje,
      buttons: ['Entendido'],
    });
    await alerta.present();
  }

  private async mostrarResultadoAccion(titulo: string, mensaje: string, error = false): Promise<void> {
    const alerta = await this.alertCtrl.create({
      header: titulo,
      message: mensaje,
      cssClass: error ? 'alerta-accion-error' : 'alerta-accion-exito',
      buttons: ['Entendido'],
    });
    await alerta.present();
  }

  private async confirmarCancelacion(dentroDeReembolso: boolean): Promise<boolean> {
    const alerta = await this.alertCtrl.create({
      header: dentroDeReembolso ? 'Anular suscripción' : 'Cancelación al finalizar el período',
      message: dentroDeReembolso
        ? '¿Estás seguro de que deseas perder todos los beneficios de tu suscripción?'
        : '¿Estás seguro de que deseas cancelar la suscripción al finalizar el período pagado?',
      buttons: [
        { text: 'Volver', role: 'cancel' },
        {
          text: dentroDeReembolso ? 'Sí, anular' : 'Programar cancelación',
          role: 'destructive',
          handler: () => true,
        },
      ],
    });
    await alerta.present();
    const resultado = await alerta.onDidDismiss();
    return resultado.role === 'destructive';
  }

  private async confirmarEliminacionTarjeta(): Promise<boolean> {
    const alerta = await this.alertCtrl.create({
      header: 'Eliminar tarjeta',
      message: '¿Estás seguro de que deseas eliminar esta tarjeta?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: () => true,
        },
      ],
    });
    await alerta.present();
    const resultado = await alerta.onDidDismiss();
    return resultado.role === 'destructive';
  }
}

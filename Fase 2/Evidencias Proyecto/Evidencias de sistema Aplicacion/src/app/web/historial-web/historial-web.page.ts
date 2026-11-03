import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { WebNav } from '../web-nav/web-nav';
import { SupabaseClientProvider } from '../../core/supabase-client';
import { jsPDF } from 'jspdf';

interface MovimientoFacturacion {
  codigoTransaccion?: string;
  codigoTransbank?: string;
  codigoAutorizacion?: string;
  formaPago?: string;
  cuenta?: string;
  comercio?: string;
  fecha: string;
  concepto: string;
  plan: string;
  monto: number;
  estado: string;
  esPago?: boolean;
}

@Component({
  selector: 'app-historial-web',
  templateUrl: 'historial-web.page.html',
  styleUrls: ['historial-web.page.scss'],
  imports: [WebNav, IonContent],
})
export class HistorialWebPage implements OnInit {
  movimientos: MovimientoFacturacion[] = [];
  cargando = true;
  filtroActivo: 'todos' | 'pagados' | 'cancelados' = 'todos';

  private readonly supabase = inject(SupabaseClientProvider).get();
  private readonly cdr = inject(ChangeDetectorRef);

  get movimientosFiltrados(): MovimientoFacturacion[] {
    if (this.filtroActivo === 'pagados') {
      return this.movimientos.filter(movimiento => movimiento.esPago);
    }
    if (this.filtroActivo === 'cancelados') {
      return this.movimientos.filter(movimiento => !movimiento.esPago);
    }
    return this.movimientos;
  }

  async ngOnInit(): Promise<void> {
    const usuario = await this.supabase.auth.getUser();
    if (usuario.error || !usuario.data.user) {
      this.cargando = false;
      this.refrescar();
      return;
    }

    const usuarioId = usuario.data.user.id;
    const [pagos, suscripciones] = await Promise.all([
      this.supabase
        .from('transaccion_pago')
        .select('buy_order, plan_codigo, monto, estado, creada_en, respuesta_transbank')
        .eq('usuario_id', usuarioId)
        .order('creada_en', { ascending: false }),
      this.supabase
        .from('suscripcion')
        .select('plan_codigo, estado, cancelada_en, creada_en, devolucion_estado')
        .eq('usuario_id', usuarioId)
        .order('creada_en', { ascending: false }),
    ]);

    const movimientosPagos: MovimientoFacturacion[] = (pagos.data ?? [])
      .filter(pago => pago.estado === 'autorizada')
      .map(pago => ({
      codigoTransaccion: pago.buy_order,
      codigoTransbank: this.valorTransbank(pago.respuesta_transbank, 'authorization_code'),
      codigoAutorizacion: this.valorTransbank(pago.respuesta_transbank, 'authorization_code'),
      formaPago: this.formaPago(this.valorTransbank(pago.respuesta_transbank, 'payment_type_code')),
      cuenta: this.valorTransbank(pago.respuesta_transbank, 'card_detail', 'card_number'),
      comercio: 'SiempreCerca',
      fecha: pago.creada_en,
      concepto: pago.estado === 'autorizada' ? 'Pago autorizado' : `Pago ${pago.estado}`,
      plan: this.nombrePlan(pago.plan_codigo),
      monto: Number(pago.monto ?? 0),
      estado: pago.estado,
      esPago: true,
    }));

    const movimientosCancelaciones: MovimientoFacturacion[] = (suscripciones.data ?? [])
      .filter(suscripcion => suscripcion.cancelada_en)
      .map(suscripcion => ({
        fecha: suscripcion.cancelada_en,
        concepto: suscripcion.devolucion_estado === 'programada'
          ? 'Suscripción anulada y devolución solicitada'
          : 'Suscripción cancelada',
        plan: this.nombrePlan(suscripcion.plan_codigo),
        monto: 0,
        estado: 'cancelada',
      }));

    this.movimientos = [...movimientosPagos, ...movimientosCancelaciones]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    this.cargando = false;
    this.refrescar();
  }

  descargarCsv(): void {
    const filas = [
      ['Fecha', 'Motivo', 'Plan', 'Monto', 'Estado'],
      ...this.movimientos.map(movimiento => [
        this.formatearFecha(movimiento.fecha),
        movimiento.concepto,
        movimiento.plan,
        String(movimiento.monto),
        this.estadoVisible(movimiento),
      ]),
    ];
    const contenido = filas
      .map(fila => fila.map(valor => `"${String(valor).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const archivo = new Blob(['\ufeff', contenido], { type: 'text/csv;charset=utf-8' });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = 'historial-facturacion.csv';
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  async descargarComprobante(movimiento: MovimientoFacturacion): Promise<void> {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const violeta = '#7738d9';
    const azulNoche = '#202b4d';
    const moradoTexto = '#3f4fb7';

    pdf.setFillColor(violeta);
    pdf.roundedRect(15, 12, 180, 24, 4, 4, 'F');
    try {
      const logo = await this.imagenComoDataUrl('/assets/logo/logo-128.png');
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(17.5, 13.5, 21, 21, 3, 3, 'F');
      pdf.addImage(logo, 'PNG', 18.5, 14.5, 19, 19);
    } catch {
      // El comprobante sigue disponible aunque el logo aún esté cargando.
    }
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('Siempre Cerca', 42, 27);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Comprobante de pago', 145, 27);

    pdf.setTextColor(azulNoche);
    pdf.setFontSize(11);
    const etiquetas = [
      ['Código Transacción:', 52],
      ['Monto:', 64],
      ['Forma de pago:', 76],
      ['Cuenta:', 88],
      ['Comercio:', 100],
      ['Fecha:', 112],
    ] as const;
    const valores = [
      movimiento.codigoTransaccion || 'No disponible',
      `$ ${this.formatearMonto(movimiento.monto)}`,
      movimiento.formaPago || 'Débito',
      movimiento.cuenta || 'No disponible',
      movimiento.comercio || 'Siempre Cerca',
      this.formatearFecha(movimiento.fecha),
    ];

    etiquetas.forEach(([etiqueta, y], indice) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(moradoTexto);
      pdf.text(etiqueta, 86, y, { align: 'right' });
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(35, 38, 48);
      pdf.setFontSize(indice === 0 ? 8.5 : 10);
      const lineas = pdf.splitTextToSize(valores[indice], 98);
      pdf.text(lineas, 92, y);
      pdf.setFontSize(11);
    });

    pdf.setFillColor(52, 168, 83);
    pdf.roundedRect(73, 151, 64, 12, 3, 3, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('Pagado', 105, 159, { align: 'center' });

    pdf.setTextColor(102, 95, 120);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Comprobante de pago', 105, 268, { align: 'center' });
    pdf.save(`comprobante-${movimiento.codigoTransaccion || 'transaccion'}.pdf`);
  }

  private async imagenComoDataUrl(ruta: string): Promise<string> {
    const respuesta = await fetch(ruta);
    const blob = await respuesta.blob();
    return await new Promise<string>((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(String(lector.result));
      lector.onerror = () => rechazar(lector.error);
      lector.readAsDataURL(blob);
    });
  }

  private valorTransbank(respuesta: unknown, campo: string, subcampo?: string): string {
    if (!respuesta || typeof respuesta !== 'object') return '';
    const objeto = respuesta as Record<string, unknown>;
    const valor = subcampo && objeto[campo] && typeof objeto[campo] === 'object'
      ? (objeto[campo] as Record<string, unknown>)[subcampo]
      : objeto[campo];
    return valor === undefined || valor === null ? '' : String(valor);
  }

  private formaPago(codigo: string): string {
    if (codigo === 'VN' || codigo === 'VC') return 'Crédito';
    return codigo ? `Débito (${codigo})` : 'Débito';
  }

  formatearMonto(monto: number): string {
    return new Intl.NumberFormat('es-CL').format(monto);
  }

  formatearFecha(fecha: string): string {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(fecha));
  }

  estadoVisible(movimiento: MovimientoFacturacion): string {
    return movimiento.esPago ? 'Pagado' : 'Cancelado';
  }

  private nombrePlan(plan: string): string {
    return plan === 'anual' ? 'Plan anual' : plan === 'mensual' ? 'Plan mensual' : plan;
  }

  private refrescar(): void {
    this.cdr.markForCheck();
  }
}

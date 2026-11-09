import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, createOutline, downloadOutline, eyeOutline } from 'ionicons/icons';
import { jsPDF } from 'jspdf';
import { WebNav } from '../web-nav/web-nav';
import { SupabaseClientProvider } from '../../core/supabase-client';

interface SuscripcionAdministrada {
  /** Null cuando el cuidador todavía no tiene ninguna suscripción. */
  id: string | null;
  usuario_id: string;
  nombre: string;
  correo: string;
  plan_codigo: 'mensual' | 'anual' | string | null;
  estado: string;
  inicia_en: string | null;
  vence_en: string | null;
  mejora_en: string | null;
  plan_anterior_codigo: string | null;
}

/** Un pago de `transaccion_pago`, tal como lo devuelve la acción `pagos`. */
interface PagoHistorial {
  usuario_id: string;
  nombre: string;
  correo: string;
  plan_codigo: string;
  monto: number;
  monto_original_clp: number | null;
  credito_prorrateado_clp: number | null;
  tipo: string;
  estado: string;
  buy_order: string;
  creada_en: string;
  respuesta_transbank: unknown;
}

@Component({
  selector: 'app-finanzas',
  templateUrl: 'finanzas.page.html',
  styleUrls: ['finanzas.page.scss'],
  imports: [WebNav, IonContent, IonIcon, FormsModule],
})
export class FinanzasPage implements OnInit {

  busqueda = '';
  /** '' = todos, 'con' = con suscripción, 'sin' = sin suscripción,
   * 'cancelada' = con la suscripción cancelada. */
  filtroSuscripcion = '';
  /** '' = todos, 'mensual' o 'anual'. */
  filtroPlan = '';
  suscripciones: SuscripcionAdministrada[] = [];
  paginaActual = 1;
  tamanoPagina = 11;
  cargandoSuscripciones = false;
  mensajeSuscripciones = '';

  private cdr = inject(ChangeDetectorRef);
  private alertCtrl = inject(AlertController);
  private clienteSupabase = inject(SupabaseClientProvider).get();

  constructor() {
    addIcons({ closeOutline, createOutline, downloadOutline, eyeOutline });
  }

  get suscripcionesFiltradas(): SuscripcionAdministrada[] {
    return this.suscripciones.filter(suscripcion =>
      this.coincide(suscripcion, this.normalizar(this.busqueda), this.filtroSuscripcion, this.filtroPlan));
  }

  /**
   * Cuidadores que entran en la descarga según los filtros de la ventana.
   * La misma lógica de la tabla, sin el buscador: acá sólo se filtra por
   * suscripción y plan.
   */
  get cuidadoresDescarga(): SuscripcionAdministrada[] {
    return this.suscripciones.filter(suscripcion =>
      this.coincide(suscripcion, '', this.descargaSuscripcion, this.descargaPlan));
  }

  /** ¿Esta fila pasa el buscador y los dos filtros? */
  private coincide(
    suscripcion: SuscripcionAdministrada,
    texto: string,
    filtroSuscripcion: string,
    filtroPlan: string
  ): boolean {
    const coincideBusqueda = !texto
      || this.normalizar(suscripcion.nombre).includes(texto)
      || this.normalizar(suscripcion.correo).includes(texto);

    // Las categorías no se pisan: "Con suscripción" excluye a las canceladas
    // para que "Canceladas" muestre sólo esas y no se repitan en ambas.
    const coincideSuscripcion = !filtroSuscripcion
      || (filtroSuscripcion === 'con'
        && suscripcion.estado !== 'sin_suscripcion'
        && suscripcion.estado !== 'cancelada')
      || (filtroSuscripcion === 'sin' && suscripcion.estado === 'sin_suscripcion')
      || (filtroSuscripcion === 'cancelada' && suscripcion.estado === 'cancelada');

    const coincidePlan = !filtroPlan || suscripcion.plan_codigo === filtroPlan;

    return coincideBusqueda && coincideSuscripcion && coincidePlan;
  }

  get suscripcionesPagina(): SuscripcionAdministrada[] {
    const inicio = (this.paginaActual - 1) * this.tamanoPagina;
    return this.suscripcionesFiltradas.slice(inicio, inicio + this.tamanoPagina);
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.suscripcionesFiltradas.length / this.tamanoPagina));
  }

  get paginasVisibles(): number[] {
    const total = this.totalPaginas;
    const actual = this.paginaActual;

    if (total <= 7) {
      return Array.from({ length: total }, (_, indice) => indice + 1);
    }

    const paginas: number[] = [1];
    const inicio = Math.max(2, actual - 1);
    const fin = Math.min(total - 1, actual + 1);

    if (inicio > 2) paginas.push(-1);
    for (let pagina = inicio; pagina <= fin; pagina++) paginas.push(pagina);
    if (fin < total - 1) paginas.push(-1);
    paginas.push(total);

    return paginas;
  }

  get numeroPrimerCuidador(): number {
    return this.suscripcionesFiltradas.length ? (this.paginaActual - 1) * this.tamanoPagina + 1 : 0;
  }

  get numeroUltimoCuidador(): number {
    return Math.min(this.paginaActual * this.tamanoPagina, this.suscripcionesFiltradas.length);
  }

  /** Al cambiar un filtro se vuelve a la primera página: si no, se puede
   * quedar apuntando a una página que ya no existe. */
  alCambiarFiltros(): void {
    this.paginaActual = 1;
    this.refrescar();
  }

  alCambiarTamanoPagina(): void {
    this.paginaActual = 1;
    this.refrescar();
  }

  irAPagina(pagina: number): void {
    this.paginaActual = Math.max(1, Math.min(pagina, this.totalPaginas));
    this.refrescar();
  }

  /**
   * Abre la ventana de descarga con los filtros que la tabla tenga puestos,
   * para que lo que se baja sea lo mismo que se está viendo.
   */
  abrirDescarga(): void {
    this.descargaSuscripcion = this.filtroSuscripcion;
    this.descargaPlan = this.filtroPlan;
    this.descargaAbierta = true;
    this.refrescar();
  }

  cerrarDescarga(): void {
    this.descargaAbierta = false;
    this.refrescar();
  }

  /**
   * CSV general del botón Descargar: los pagos de los cuidadores que pasan
   * los filtros de la ventana. Los que nunca pagaron también entran, con
   * "Sin registro" en la fila, para que el archivo cubra a todos.
   */
  async descargarCsv(): Promise<void> {
    const seleccionados = this.cuidadoresDescarga;
    if (!seleccionados.length) {
      this.mensajeSuscripciones = 'Ningún cuidador coincide con los filtros de la descarga.';
      this.cerrarDescarga();
      this.refrescar();
      return;
    }

    this.descargandoPagos = true;
    this.mensajeSuscripciones = '';
    this.refrescar();

    const { data, error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: {
        accion: 'pagos',
        usuario_ids: seleccionados.map(suscripcion => suscripcion.usuario_id),
        plan_codigo: this.descargaPlan,
      },
    });
    this.descargandoPagos = false;
    this.descargaAbierta = false;

    const pagos: PagoHistorial[] = Array.isArray(data?.pagos) ? data.pagos : [];
    const sinPagos: Array<{ nombre: string; correo: string }> = Array.isArray(data?.sinPagos) ? data.sinPagos : [];
    if (error || (!pagos.length && !sinPagos.length)) {
      this.mensajeSuscripciones = 'No se pudieron descargar los pagos.';
      this.refrescar();
      return;
    }

    const contenido = [
      ['Cuidador', 'Correo', 'Fecha', 'Plan', 'Monto', 'Estado', 'Código de compra'],
      ...pagos.map(pago => [
        pago.nombre || 'Sin nombre',
        pago.correo || 'Sin registro',
        this.formatearFecha(pago.creada_en),
        this.nombrePlan(pago.plan_codigo),
        String(pago.monto),
        this.textoEstadoPago(pago.estado),
        pago.buy_order || 'Sin registro',
      ]),
      // Sin compras: una fila por cuidador con "Sin registro" donde no hay
      // dato, para que el CSV no lleve celdas vacías.
      ...sinPagos.map(cuidador => [
        cuidador.nombre || 'Sin nombre',
        cuidador.correo || 'Sin registro',
        'Sin registro',
        'Sin registro',
        'Sin registro',
        'Sin pagos',
        'Sin registro',
      ]),
    ]
      .map(fila => fila.map(valor => `"${String(valor).replaceAll('"', '""')}"`).join(','))
      .join('\r\n');

    this.descargarArchivo(contenido, `finanzas_pagos_${new Date().toISOString().slice(0, 10)}.csv`);
    this.refrescar();
  }

  /** CSV con todos los pagos del cuidador que está abierto en el historial. */
  descargarHistorialCsv(): void {
    if (!this.pagosHistorial.length) return;

    const contenido = [
      ['Fecha', 'Plan', 'Monto', 'Estado', 'Código de compra'],
      ...this.pagosHistorial.map(pago => [
        this.formatearFecha(pago.creada_en),
        this.nombrePlan(pago.plan_codigo),
        String(pago.monto),
        this.textoEstadoPago(pago.estado),
        pago.buy_order,
      ]),
    ]
      .map(fila => fila.map(valor => `"${String(valor).replaceAll('"', '""')}"`).join(','))
      .join('\r\n');

    const nombre = (this.historialTitulo || 'cuidador').replace(/\s+/g, '_').toLowerCase();
    this.descargarArchivo(contenido, `pagos_${nombre}_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  /**
   * Comprobante en PDF de UN pago. Mismo diseño que el comprobante que la
   * app muestra en su historial, con el nombre del cuidador agregado porque
   * éste lo emite el administrador.
   */
  async descargarComprobante(pago: PagoHistorial): Promise<void> {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const violeta = '#7738d9';
    const azulNoche = '#202b4d';
    const moradoTexto = '#3f4fb7';
    const codigoTransbank = this.valorTransbank(pago.respuesta_transbank, 'authorization_code');
    const formaPago = this.formaPago(this.valorTransbank(pago.respuesta_transbank, 'payment_type_code'));
    const cuenta = this.valorTransbank(pago.respuesta_transbank, 'card_detail', 'card_number') || 'No disponible';

    pdf.setFillColor(violeta);
    pdf.roundedRect(15, 12, 180, 24, 4, 4, 'F');
    try {
      const logo = await this.imagenComoDataUrl('/assets/logo/logo-128.png');
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(17.5, 13.5, 21, 21, 3, 3, 'F');
      pdf.addImage(logo, 'PNG', 18.5, 14.5, 19, 19);
    } catch {
      // El comprobante sigue disponible aunque el logo aún no esté cargado.
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
      ['Cuidador:', 64],
      ['Monto:', 76],
      ['Forma de pago:', 88],
      ['Cuenta:', 100],
      ['Comercio:', 112],
      ['Fecha:', 124],
    ] as const;
    const valores = [
      pago.buy_order || 'No disponible',
      this.historialTitulo || 'No disponible',
      `$ ${new Intl.NumberFormat('es-CL').format(pago.monto)}`,
      formaPago || 'Débito',
      cuenta,
      'SiempreCerca',
      this.formatearFecha(pago.creada_en),
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

    // Etiqueta con el estado real del pago: no todos los pagos quedaron
    // autorizados (también hay rechazados y anulados).
    const autorizado = pago.estado === 'autorizada';
    const colorEstado: [number, number, number] = autorizado ? [52, 168, 83] : [220, 38, 38];
    pdf.setFillColor(...colorEstado);
    pdf.roundedRect(73, 163, 64, 12, 3, 3, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(this.textoEstadoPago(pago.estado).toUpperCase(), 105, 171, { align: 'center' });

    pdf.setTextColor(102, 95, 120);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Comprobante de pago', 105, 272, { align: 'center' });
    pdf.save(`comprobante-${pago.buy_order || 'transaccion'}.pdf`);

    if (codigoTransbank) {
      // El código de autorización de Transbank no cabe en la etiqueta grande.
      pdf.setTextColor(102, 95, 120);
      pdf.setFontSize(8);
      pdf.text(`Autorización Transbank: ${codigoTransbank}`, 105, 278, { align: 'center' });
    }
  }

  private descargarArchivo(contenido: string, nombre: string): void {
    const blob = new Blob(['\ufeff', contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(url);
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

  /** Abre el mini panel de historial de pagos del cuidador (el ojito). */
  async verHistorial(suscripcion: SuscripcionAdministrada): Promise<void> {
    this.historialAbierto = true;
    this.historialTitulo = suscripcion.nombre || suscripcion.correo || 'Sin nombre';
    this.historialCargando = true;
    this.historialMensaje = '';
    this.pagosHistorial = [];
    this.refrescar();

    const { data, error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'pagos', usuario_id: suscripcion.usuario_id },
    });
    this.historialCargando = false;
    if (error) {
      this.historialMensaje = 'No se pudieron cargar los pagos de este cuidador.';
    } else {
      this.pagosHistorial = Array.isArray(data?.pagos) ? data.pagos : [];
    }
    this.refrescar();
  }

  cerrarHistorial(): void {
    this.historialAbierto = false;
    this.pagosHistorial = [];
    this.historialMensaje = '';
    this.refrescar();
  }

  /** Precio en pesos chilenos, con el formato del resto de la app. */
  formatearMonto(monto: number): string {
    return `$ ${new Intl.NumberFormat('es-CL').format(monto)}`;
  }

  textoTipoPago(tipo: string): string {
    return tipo === 'mejora' ? 'Mejora' : tipo === 'nueva' ? 'Nueva' : tipo;
  }

  textoEstadoPago(estado: string): string {
    switch (estado) {
      case 'autorizada': return 'Autorizado';
      case 'rechazada': return 'Rechazado';
      case 'anulada': return 'Anulado';
      case 'procesando': return 'Procesando';
      case 'creada': return 'Creado';
      default: return estado;
    }
  }

  /** Estado del mini panel de historial de pagos (lo abre el ojito). */
  historialAbierto = false;
  historialTitulo = '';
  historialCargando = false;
  historialMensaje = '';
  pagosHistorial: PagoHistorial[] = [];

  /** Mientras se baja el CSV general de todos los pagos. */
  descargandoPagos = false;

  /** Filtros de la ventana de descarga: arrancan con los de la tabla. */
  descargaAbierta = false;
  descargaSuscripcion = '';
  descargaPlan = '';

  async ngOnInit() {
    await this.cargarSuscripciones();
  }

  async cargarSuscripciones(): Promise<void> {
    this.cargandoSuscripciones = true;
    this.mensajeSuscripciones = '';
    const { data, error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'listar' },
    });
    if (error) {
      const detalle = await this.detalleError(error, data);
      this.mensajeSuscripciones = detalle
        ? `No se pudieron cargar las suscripciones. ${detalle}`
        : 'No se pudieron cargar las suscripciones.';
    } else {
      this.suscripciones = Array.isArray(data?.suscripciones) ? data.suscripciones : [];
    }
    this.cargandoSuscripciones = false;
    this.refrescar();
  }

  async abrirGestion(suscripcion: SuscripcionAdministrada): Promise<void> {
    const opciones = this.opcionesPara(suscripcion);

    const alerta = await this.alertCtrl.create({
      header: suscripcion.nombre || suscripcion.correo || 'Sin nombre',
      subHeader: this.subtituloMenu(suscripcion),
      message: this.resumenMenu(suscripcion),
      cssClass: 'finanzas-alerta',
      buttons: [
        ...opciones.map(opcion => ({
          text: opcion.texto,
          role: opcion.role,
          // 'destructive' ya se pinta sola (Ionic le pone la clase por el rol).
          cssClass: opcion.role === 'destructive' ? undefined : 'alerta-btn-accion',
        })),
        { text: 'Volver', role: 'cancel' },
      ],
    });
    await alerta.present();

    const { role } = await alerta.onDidDismiss();
    switch (role) {
      case 'activar-mensual':
        await this.activar(suscripcion, 'mensual');
        break;
      case 'activar-anual':
        await this.activar(suscripcion, 'anual');
        break;
      case 'activar':
        await this.activar(suscripcion);
        break;
      case 'destructive':
        await this.inhabilitar(suscripcion);
        break;
      case 'mejorar':
        await this.mejorar(suscripcion);
        break;
      case 'degradar':
        await this.degradar(suscripcion);
        break;
    }
  }

  /** Opciones de la mini ventana según lo que tenga el cuidador. */
  private opcionesPara(suscripcion: SuscripcionAdministrada): { texto: string; role: string }[] {
    // Sin licencia todavía: se elige el plan con el que se activa.
    if (!suscripcion.id) {
      return [
        { texto: 'Activar mensual', role: 'activar-mensual' },
        { texto: 'Activar anual', role: 'activar-anual' },
      ];
    }

    const cambiarPlan = suscripcion.plan_codigo === 'mensual'
      ? { texto: 'Mejorar a anual', role: 'mejorar' }
      : { texto: 'Degradar a mensual', role: 'degradar' };

    const estado = suscripcion.estado === 'activa'
      ? { texto: 'Inhabilitar', role: 'destructive' }
      : { texto: 'Activar', role: 'activar' };

    return [cambiarPlan, estado];
  }

  private subtituloMenu(suscripcion: SuscripcionAdministrada): string {
    const plan = suscripcion.id ? this.nombrePlan(suscripcion.plan_codigo) : 'Sin suscripción';
    return `${plan} · ${this.textoEstado(suscripcion.estado)}`;
  }

  /** Segunda línea de la ventana: qué pasa con la vigencia de la suscripción. */
  private resumenMenu(suscripcion: SuscripcionAdministrada): string {
    if (!suscripcion.id) {
      return 'Todavía no tiene licencia.\nElige el plan que quieres activar.';
    }
    if (suscripcion.estado === 'activa') {
      const vencimiento = suscripcion.vence_en ? this.formatearFecha(suscripcion.vence_en) : '';
      return vencimiento ? `Vence el ${vencimiento}.` : 'Sin fecha de vencimiento.';
    }
    return `La suscripción está ${this.textoEstado(suscripcion.estado).toLowerCase()}.\nPuedes activarla de nuevo cuando quieras.`;
  }

  async activar(suscripcion: SuscripcionAdministrada, planElegido?: string): Promise<void> {
    // Sin `id` el cuidador todavía no tiene licencia: se activa por usuario y
    // se manda el plan para que el servidor la cree.
    const esNueva = !suscripcion.id;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: esNueva
        ? { accion: 'activar', usuario_id: suscripcion.usuario_id, plan_codigo: planElegido ?? 'mensual' }
        : { accion: 'activar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = esNueva
        ? 'No se pudo activar la licencia del cuidador.'
        : 'No se pudo activar la suscripción.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  /** Deja la suscripción como cancelada (el servidor usa la acción 'cancelar'). */
  async inhabilitar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!suscripcion.id) return;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'cancelar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo inhabilitar la suscripción.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  /** Mejora la suscripción mensual activa a anual (acción sólo del panel). */
  async mejorar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!suscripcion.id) return;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'mejorar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo mejorar el plan a anual.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  /** Degrada la suscripción anual a mensual (acción sólo del panel). */
  async degradar(suscripcion: SuscripcionAdministrada): Promise<void> {
    if (!suscripcion.id) return;

    this.cargandoSuscripciones = true;
    const { error } = await this.clienteSupabase.functions.invoke('admin-suscripciones', {
      body: { accion: 'degradar', suscripcion_id: suscripcion.id },
    });
    this.cargandoSuscripciones = false;
    if (error) {
      this.mensajeSuscripciones = 'No se pudo degradar el plan a mensual.';
    } else {
      await this.cargarSuscripciones();
    }
    this.refrescar();
  }

  nombrePlan(plan: string | null): string {
    if (plan === 'anual') return 'Plan anual';
    if (plan === 'mensual') return 'Plan mensual';
    return plan ?? 'Sin plan';
  }

  textoEstado(estado: string): string {
    switch (estado) {
      case 'activa': return 'Activa';
      case 'cancelada': return 'Cancelada';
      case 'vencida': return 'Vencida';
      case 'sin_suscripcion': return 'Sin suscripción';
      default: return estado;
    }
  }

  vigencia(suscripcion: SuscripcionAdministrada): string {
    // Sin plan no hay ninguna vigencia que mostrar.
    if (!suscripcion.plan_codigo) return 'No disponible';
    if (!suscripcion.inicia_en && !suscripcion.vence_en) return '—';
    const inicio = suscripcion.inicia_en ? this.formatearFecha(suscripcion.inicia_en) : 'Sin inicio';
    const vencimiento = suscripcion.vence_en ? this.formatearFecha(suscripcion.vence_en) : 'Sin vencimiento';
    return `${inicio} - ${vencimiento}`;
  }

  private formatearFecha(fecha: string): string {
    const valor = new Date(fecha);
    return Number.isNaN(valor.getTime()) ? '—' : valor.toLocaleDateString('es-CL');
  }

  private normalizar(texto: string): string {
    return (texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  private async detalleError(error: unknown, data: unknown): Promise<string> {
    console.error('admin-suscripciones listar:', error);
    const detalleDato = (data as { detalle?: unknown } | null)?.detalle;
    if (typeof detalleDato === 'string') return detalleDato;

    const contexto = (error as { context?: Response })?.context;
    if (contexto && typeof contexto.json === 'function') {
      try {
        const respuesta = await contexto.clone().json() as { detalle?: unknown; error?: unknown };
        if (typeof respuesta.detalle === 'string') return respuesta.detalle;
        if (typeof respuesta.error === 'string') return respuesta.error;
      } catch {
        // El servidor no devolvió JSON.
      }
    }
    return '';
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo, y `markForCheck` sólo la marca
   * como sucia. Hace falta forzar la pasada de detección para que el cambio
   * se vea al instante y no recién al siguiente clic.
   */
  private refrescar() {
    this.cdr.markForCheck();
    this.cdr.detectChanges();
  }
}

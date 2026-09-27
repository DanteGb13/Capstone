import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonButton,
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonInput,
  IonTextarea,
  IonToggle,
  IonSpinner
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alarm,
  alarmOutline,
  add,
  arrowBack,
  chevronDown,
  chevronUp,
  close,
  createOutline,
  handLeft,
  trashOutline
} from 'ionicons/icons';
import { AlarmaRecordatorio, AlarmasService, DIAS_SEMANA_TODOS } from '../../../services/alarmas/alarmas';
import { RuedaComponent } from '../../../components/rueda/rueda.component';
import { NavegacionRolService } from '../../../services/navegacion-rol/navegacion-rol';


@Component({
  selector: 'app-recordatorios',
  templateUrl: './recordatorios.page.html',
  styleUrls: ['./recordatorios.page.scss'],
  imports: [
    IonContent,
    IonIcon,
    IonButton,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonInput,
    IonTextarea,
    IonToggle,
    IonSpinner,
    RuedaComponent,
    CommonModule,
    FormsModule
  ]
})
export class RecordatoriosPage implements OnInit, OnDestroy {

  alarmas: AlarmaRecordatorio[] = [];
  sonando: AlarmaRecordatorio[] = [];

  private suscripcionAlarma?: { unsubscribe: () => void };

  private suscripcionSonando?: { unsubscribe: () => void };

  cargando = false;

  mostrarModal = false;
  editandoId: string | null = null;
  nuevoNombre = '';
  nuevaHoraSel = 0;
  nuevoMinutoSel = 0;
  nuevaDescripcion = '';
  nuevosDias: number[] = [];
  errorNombre = false;

  horas: number[] = Array.from({ length: 24 }, (_, i) => i);
  minutos: number[] = Array.from({ length: 60 }, (_, i) => i);

  sesionRueda = 0;

  modoFlechas: boolean = localStorage.getItem('sc_modo_hora_v1') === 'flechas';

  diasOpciones = [
    { valor: 2, nombre: 'Lun' },
    { valor: 3, nombre: 'Mar' },
    { valor: 4, nombre: 'Mié' },
    { valor: 5, nombre: 'Jue' },
    { valor: 6, nombre: 'Vie' },
    { valor: 7, nombre: 'Sáb' },
    { valor: 1, nombre: 'Dom' }
  ];

  private timer: any = null;

  constructor(
    private alarmasService: AlarmasService,
    private alertController: AlertController,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private navRol: NavegacionRolService
  ) {
    addIcons({
      alarm,
      alarmOutline,
      add,
      arrowBack,
      chevronDown,
      chevronUp,
      close,
      createOutline,
      handLeft,
      trashOutline
    });
  }

  async ngOnInit() {
    this.alarmasService.escucharTap(() => {
      this.cargar();
      this.router.navigate(['/recordatorios']);
    });

    this.alarmasService.onDisparo(() => {
      this.cargar();
      this.changeDetectorRef.detectChanges();
    });

    // Al empezar a sonar una alarma, la tarjeta "Apagar alarma" aparece sola.
    this.suscripcionSonando?.unsubscribe();
    this.suscripcionSonando = this.alarmasService.alarmaSonando$.subscribe(() => {
      this.refrescarSonando();
    });

    // Si la alarma se apaga desde la barra de notificaciones o desde la pagina
    // principal, la tarjeta de esta lista desaparece al instante.
    this.suscripcionAlarma?.unsubscribe();
    this.suscripcionAlarma = this.alarmasService.alarmaApagada$.subscribe((idAlarma) => {
      this.sonando = this.sonando.filter((a) => a.id !== idAlarma);
      this.changeDetectorRef.detectChanges();
    });

    this.primeraVezAsistente();
  }

  ionViewWillEnter() {
    this.cargar();
    this.iniciarTimer();
    document.addEventListener('visibilitychange', this.alVolverAlFrente);
  }

  ionViewWillLeave() {
    this.detenerTimer();
    document.removeEventListener('visibilitychange', this.alVolverAlFrente);
  }

  private readonly alVolverAlFrente = () => {
    if (document.visibilityState === 'visible') {
      this.cargar();
      this.changeDetectorRef.detectChanges();
    }
  };

  private refrescarSonando() {
    // Revisar si algún recordatorio está sonando SIN golpear la red
    void this.alarmasService.estanSonando(this.alarmas).then((sonando) => {
      this.sonando = sonando;
      this.changeDetectorRef.detectChanges();
    });
  }

  private iniciarTimer() {
    this.detenerTimer();
    // Cada 5 s: la alarma suena sola y el evento del sistema no siempre llega
    // (el teléfono lo descarta con la app en segundo plano).
    this.timer = setInterval(() => this.refrescarSonando(), 5000);
  }

  private detenerTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async primeraVezAsistente() {
    const configVista = localStorage.getItem('sc_config_aviso_v1');
    if (configVista) {
      return;
    }
    localStorage.setItem('sc_config_aviso_v1', '1');
    this.prepararAlarma()
      .then((estado) => {
        if (estado === 'sinNotif') {
          this.mostrarInfo(
            'Permiso de notificaciones',
            'Sin el permiso las alarmas no podrán avisarte. Actívalo en Ajustes → Permisos.'
          );
        } else if (estado === 'inexacta') {
          this.mostrarInfo(
            'Activación pendiente',
            'La alarma puede sonar tarde si no activas el permiso de alarmas exactas. Actívalo en Ajustes → Permisos.'
          );
        }
      });
  }

  ngOnDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.suscripcionAlarma?.unsubscribe();
    this.suscripcionSonando?.unsubscribe();
    this.detenerRepeticion();
  }

  async cargar() {
    // Pintar al instante con lo guardado en el dispositivo (sin esperar la red)
    const locales = this.alarmasService.getAlarmasLocales();
    if (locales.length > 0) {
      this.alarmas = locales;
      this.cargando = false;
    } else {
      this.cargando = true;
    }
    this.changeDetectorRef.detectChanges();

    try {
      const alarmas = await this.alarmasService.getAlarmas();
      this.alarmas = alarmas;
      this.sonando = await this.alarmasService.estanSonando(alarmas);
    } catch (e) {
      console.error('Error cargando recordatorios:', e);
    } finally {
      this.cargando = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }


  // =====================================================
  // CONFIGURACIÓN GUIADA DE PERMISOS
  // =====================================================

  private mostrarInfo(header: string, message: string): Promise<void> {
    return new Promise(async (resolve) => {
      const alerta = await this.alertController.create({
        header,
        message,
        buttons: [{ text: 'Entendido', role: 'cancel' }]
      });
      await alerta.present();
      await alerta.onDidDismiss();
      resolve();
    });
  }

  async prepararAlarma(): Promise<'ok' | 'sinNotif' | 'inexacta'> {
    const notif = await this.alarmasService.notifPermitidas();
    if (!notif) {
      return 'sinNotif';
    }

    const exacta = await this.alarmasService.checarAlarmaExacta();
    return exacta ? 'ok' : 'inexacta';
  }


  // =====================================================
  // NUEVA ALARMA
  // =====================================================

  abrirNueva() {
    this.editandoId = null;
    this.nuevoNombre = '';
    this.nuevaHoraSel = 0;
    this.nuevoMinutoSel = 0;
    this.nuevaDescripcion = '';
    this.nuevosDias = [...DIAS_SEMANA_TODOS];
    this.errorNombre = false;
    this.sesionRueda++;
    this.mostrarModal = true;
  }

  abrirEditar(alarma: AlarmaRecordatorio) {
    this.editandoId = alarma.id;
    this.nuevoNombre = alarma.nombre;
    this.nuevaHoraSel = alarma.hora;
    this.nuevoMinutoSel = alarma.minuto;
    this.nuevaDescripcion = alarma.descripcion;
    this.nuevosDias = (alarma.dias && alarma.dias.length > 0)
      ? [...alarma.dias]
      : [...DIAS_SEMANA_TODOS];
    this.errorNombre = false;
    this.sesionRueda++;
    this.mostrarModal = true;
  }

  cerrarNueva() {
    this.detenerRepeticion();
    this.mostrarModal = false;
  }


  // =====================================================
  // ELECCIÓN DE HORA: FLECHAS O DESLIZAR
  // =====================================================

  cambiarModo(flechas: boolean) {
    this.modoFlechas = flechas;
    localStorage.setItem('sc_modo_hora_v1', flechas ? 'flechas' : 'dedos');
  }

  dosDigitos(n: number): string {
    return n.toString().padStart(2, '0');
  }

  subirHora() {
    this.nuevaHoraSel = (this.nuevaHoraSel + 1) % 24;
  }

  bajarHora() {
    this.nuevaHoraSel = (this.nuevaHoraSel + 23) % 24;
  }

  subirMinuto() {
    this.nuevoMinutoSel = (this.nuevoMinutoSel + 1) % 60;
  }

  bajarMinuto() {
    this.nuevoMinutoSel = (this.nuevoMinutoSel + 59) % 60;
  }

  // Mantener presionada la flecha: la hora/minuto siguen moviéndose solos

  private pasoRepeticion: () => void = () => {};
  private repeticion: any = null;

  iniciarRepeticion(paso: () => void) {
    this.detenerRepeticion();
    this.pasoRepeticion = paso;
    this.pasoRepeticion();
    this.repeticion = setTimeout(() => this.programarSiguiente(420), 500);
  }

  private programarSiguiente(espera: number) {
    this.pasoRepeticion();
    const siguiente = Math.max(70, espera * 0.82);
    this.repeticion = setTimeout(() => this.programarSiguiente(siguiente), espera);
  }

  detenerRepeticion() {
    if (this.repeticion !== null) {
      clearTimeout(this.repeticion);
      this.repeticion = null;
    }
  }

  get modalTitulo(): string {
    return this.editandoId !== null ? 'Editar recordatorio' : 'Nuevo recordatorio';
  }

  get botonGuardarTitulo(): string {
    return this.editandoId !== null ? 'Guardar cambios' : 'Guardar recordatorio';
  }


  // =====================================================
  // VISTA PREVIA DE CUÁNDO SONARÁ
  // =====================================================

  get previstaTexto(): string {
    const dias = this.nuevosDias.length > 0
      ? this.nuevosDias
      : DIAS_SEMANA_TODOS;
    const fecha = this.alarmasService.proximaSonara(
      dias,
      this.nuevaHoraSel,
      this.nuevoMinutoSel
    );

    if (!fecha) {
      return '';
    }

    return this.formatearProxima(fecha);
  }

  private formatearProxima(fecha: Date): string {
    const horaTexto = this.horaTexto24(this.nuevaHoraSel, this.nuevoMinutoSel);

    const hoy = new Date();
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const nombres = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const diaNombre = nombres[fecha.getDay()];

    if (fecha.toDateString() === hoy.toDateString()) {
      return `Hoy (${diaNombre}) a las ${horaTexto}`;
    }
    if (fecha.toDateString() === manana.toDateString()) {
      return `Mañana (${diaNombre}) a las ${horaTexto}`;
    }

    return `${diaNombre} a las ${horaTexto}`;
  }

  /** Permite letras, números, emojis y espacios; solo rechaza caracteres de control. */
  private nombreValido(texto: string): boolean {
    const t = texto.trim();
    return t.length > 0 && t.length <= 40 && !/[\u0000-\u001F\u007F]/.test(t);
  }

  onNombreInput() {
    const limpio = this.nuevoNombre.trim();
    this.errorNombre = limpio.length > 0 && !this.nombreValido(limpio);
  }

  async guardarNueva() {
    const nombre = this.nuevoNombre.trim();
    if (!this.nombreValido(nombre)) {
      this.errorNombre = true;
      this.changeDetectorRef.detectChanges();
      return;
    }
    this.errorNombre = false;

    let dias = [...this.nuevosDias];
    if (dias.length === 0) {
      const hoy = new Date().getDay() + 1;
      dias = [hoy];
    }

    const { hora, minuto } = {
      hora: this.nuevaHoraSel,
      minuto: this.nuevoMinutoSel
    };

    if (this.editandoId !== null) {
      const ok = await this.alarmasService.actualizarAlarma(this.editandoId, {
        nombre,
        hora,
        minuto,
        descripcion: this.nuevaDescripcion.trim(),
        dias
      });

      this.mostrarModal = false;

      if (!ok) {
        await this.mostrarInfo(
          'No se pudo guardar',
          'Hubo un problema al guardar los cambios. Revisa tu conexión e inténtalo de nuevo.'
        );
        await this.cargar();
        return;
      }

      await this.cargar();

      const editada = this.alarmas.find((a) => a.id === this.editandoId);
      if (editada && editada.activa) {
        await this.alarmasService.activarDesactivar(editada, true);
      } else if (editada) {
        await this.alarmasService.cancelarAlarma(editada);
      }
      return;
    }

    const alarma = await this.alarmasService.crearAlarma(
      nombre,
      hora,
      minuto,
      this.nuevaDescripcion.trim(),
      true,
      dias
    );

    this.mostrarModal = false;

    if (!alarma) {
      await this.mostrarInfo(
        'No se pudo guardar',
        'Hubo un problema al crear el recordatorio. Revisa tu conexión e inténtalo de nuevo.'
      );
      await this.cargar();
      return;
    }

    await this.cargar();
    await this.activarConPermisos(alarma);
  }

  private async activarConPermisos(alarma: AlarmaRecordatorio) {
    const estado = await this.prepararAlarma();

    if (estado === 'sinNotif') {
      await this.mostrarInfo(
        'Permiso de notificaciones',
        'Sin el permiso la alarma no podrá avisarte. El recordatorio quedó guardado pero apagado hasta que actives el permiso en Ajustes → Permisos.'
      );
      this.desactivarAlarma(alarma);
      return;
    }

    if (estado === 'inexacta') {
      await this.mostrarInfo(
        'Activación pendiente',
        'El permiso de alarmas exactas no está activado, así que la alarma puede sonar con retraso. Se programará igual; puedes activarlo después en Ajustes → Permisos.'
      );
    }

    await this.alarmasService.activarDesactivar(alarma, true);
    await this.cargar();
  }

  private async desactivarAlarma(alarma: AlarmaRecordatorio) {
    await this.alarmasService.cancelarAlarma(alarma);
    await this.alarmasService.actualizarAlarma(alarma.id, { activa: false });
    await this.cargar();
  }

  horaTexto(alarma: AlarmaRecordatorio): string {
    const ampm = alarma.hora < 12 ? 'AM' : 'PM';
    return `${this.dosDigitos(alarma.hora)}:${this.dosDigitos(alarma.minuto)} ${ampm}`;
  }

  horaTexto24(hora: number, minuto: number): string {
    return `${this.dosDigitos(hora)}:${this.dosDigitos(minuto)}`;
  }

  get amPm(): string {
    return this.nuevaHoraSel < 12 ? 'AM' : 'PM';
  }

  diasTexto(alarma: AlarmaRecordatorio): string {
    const todos = DIAS_SEMANA_TODOS.every((d) => alarma.dias.includes(d));
    if (todos) {
      return 'Todos los días';
    }

    const mapa: Record<number, string> = {
      2: 'Lun', 3: 'Mar', 4: 'Mié', 5: 'Jue',
      6: 'Vie', 7: 'Sáb', 1: 'Dom'
    };
    const orden = [2, 3, 4, 5, 6, 7, 1];

    return orden
      .filter((d) => alarma.dias.includes(d))
      .map((d) => mapa[d])
      .join(', ');
  }


  // =====================================================
  // SELECCIÓN DE DÍAS
  // =====================================================

  esDiaSeleccionado(valor: number): boolean {
    return this.nuevosDias.includes(valor);
  }

  alternarDia(valor: number) {
    if (this.nuevosDias.includes(valor)) {
      if (this.nuevosDias.length > 1) {
        this.nuevosDias = this.nuevosDias.filter((d) => d !== valor);
      }
    } else {
      this.nuevosDias = [...this.nuevosDias, valor];
    }
  }

  todosLosDias(): boolean {
    return this.nuevosDias.length === DIAS_SEMANA_TODOS.length;
  }

  alternarTodos() {
    if (this.todosLosDias()) {
      const hoy = new Date().getDay() + 1;
      this.nuevosDias = [hoy];
    } else {
      this.nuevosDias = [...DIAS_SEMANA_TODOS];
    }
  }


  // =====================================================
  // ACTIVAR / DESACTIVAR
  // =====================================================

  async cambiarActivacion(alarma: AlarmaRecordatorio, activa: boolean) {
  if (activa) {
    const estado = await this.prepararAlarma();

    if (estado === 'sinNotif') {
      await this.mostrarInfo(
        'Permiso de notificaciones',
        'Sin el permiso la alarma no podrá avisarte. Puedes activarlo en Ajustes → Permisos.'
      );
      await this.desactivarAlarma({ ...alarma, activa: false });
      return;
    }

    if (estado === 'inexacta') {
      await this.mostrarInfo(
        'Activación pendiente',
        'El permiso de alarmas exactas no está activado, así que puede sonar con retraso. Puedes activarlo en Ajustes → Permisos.'
      );
    }

    await this.alarmasService.activarDesactivar(alarma, true);
    await this.cargar();
    return;
  }

  await this.alarmasService.activarDesactivar(alarma, false);
  await this.cargar();
}


  // =====================================================
  // APAGAR ALARMA
  // =====================================================

  async apagar(alarma: AlarmaRecordatorio) {
    this.sonando = this.sonando.filter((a) => a.id !== alarma.id);
    this.changeDetectorRef.detectChanges();
    await this.alarmasService.apagarAlarma(alarma);
    await this.cargar();
  }


  // =====================================================
  // ELIMINAR ALARMA
  // =====================================================

  async eliminar(alarma: AlarmaRecordatorio) {
    const confirma = await this.alertController.create({
      header: 'Eliminar recordatorio',
      message: `¿Seguro que quieres eliminar "${alarma.nombre}"?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            await this.alarmasService.cancelarAlarma(alarma);
            const ok = await this.alarmasService.eliminarAlarma(alarma.id);
            if (!ok) {
              await this.mostrarInfo(
                'No se pudo eliminar',
                'Hubo un problema al eliminar el recordatorio. Revisa tu conexión e inténtalo de nuevo.'
              );
            }
            await this.cargar();
          }
        }
      ]
    });

    await confirma.present();
  }
}

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
  IonToggle
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
    RuedaComponent,
    CommonModule,
    FormsModule
  ]
})
export class RecordatoriosPage implements OnInit, OnDestroy {

  alarmas: AlarmaRecordatorio[] = [];
  sonando: AlarmaRecordatorio[] = [];

  mostrarModal = false;
  editandoId: number | null = null;
  nuevoNombre = '';
  nuevaHoraSel = 0;
  nuevoMinutoSel = 0;
  nuevaDescripcion = '';
  nuevosDias: number[] = [];

  horas: number[] = Array.from({ length: 24 }, (_, i) => i);
  minutos: number[] = Array.from({ length: 60 }, (_, i) => i);

  sesionRueda = 0;

  modoFlechas: boolean = localStorage.getItem('sc_modo_hora_v1') !== 'dedos';

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
    private router: Router
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

  private iniciarTimer() {
    this.detenerTimer();
    this.timer = setInterval(() => {
      this.cargar();
      this.changeDetectorRef.detectChanges();
    }, 1000);
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
            'Sin el permiso las alarmas no podrán avisarte. Puedes activarlo después en Ajustes → Apps → SiempreCerca → Notificaciones.'
          );
        } else if (estado === 'inexacta') {
          this.mostrarInfo(
            'Activación pendiente',
            'La alarma puede sonar tarde si no activas el permiso de alarmas exactas. Puedes activarlo después en Ajustes → Apps → SiempreCerca → Alarmas y recordatorios.'
          );
        }
      });
  }

  ngOnDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.detenerRepeticion();
  }

  cargar() {
    this.alarmas = this.alarmasService.getAlarmas();
    this.sonando = this.alarmasService.estanSonando();
  }

  volver() {
    this.router.navigate(['/adulto-mayor']);
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

  private preguntarAccion(header: string, message: string): Promise<string> {
    return new Promise(async (resolve) => {
      const alerta = await this.alertController.create({
        header,
        message,
        buttons: [
          { text: 'Ahora no', role: 'cancel', handler: () => resolve('cancel') },
          { text: 'Sí, activar', handler: () => resolve('ok') }
        ]
      });
      await alerta.present();
      await alerta.onDidDismiss().then(() => resolve('cancel'));
    });
  }

  private async preguntarPermisoNotificacion(): Promise<boolean> {
    if (await this.alarmasService.notifPermitidas()) {
      return true;
    }

    const respuesta = await this.preguntarAccion(
      'Permiso de notificaciones',
      'Para avisarte cuando toque el recordatorio, la app necesita mostrar notificaciones. ¿Permito enviarlas?'
    );

    if (respuesta === 'ok') {
      await this.alarmasService.pedirPermisoNotif();
    }

    return await this.alarmasService.notifPermitidas();
  }

  private async preguntarAlarmaExacta(): Promise<boolean> {
    if (await this.alarmasService.checarAlarmaExacta()) {
      return true;
    }

    const respuesta = await this.preguntarAccion(
      'Alarmas a tiempo',
      'Para que el recordatorio suene EXACTAMENTE a la hora marcada (y no llegue tarde), Android pide activar el permiso de alarmas exactas. Se abrirá la pantalla de Ajustes para activarlo.'
    );

    if (respuesta === 'ok') {
      const activo = await this.alarmasService.abrirAjustesAlarmaExacta();
      if (!activo) {
        await this.mostrarInfo(
          'Activación pendiente',
          'No se activó el permiso de alarmas exactas. La alarma puede sonar con retraso. Puedes activarlo más tarde en Ajustes → Apps → SiempreCerca → Alarmas y recordatorios.'
        );
      }
    }

    return await this.alarmasService.checarAlarmaExacta();
  }

  private async preguntarBateria() {
    const ignorada = await this.alarmasService.bateriaIgnorada();
    if (ignorada) {
      return;
    }

    const respuesta = await this.preguntarAccion(
      'Funcionar en segundo plano',
      'Para que la alarma suene aunque no estés usando la app (con el celular apagado de pantalla), conviene que Android no ahorre batería en esta app. Se abrirá la pantalla de batería para permitirlo.'
    );

    if (respuesta === 'ok') {
      const activo = await this.alarmasService.pedirIgnorarBateria();
      if (!activo) {
        await this.mostrarInfo(
          'Optimización de batería',
          'No se desactivó el ahorro de batería. La alarma puede atrasarse con el teléfono en reposo. Puedes cambiarlo después en Ajustes → Apps → SiempreCerca → Batería.'
        );
      }
    }
  }

  async prepararAlarma(): Promise<'ok' | 'sinNotif' | 'inexacta'> {
    const notif = await this.preguntarPermisoNotificacion();
    if (!notif) {
      return 'sinNotif';
    }

    await this.preguntarAlarmaExacta();
    await this.preguntarBateria();

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
    const h = this.nuevaHoraSel.toString().padStart(2, '0');
    const m = this.nuevoMinutoSel.toString().padStart(2, '0');
    const horaTexto = `${h}:${m}`;

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

  async guardarNueva() {
    const nombre = this.nuevoNombre.trim();
    if (!nombre) {
      return;
    }

    let dias = [...this.nuevosDias];
    if (dias.length === 0) {
      const hoy = new Date().getDay() + 1;
      dias = [hoy];
    }

    const { hora, minuto } = {
      hora: this.nuevaHoraSel,
      minuto: this.nuevoMinutoSel
    };
    const lista = this.alarmasService.getAlarmas();

    if (this.editandoId !== null) {
      const actualizada = lista.map((a) => a.id === this.editandoId
        ? {
            ...a,
            nombre,
            hora,
            minuto,
            descripcion: this.nuevaDescripcion.trim(),
            dias
          }
        : a);

      this.alarmasService.guardarAlarmas(actualizada);
      const editada = actualizada.find((a) => a.id === this.editandoId);

      this.mostrarModal = false;
      this.cargar();

      if (editada && editada.activa) {
        await this.activarConPermisos(editada);
      } else if (editada) {
        await this.alarmasService.activarDesactivar(editada, false);
      }
      return;
    }

    const alarma = this.alarmasService.crearAlarma(
      nombre,
      hora,
      minuto,
      this.nuevaDescripcion.trim(),
      true,
      dias
    );

    this.alarmasService.guardarAlarmas([
      ...lista,
      alarma
    ]);

    this.mostrarModal = false;
    this.cargar();
    await this.activarConPermisos(alarma);
  }

  private async activarConPermisos(alarma: AlarmaRecordatorio) {
    const estado = await this.prepararAlarma();

    if (estado === 'sinNotif') {
      await this.mostrarInfo(
        'Permiso de notificaciones',
        'Sin el permiso la alarma no podrá avisarte. El recordatorio quedó guardado pero apagado hasta que actives el permiso en Ajustes → Apps → SiempreCerca → Notificaciones.'
      );
      this.desactivarAlarma(alarma);
      return;
    }

    if (estado === 'inexacta') {
      await this.mostrarInfo(
        'Activación pendiente',
        'El permiso de alarmas exactas no está activado, así que la alarma puede sonar con retraso. Se programará igual; puedes activarlo después en Ajustes → Apps → SiempreCerca → Alarmas y recordatorios.'
      );
    }

    await this.alarmasService.activarDesactivar(alarma, true);
    this.cargar();
  }

  private async desactivarAlarma(alarma: AlarmaRecordatorio) {
    await this.alarmasService.cancelarAlarma(alarma);
    const lista = this.alarmasService.getAlarmas()
      .map((a) => a.id === alarma.id ? { ...a, activa: false } : a);
    this.alarmasService.guardarAlarmas(lista);
    this.cargar();
  }

  horaTexto(alarma: AlarmaRecordatorio): string {
    const h = alarma.hora.toString().padStart(2, '0');
    const m = alarma.minuto.toString().padStart(2, '0');
    return `${h}:${m}`;
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
        'Sin el permiso la alarma no podrá avisarte. Puedes activarlo en Ajustes → Apps → SiempreCerca → Notificaciones.'
      );
      await this.desactivarAlarma({ ...alarma, activa: false });
      return;
    }

    if (estado === 'inexacta') {
      await this.mostrarInfo(
        'Activación pendiente',
        'El permiso de alarmas exactas no está activado, así que puede sonar con retraso. Puedes activarlo en Ajustes → Apps → SiempreCerca → Alarmas y recordatorios.'
      );
    }

    await this.alarmasService.activarDesactivar(alarma, true);
    this.cargar();
    return;
  }

  await this.alarmasService.activarDesactivar(alarma, false);
  this.cargar();
}


  // =====================================================
  // APAGAR ALARMA
  // =====================================================

  async apagar(alarma: AlarmaRecordatorio) {
    this.sonando = this.sonando.filter((a) => a.id !== alarma.id);
    await this.alarmasService.apagarAlarma(alarma);
    this.cargar();
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
            const lista = this.alarmasService.getAlarmas()
              .filter((a) => a.id !== alarma.id);
            this.alarmasService.guardarAlarmas(lista);
            this.cargar();
          }
        }
      ]
    });

    await confirma.present();
  }
}
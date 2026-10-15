import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonIcon,
  IonSpinner,
  IonModal,
  IonButton,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonRefresher,
  IonRefresherContent,
  AlertController,
  ToastController
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import {
  add,
  alertCircleOutline,
  call,
  callOutline,
  checkmarkOutline,
  close,
  mailOutline,
  people,
  peopleOutline,
  personAddOutline,
  personOutline,
  refreshOutline,
  trashOutline,
  warning
} from 'ionicons/icons';

import { Capacitor } from '@capacitor/core';

import {
  ContactosEmergenciaService,
  ContactoEmergencia,
  ContactoPublico,
  Relacion,
  CONTACTOS_PUBLICOS,
  OTRO_PARENTESCO,
  telefonoParaMarcar,
  nombreCompleto
} from '../../../services/Backend/contactos-emergencia/contactos-emergencia';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { SupabaseService } from '../../../services/supabase/supabase';
import { PermisosExtra } from '../../../services/Backend/permisos-extra/permisos-extra';

/**
 * Contactos de emergencia del CUIDADOR.
 *
 * Cada persona a su cargo tiene sus propios contactos: la lista que se ve y se
 * edita es la de `contacto_emergencia` del adulto elegido, con el mismo servicio
 * que usa la pantalla del adulto mayor. Además el botón de arriba cambia a la
 * vista de "Emergencias públicas" (SAMU, Bomberos, Carabineros, PDI), que no
 * depende de ninguna persona ni de la base de datos.
 */
@Component({
  selector: 'app-contactos-cuidador',
  templateUrl: './contactos-cuidador.page.html',
  styleUrls: ['./contactos-cuidador.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonIcon,
    IonSpinner,
    IonModal,
    IonButton,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonRefresher,
    IonRefresherContent,
    CommonModule,
    FormsModule
  ]
})
export class ContactosCuidadorPage implements OnInit {

  contactosPublicos: ContactoPublico[] = CONTACTOS_PUBLICOS;

  /** Visible en la plantilla: nombre completo (nombre + apellidos). */
  nombreContacto = nombreCompleto;

  /** Personas vinculadas a este cuidador (con su adulto_mayor dentro). */
  adultosACargo: any[] = [];

  adultoSeleccionado: any = null;

  /** true = mostrando sólo las emergencias públicas (botón de arriba). */
  soloPublicos: boolean = false;

  cargando: boolean = true;

  cargandoContactos: boolean = false;

  contactos: ContactoEmergencia[] = [];

  guardando: boolean = false;

  esperandoPicker: boolean = false;

  /**
   * Qué se está intentando hacer mientras dura el aviso: sirve para que, si se
   * queda cargando, se sepa en pantalla si se ha parado pidiendo el permiso o
   * esperando a la agenda.
   */
  fasePicker: 'permiso' | 'selector' | '' = '';

  /** Aviso que se queda visible en la lista de contactos (un toast se pierde). */
  errorLista: string = '';

  /** Id -> nombre, para mostrar el parentesco junto a cada contacto. */
  mapaRelaciones: Record<string, string> = {};

  /** Parentescos del diccionario global, para el desplegable del formulario. */
  relaciones: Relacion[] = [];

  /** Valor del desplegable que habilita el campo para escribir un parentesco nuevo. */
  readonly otroParentesco = OTRO_PARENTESCO;

  mostrarFormulario: boolean = false;

  formErrorNombre: boolean = false;

  formErrorTelefono: boolean = false;

  /** Frase bajo el título, según el contacto venga de la agenda o se escriba a mano. */
  formSubtitulo = '';

  form = {
    nombre: '',
    apellidopa: '',
    apellidoma: '',
    telefono: '',
    correo: '',
    parentesco: '',
    parentescoLibre: ''
  };

  /** Id de la sesión del cuidador; vacío si no hay sesión. */
  idSesion: string = '';

  /** Id del ADULTO elegido: es el id_usuario al que se le guardan los contactos. */
  idAdulto: string = '';

  /** Evita que un selector cancelado cierre el aviso de otro selector activo. */
  private pickerActivo: number = 0;

  /** Id pedido por query param (?id=) antes de que cargue la lista de adultos. */
  private idPendiente: string | null = null;

  private servicio = inject(ContactosEmergenciaService);

  private vinculacionService = inject(Vinculacion);

  private supabaseService = inject(SupabaseService);

  private route = inject(ActivatedRoute);

  private router = inject(Router);

  private alertCtrl = inject(AlertController);

  private toastCtrl = inject(ToastController);

  private cdr = inject(ChangeDetectorRef);

  constructor() {
    // Sólo los iconos que esta pantalla usa: registrar todos los de ionicons
    // (más de mil) en cada entrada a la página no aporta nada.
    addIcons({
      add,
      'alert-circle-outline': alertCircleOutline,
      call,
      'call-outline': callOutline,
      'checkmark-outline': checkmarkOutline,
      close,
      'mail-outline': mailOutline,
      people,
      'people-outline': peopleOutline,
      'person-outline': personOutline,
      'person-add-outline': personAddOutline,
      'refresh-outline': refreshOutline,
      'trash-outline': trashOutline,
      warning
    });
  }

  ngOnInit() {
    this.route.queryParams.subscribe((params) => {
      const id = params['id'];
      if (id) {
        this.idPendiente = String(id);
        this.aplicarSeleccion(this.idPendiente);
        void this.cargarContactos();
      }
    });
  }

  /**
   * Entra cada vez que la pantalla se muestra (no sólo la primera vez: con la
   * estrategia de rutas de Ionic el componente se reutiliza y ngOnInit no se
   * vuelve a llamar, lo que dejaba la lista vieja o vacía).
   */
  async ionViewWillEnter() {
    const { data: { session } } = await this.supabaseService.getClient().auth.getSession();
    this.idSesion = session?.user?.id || '';
    this.refrescar();

    await this.cargarAdultos();
  }

  // =====================================================
  // PERSONAS A CARGO
  // =====================================================

  async cargarAdultos() {
    this.cargando = true;
    this.errorLista = '';
    this.refrescar();

    try {
      const vinculos = await this.vinculacionService.obtenerAdultosACargo();
      await this.cargarFotos(vinculos);

      this.adultosACargo = vinculos || [];

      const idPrevio =
        this.idDe(this.adultoSeleccionado) ||
        this.idPendiente ||
        null;

      this.aplicarSeleccion(idPrevio);
    } catch (error: any) {
      console.error('Error al obtener las personas a cargo:', error);
      this.adultosACargo = [];
      this.adultoSeleccionado = null;
      this.idAdulto = '';
    } finally {
      this.cargando = false;
      this.refrescar();
      await this.cargarContactos();
    }
  }

  /** Igual que en historial: la foto vive en el bucket de fotos-perfil. */
  private async cargarFotos(vinculos: any[]) {
    const supabase = this.supabaseService.getClient();

    await Promise.all(
      vinculos.map(async (item) => {
        const userId = item?.adulto_mayor?.id;
        if (!userId) return;

        try {
          const { data } = await supabase.storage
            .from('fotos-perfil')
            .list(`${userId}/`, { limit: 1 });

          if (data && data.length > 0) {
            const { data: signedUrlData } = await supabase.storage
              .from('fotos-perfil')
              .createSignedUrl(`${userId}/${data[0].name}`, 3600);

            item.adulto_mayor.foto_url = signedUrlData?.signedUrl || null;
          } else {
            item.adulto_mayor.foto_url = null;
          }
        } catch {
          item.adulto_mayor.foto_url = null;
        }
      })
    );
  }

  // =====================================================
  // SELECCIÓN DE PERSONA
  // =====================================================

  private idDe(item: any): string | null {
    return item?.id_usuario || item?.adulto_mayor?.id || item?.id || null;
  }

  private aplicarSeleccion(id: string | null) {
    const encontrado = id
      ? this.adultosACargo.find(
          (item) =>
            item.id === id ||
            item.adulto_mayor?.id === id ||
            item.id_usuario === id
        )
      : null;

    this.adultoSeleccionado = encontrado || this.adultosACargo[0] || null;
    this.idAdulto = this.adultoSeleccionado?.id_usuario
      || this.adultoSeleccionado?.adulto_mayor?.id
      || '';
    this.refrescar();
  }

  seleccionarAdulto(adulto: any) {
    if (this.idDe(adulto) === this.idDe(this.adultoSeleccionado)) return;

    this.adultoSeleccionado = adulto;
    this.idPendiente = this.idDe(adulto);
    this.idAdulto = adulto?.id_usuario || adulto?.adulto_mayor?.id || '';

    // La lista del adulto anterior no corresponde a este: se limpia para no
    // mostrar contactos de otra persona mientras llega la consulta nueva.
    this.contactos = [];
    this.errorLista = '';
    this.refrescar();

    void this.cargarContactos();
  }

  esSeleccionado(adulto: any): boolean {
    return this.idDe(adulto) === this.idDe(this.adultoSeleccionado);
  }

  nombreSeleccionado(): string {
    const a = this.adultoSeleccionado?.adulto_mayor;
    if (!a) return '';
    return `${a.nombre || ''} ${a.apellidopa || ''} ${a.apellidoma || ''}`.trim();
  }

  /** Iniciales del ADULTO, para los chips del selector. */
  inicialesAdulto(adulto: any): string {
    const a = adulto?.adulto_mayor;
    const base = `${a?.nombre || ''} ${a?.apellidopa || ''}`.trim();
    if (!base) return '?';

    return base
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p: string) => p[0].toUpperCase())
      .join('');
  }

  /** Botón de arriba: alterna entre la lista del adulto y las emergencias públicas. */
  alternarVista() {
    this.soloPublicos = !this.soloPublicos;
    this.refrescar();
  }

  /** Botón "Ver personas a tu cuidado" del estado vacío. */
  irAPersonas() {
    this.router.navigate(['/cuidado']);
  }

  // =====================================================
  // LISTA DE CONTACTOS DEL ADULTO ELEGIDO
  // =====================================================

  async cargarContactos() {
    if (!this.idAdulto || !this.idSesion) {
      this.cargandoContactos = false;
      this.errorLista = '';
      this.refrescar();
      return;
    }

    // El esqueleto sólo aparece cuando todavía no hay nada que mostrar: al
    // volver a la pantalla la lista se queda visible mientras se refresca.
    if (this.contactos.length === 0) {
      this.cargandoContactos = true;
    }
    this.errorLista = '';

    // Las dos consultas salen al mismo tiempo: el parentesco y los contactos.
    const parentescos = this.servicio.listarRelaciones();

    let nuevos: ContactoEmergencia[] = [];
    try {
      nuevos = this.ordenar(await this.servicio.listar(this.idAdulto));
    } finally {
      this.cargandoContactos = false;
    }

    if (this.servicio.ultimoError) {
      // Si la consulta falla, listar devuelve una lista vacía. No se borra lo
      // que ya se estaba mostrando: se deja el aviso con su botón de reintento.
      if (nuevos.length > 0) {
        this.contactos = nuevos;
      }

      this.errorLista = this.mensajeFallo(this.servicio.ultimoError, 'cargar');
      await this.toast(this.errorLista);
    } else {
      this.contactos = nuevos;
    }

    this.aplicarRelaciones(await parentescos);

    // Sin este aviso, la lista y el estado de carga no se pintaban hasta que
    // el usuario tocaba la pantalla (la app corre sin zone.js).
    this.refrescar();
  }

  /** Botón "Reintentar" del aviso de error. */
  async reintentar() {
    this.servicio.invalidarRelaciones();
    await this.cargarContactos();
  }

  /** Deslizar hacia abajo para recargar personas, contactos y parentescos. */
  async handleRefresh(event: any) {
    this.servicio.invalidarRelaciones();
    try {
      await this.cargarAdultos();
    } finally {
      event?.target?.complete?.();
    }
  }

  private aplicarRelaciones(relaciones: Relacion[]) {
    const mapa: Record<string, string> = {};
    for (const rel of relaciones) {
      mapa[rel.id] = rel.nombre;
    }
    this.mapaRelaciones = mapa;
    this.relaciones = relaciones;
  }

  /** Nombre del parentesco de un contacto, vacío si no tiene o no se pudo leer. */
  relacionDe(contacto: ContactoEmergencia): string {
    if (!contacto?.id_relacion) return '';
    return this.mapaRelaciones[contacto.id_relacion] || '';
  }

  /**
   * Convierte el error real de la base en un mensaje que no miente: aquí un
   * fallo típico es que las políticas RLS no le den permiso al cuidador sobre
   * los contactos del adulto, y eso hay que decirlo como está.
   */
  private mensajeFallo(detalle: string, accion: 'cargar' | 'guardar' | 'eliminar'): string {
    const que = accion === 'cargar' ? 'cargar' : accion === 'guardar' ? 'guardar' : 'eliminar';
    const texto = detalle || '';

    if (/column .* does not exist|42703/i.test(texto)) {
      return `No se pudo ${que} el contacto. Actualiza la app para volver a usarla.`;
    }

    if (/row-level security|42501|permission denied/i.test(texto)) {
      return `No se pudo ${que} el contacto. La base de datos no te dio permiso.`;
    }

    if (/JWT|invalid.*token|not found|401|403/i.test(texto)) {
      return `No se pudo ${que} el contacto. Vuelve a iniciar sesión.`;
    }

    const corto = texto.length > 80 ? texto.slice(0, 80) + '…' : texto;
    return `No se pudo ${que} el contacto: ${corto || 'error desconocido'}`;
  }

  iniciales(nombre: string): string {
    const partes = (nombre || '').trim().split(/\s+/).filter(Boolean);

    if (partes.length === 0) return '?';
    if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();

    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  // =====================================================
  // LLAMADAS
  // =====================================================

  async llamar(telefono: string) {
    const tel = telefonoParaMarcar(telefono);
    if (!tel) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const resultado = await PermisosExtra.realizarLlamada({ telefono: tel });
        if (resultado?.llamada) return;
      } catch {
        /* si el plugin no puede, se intenta con el marcador del navegador */
      }
    }

    window.location.href = `tel:${tel}`;
  }

  // =====================================================
  // AGREGAR DESDE LA AGENDA DEL TELÉFONO
  // =====================================================

  async agregarDeTelefono() {
    if (!this.idAdulto) {
      await this.toast('Elige primero a quién quieres añadir el contacto.');
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      await this.abrirFormularioManual();
      return;
    }

    const miPicker = ++this.pickerActivo;

    // El aviso se enciende desde el primer instante: el permiso y el selector
    // pueden tardar y antes no había ninguna señal de que la app hubiera
    // registrado el toque (se veía como "no pasa nada").
    this.esperandoPicker = true;
    this.fasePicker = 'permiso';

    // Red de seguridad: pase lo que pase, a los 90 s el aviso se cierra y se
    // avisa. Ningún paso debe poder dejar la pantalla girando para siempre.
    const vigilante = setTimeout(() => {
      if (this.pickerActivo === miPicker && this.esperandoPicker) {
        this.pickerActivo++;
        this.esperandoPicker = false;
        this.fasePicker = '';
        void this.toast('La agenda no está respondiendo. Vuelve a intentarlo.');
      }
    }, 90000);

    try {
      // 1) Permiso de la agenda: se pide SIEMPRE antes de abrir el selector.
      const permiso = await this.pedirPermisoAgenda();

      // El usuario tocó "Cancelar" en el aviso mientras se pedía el permiso.
      if (this.pickerActivo !== miPicker) return;

      if (!permiso.concedido) {
        await this.avisoPermisoAgenda();
        return;
      }

      // Si se acaba de mostrar el diálogo de permiso, se da un margen al
      // sistema para terminar de cerrarlo antes de lanzar la siguiente
      // actividad: el selector de la primera vez era el que no respondía.
      if (permiso.pidioDialogo) {
        await this.espera(300);
        if (this.pickerActivo !== miPicker) return;
      }

      this.fasePicker = 'selector';
      this.refrescar();

      // Selector nativo con tipo "contactos": Android va directo a la agenda.
      const promesa = PermisosExtra.pickContacto();

      // Si Android no entrega el resultado de la actividad, la promesa se
      // queda sin responder: se espera 30 s y se avisa.
      const resultado: any = await Promise.race([
        promesa,
        new Promise<null>((resolver) => setTimeout(() => resolver(null), 30000))
      ]);

      if (this.pickerActivo !== miPicker) return;

      if (!resultado) {
        await this.toast('La agenda no respondió. Vuelve a intentarlo.');
        return;
      }

      // Se cerró la agenda sin elegir a nadie: no se abre el formulario.
      if (resultado.cancelado) return;

      const nombre = String(resultado.nombre || '').trim();
      const apellido = String(resultado.apellido || '').trim();
      const tel = String(resultado.telefono || '').trim();
      const correo = String(resultado.correo || '').trim();

      if (!nombre && !apellido && !tel && !correo) return;

      // El aviso de "eligiendo contacto" se cierra ANTES de abrir el
      // formulario: si quedaba encima, el modal se veía tapado por el spinner.
      this.esperandoPicker = false;

      if (!tel || tel.replace(/\D/g, '').length < 3) {
        // No se frena la apertura: el formulario sale igual con los datos que
        // sí trajo la agenda y el campo del teléfono queda marcado.
        await this.abrirFormulario({
          nombre: nombre || 'Contacto de emergencia',
          apellidopa: apellido,
          telefono: tel,
          correo
        });
        this.formErrorTelefono = true;
        await this.toast('Ese contacto no tiene un teléfono válido. Escríbelo para guardar.');
        return;
      }

      await this.abrirFormulario({
        nombre: nombre || 'Contacto de emergencia',
        apellidopa: apellido,
        telefono: tel,
        correo
      });
    } catch (e: any) {
      const mensaje = String(e?.message || '').toLowerCase();
      const codigo = String(e?.code || '');

      if (codigo === 'PERMISO_CONTACTOS' || mensaje.includes('missing the following permissions')) {
        await this.avisoPermisoAgenda();
      } else if (mensaje.includes('permission') || mensaje.includes('permiso')) {
        await this.toast('No se dio permiso para leer contactos. Vuelve a intentarlo.');
      } else {
        await this.toast('No se pudo abrir la agenda de contactos.');
      }
    } finally {
      clearTimeout(vigilante);
      this.fasePicker = '';
      if (this.pickerActivo === miPicker) {
        this.esperandoPicker = false;
      }
      this.refrescar();
    }
  }

  /**
   * Pide permiso de contactos de forma explícita; devuelve su estado y si
   * hubo que mostrar el diálogo del sistema. Nada se queda colgado: cada paso
   * tiene su tope.
   */
  private async pedirPermisoAgenda(): Promise<{ concedido: boolean; pidioDialogo: boolean }> {
    try {
      const estado = await this.conTiempo(PermisosExtra.verificarPermisos(), 5000);
      if (estado?.contactos) return { concedido: true, pidioDialogo: false };
    } catch (e) {
      console.warn('No se pudo verificar el permiso de contactos:', e);
    }

    try {
      const pedido = await this.conTiempo(
        PermisosExtra.solicitarContactos({ abrirAjustes: false }),
        40000
      );
      if (pedido?.concedido) return { concedido: true, pidioDialogo: true };
      console.warn('Permiso de contactos no concedido');
      return { concedido: false, pidioDialogo: true };
    } catch (e) {
      console.warn('El permiso de contactos no respondió:', e);

      // Por si el diálogo sí se concedió pero la respuesta se perdió.
      try {
        const estado = await this.conTiempo(PermisosExtra.verificarPermisos(), 5000);
        if (estado?.contactos) return { concedido: true, pidioDialogo: true };
      } catch {
        /* nada más que comprobar */
      }

      return { concedido: false, pidioDialogo: true };
    }
  }

  /** Corta una promesa que no conteste a tiempo. */
  private conTiempo<T>(promesa: Promise<T>, ms: number): Promise<T> {
    const tope = new Promise<never>((_, rechazar) => {
      setTimeout(() => rechazar(new Error('Sin respuesta a tiempo')), ms);
    });
    return Promise.race([promesa, tope]);
  }

  private espera(ms: number): Promise<void> {
    return new Promise((resolver) => setTimeout(() => resolver(), ms));
  }

  /** Ventana que explica que sin permiso no se puede leer la agenda. */
  private async avisoPermisoAgenda() {
    try {
      const alert = await this.alertCtrl.create({
        header: 'Permiso de contactos',
        message:
          'Para añadir desde tu agenda, la app necesita permiso para leer tus contactos. ' +
          'Actívalo en Ajustes del teléfono > Aplicaciones > SiempreCerca > Permisos > Contactos, ' +
          'o escribe el contacto a mano.',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Abrir ajustes',
            handler: () => {
              void PermisosExtra.abrirAjustes().catch(() => {
                void this.toast('Abre los ajustes del teléfono para activar el permiso.');
              });
            }
          },
          {
            text: 'Añadir manualmente',
            handler: () => {
              void this.abrirFormularioManual();
            }
          }
        ]
      });
      await alert.present();
    } catch {
      /* sin UI disponible */
    }
  }

  cancelarPicker() {
    this.pickerActivo++;
    this.esperandoPicker = false;
    this.refrescar();
  }

  // =====================================================
  // FORMULARIO (IGUAL QUE "AÑADIR CONTACTO" DEL TELÉFONO)
  // =====================================================

  /**
   * Abre el formulario con nombre, apellidos, teléfono, correo y parentesco.
   * Si viene de la agenda se trae precargado. El subtítulo deja SIEMPRE claro
   * de quién es la persona que se está guardando.
   */
  async abrirFormulario(semilla: {
    nombre?: string;
    apellidopa?: string;
    apellidoma?: string;
    telefono?: string;
    correo?: string;
  } = {}) {
    if (!this.idAdulto) {
      await this.toast('Elige primero a quién quieres añadir el contacto.');
      return;
    }

    const paraQuien = this.nombreSeleccionado() || 'esta persona';
    const vieneDeAgenda = !!(semilla.nombre || semilla.telefono);

    this.formSubtitulo = vieneDeAgenda
      ? `Se guardará en los contactos de ${paraQuien}.`
      : `Nuevo contacto para ${paraQuien}.`;

    this.form = {
      nombre: String(semilla.nombre || '').trim(),
      apellidopa: String(semilla.apellidopa || '').trim(),
      apellidoma: String(semilla.apellidoma || '').trim(),
      telefono: String(semilla.telefono || '').trim(),
      correo: String(semilla.correo || '').trim(),
      parentesco: '',
      parentescoLibre: ''
    };
    this.formErrorNombre = false;
    this.formErrorTelefono = false;

    // El parentesco es texto libre, así que el formulario NO espera a la base.
    this.mostrarFormulario = true;
    this.refrescar();
  }

  /** Botón "Añadir manualmente": formulario vacío. */
  async abrirFormularioManual() {
    await this.abrirFormulario();
  }

  cerrarFormulario() {
    this.mostrarFormulario = false;
    this.refrescar();
  }

  async guardarFormulario() {
    const nombre = this.form.nombre.trim();
    const telefono = this.form.telefono.trim();

    this.formErrorNombre = !nombre;
    this.formErrorTelefono = telefono.replace(/\D/g, '').length < 3;
    this.refrescar();

    if (this.formErrorNombre) {
      await this.toast('Escribe el nombre del contacto.');
      return;
    }

    if (this.formErrorTelefono) {
      await this.toast('Escribe un teléfono válido.');
      return;
    }

    if (this.guardando) return;
    if (!this.idAdulto) {
      await this.toast('Elige primero a quién quieres añadir el contacto.');
      return;
    }

    const paraQuien = this.nombreSeleccionado() || 'la persona elegida';

    this.guardando = true;
    try {
      // El parentesco vive en otra tabla: primero se consigue su id y después
      // se guarda el contacto apuntando a él.
      const parentesco = this.form.parentesco === this.otroParentesco
        ? this.form.parentescoLibre.trim()
        : this.form.parentesco.trim();

      let idRelacion: string | undefined;
      let falloRelacion = '';

      if (parentesco) {
        idRelacion = (await this.servicio.resolverRelacion(parentesco)) || undefined;
        falloRelacion = this.servicio.ultimoError;
      }

      // id_usuario = el ADULTO elegido: el contacto queda en su lista, no en
      // la del cuidador.
      const creado = await this.servicio.agregar({
        id_usuario: this.idAdulto,
        nombre,
        apellidopa: this.form.apellidopa.trim(),
        apellidoma: this.form.apellidoma.trim(),
        telefono,
        correo: this.form.correo.trim(),
        id_relacion: idRelacion
      });

      if (!creado && this.servicio.ultimoError) {
        await this.toast(this.mensajeFallo(this.servicio.ultimoError, 'guardar'));
        return;
      }

      if (creado) {
        this.contactos = this.ordenar([...this.contactos, creado]);
      }

      if (idRelacion && parentesco) {
        this.mapaRelaciones[idRelacion] = parentesco;
        if (!this.relaciones.some((rel) => rel.id === idRelacion)) {
          this.relaciones = [...this.relaciones, { id: idRelacion, nombre: parentesco }]
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        }
      }

      this.mostrarFormulario = false;

      // La vista se refresca SIEMPRE desde la base al añadir.
      await this.cargarContactos();

      if (parentesco && !idRelacion) {
        console.warn('Contacto guardado sin parentesco:', falloRelacion);
        await this.toast(`Contacto guardado para ${paraQuien}. No se pudo guardar el parentesco.`);
      } else {
        await this.toast(`Contacto guardado para ${paraQuien}.`);
      }
    } finally {
      this.guardando = false;
      this.refrescar();
    }
  }

  /** Mantiene el mismo orden que la consulta (por nombre). */
  private ordenar(lista: ContactoEmergencia[]): ContactoEmergencia[] {
    return [...lista].sort((a, b) =>
      (a.nombre || '').localeCompare(b.nombre || '', 'es')
    );
  }

  // =====================================================
  // ELIMINAR
  // =====================================================

  async confirmarEliminar(contacto: ContactoEmergencia) {
    try {
      const alert = await this.alertCtrl.create({
        header: 'Eliminar contacto',
        message:
          `¿Quitar a ${nombreCompleto(contacto)} de los contactos de emergencia de ` +
          `${this.nombreSeleccionado() || 'esta persona'}?`,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Eliminar',
            role: 'destructive',
            handler: () => {
              void this.eliminar(contacto.id);
            }
          }
        ]
      });
      await alert.present();
    } catch {
      /* sin UI disponible */
    }
  }

  private async eliminar(id: string) {
    const ok = await this.servicio.eliminar(id);

    if (ok) {
      // Se quita de la lista en vez de recargarla
      this.contactos = this.contactos.filter((c) => c.id !== id);
      this.refrescar();
      void this.toast('Contacto eliminado.');
    } else {
      await this.toast(this.mensajeFallo(this.servicio.ultimoError || 'error desconocido', 'eliminar'));
    }
  }

  // =====================================================
  // UTILIDAD
  // =====================================================

  /**
   * La app corre SIN zone.js (zoneless): actualizar una propiedad después de
   * un await NO repinta la vista por sí solo, hasta que el usuario toca la
   * pantalla. Este aviso fuerza el repintado de todo lo que cambió.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }

  private async toast(mensaje: string) {
    try {
      const aviso = await this.toastCtrl.create({
        message: mensaje,
        duration: 2500,
        position: 'bottom'
      });
      await aviso.present();
    } catch {
      /* sin UI disponible */
    }
  }

}

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { Contacts } from '@capacitor-community/contacts';

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
import { SupabaseService } from '../../../services/supabase/supabase';
import { PermisosExtra } from '../../../services/Backend/permisos-extra/permisos-extra';

@Component({
  selector: 'app-contacto-emergencia',
  templateUrl: './contacto-emergencia.page.html',
  styleUrls: ['./contacto-emergencia.page.scss'],
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
export class ContactoEmergenciaPage {

  contactosPublicos: ContactoPublico[] = CONTACTOS_PUBLICOS;

  /** Visible en la plantilla: nombre completo (nombre + apellidos). */
  nombreContacto = nombreCompleto;

  contactos: ContactoEmergencia[] = [];

  cargando: boolean = true;

  guardando: boolean = false;

  esperandoPicker: boolean = false;

  /** Aviso que se queda visible en "Mis contactos" (un toast se pierde en 2 s). */
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
  formSubtitulo = 'Escribe los datos de tu contacto de confianza.';

  form = {
    nombre: '',
    apellidopa: '',
    apellidoma: '',
    telefono: '',
    correo: '',
    parentesco: '',
    parentescoLibre: ''
  };

  /** Visible en la plantilla: muestra el estado "sin sesión" si no hay uno. */
  idUsuario: string = '';

  /** Evita que un selector cancelado cierre el aviso de otro selector activo. */
  private pickerActivo: number = 0;

  private servicio = inject(ContactosEmergenciaService);

  private supabaseService = inject(SupabaseService);

  private alertCtrl = inject(AlertController);

  private toastCtrl = inject(ToastController);

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

  /**
   * Entra cada vez que la pantalla se muestra (no sólo la primera vez: con la
   * estrategia de rutas de Ionic el componente se reutiliza y ngOnInit no se
   * vuelve a llamar, lo que dejaba la lista vieja o vacía).
   */
  async ionViewWillEnter() {
    const { data: { session } } = await this.supabaseService.getClient().auth.getSession();
    this.idUsuario = session?.user?.id || '';

    await this.cargarContactos();
  }

  // =====================================================
  // LISTA
  // =====================================================

  async cargarContactos() {
    if (!this.idUsuario) {
      this.cargando = false;
      this.errorLista = '';
      return;
    }

    // El esqueleto sólo aparece cuando todavía no hay nada que mostrar: al
    // volver a la pantalla la lista se queda visible mientras se refresca.
    if (this.contactos.length === 0) {
      this.cargando = true;
    }
    this.errorLista = '';

    // Las dos consultas salen al mismo tiempo. Antes la de parentescos
    // esperaba a que terminara la de contactos, así que el parentesco
    // aparecía un rato después del resto de la fila.
    const parentescos = this.servicio.listarRelaciones();

    let nuevos: ContactoEmergencia[] = [];
    try {
      nuevos = this.ordenar(await this.servicio.listar(this.idUsuario));
    } finally {
      this.cargando = false;
    }

    if (this.servicio.ultimoError) {
      // Si la consulta falla, listar devuelve una lista vacía. No se borra lo
      // que ya se estaba mostrando: se deja el aviso con su botón de reintento
      // y la lista sigue ahí para poder seguir llamando.
      if (nuevos.length > 0) {
        this.contactos = nuevos;
      }

      this.errorLista = this.mensajeFallo(this.servicio.ultimoError, 'cargar');
      await this.toast(this.errorLista);
    } else {
      this.contactos = nuevos;
    }

    this.aplicarRelaciones(await parentescos);
  }

  /** Botón "Reintentar" del aviso de error. */
  async reintentar() {
    this.servicio.invalidarRelaciones();
    await this.cargarContactos();
  }

  /** Deslizar hacia abajo para recargar todo, incluido el diccionario. */
  async handleRefresh(event: any) {
    this.servicio.invalidarRelaciones();
    try {
      await this.cargarContactos();
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
   * Convierte el error real de la base en un mensaje que no miente.
   * Antes todo fallo se traducía como "revisa tu conexión", incluso siendo
   * un problema de permisos o de una app desactualizada.
   */
  private mensajeFallo(detalle: string, accion: 'cargar' | 'guardar' | 'eliminar'): string {
    const que = accion === 'cargar' ? 'cargar' : accion === 'guardar' ? 'guardar' : 'eliminar';
    const texto = detalle || '';

    // La app instalada pide columnas que ya no existen: hay que actualizarla.
    if (/column .* does not exist|42703/i.test(texto)) {
      return `No se pudo ${que} el contacto. Actualiza la app para volver a usarla.`;
    }

    // Permisos/RLS: la base sí tiene los datos, pero rechaza la operación.
    if (/row-level security|42501|permission denied/i.test(texto)) {
      return `No se pudo ${que} el contacto. La base de datos no te dio permiso.`;
    }

    // Sesión vencida o usuario inexistente.
    if (/JWT|invalid.*token|not found|401|403/i.test(texto)) {
      return `No se pudo ${que} el contacto. Vuelve a iniciar sesión.`;
    }

    // Cualquier otra cosa se muestra tal cual para poder diagnosticarla.
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
    if (!this.idUsuario) {
      await this.toast('Inicia sesión para guardar contactos de emergencia.');
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      await this.abrirFormularioManual();
      return;
    }

    // 1) Permiso de la agenda: se pide SIEMPRE antes de abrir el selector.
    //    Sin este paso Android a veces no muestra nada y la llamada se queda
    //    esperando en silencio.
    const permiso = await this.pedirPermisoAgenda();
    if (permiso !== 'granted') {
      await this.avisoPermisoAgenda();
      return;
    }

    const miPicker = ++this.pickerActivo;
    this.esperandoPicker = true;

    try {
      // Selector nativo con tipo "contactos": Android va directo a la agenda
      // en vez de ofrecer el explorador de archivos y otras apps
      const promesa = PermisosExtra.pickContacto();

      // Si el usuario cierra la agenda, la promesa puede quedarse sin
      // responder: se espera a lo mucho 60 s y se cierra el aviso.
      const resultado: any = await Promise.race([
        promesa,
        new Promise<null>((resolver) => setTimeout(() => resolver(null), 60000))
      ]);

      // Sin resultado = se cerró la agenda sin elegir a nadie
      if (!resultado) return;

      const nombre = String(resultado.nombre || '').trim();
      const apellido = String(resultado.apellido || '').trim();
      const tel = String(resultado.telefono || '').trim();
      const correo = String(resultado.correo || '').trim();

      if (!tel || tel.replace(/\D/g, '').length < 3) {
        // No se frena la apertura: el formulario sale igual con los datos que
        // sí trajo la agenda y el campo del teléfono queda marcado para que el
        // usuario sólo tenga que completarlo y guardar.
        this.esperandoPicker = false;
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

      // El aviso de "eligiendo contacto" se cierra ANTES de abrir el
      // formulario: si quedaba encima, el modal se veía tapado por el spinner
      // y daba la impresión de que no volvía a la ventana de rellenado.
      this.esperandoPicker = false;

      // La agenda sólo trae lo que el teléfono tiene guardado: se abre el
      // mismo formulario de "añadir contacto" con esos datos ya escritos.
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
        // Falta el permiso: se explica cómo activarlo en los ajustes del teléfono
        await this.avisoPermisoAgenda();
      } else if (mensaje.includes('permission') || mensaje.includes('permiso')) {
        await this.toast('No se dio permiso para leer contactos. Vuelve a intentarlo.');
      } else {
        await this.toast('No se pudo abrir la agenda de contactos.');
      }
    } finally {
      if (this.pickerActivo === miPicker) {
        this.esperandoPicker = false;
      }
    }
  }

  /** Pide permiso de contactos de forma explícita; devuelve su estado. */
  private async pedirPermisoAgenda(): Promise<string> {
    try {
      const actual = await Contacts.checkPermissions();
      if (actual.contacts === 'granted') return 'granted';
    } catch (e) {
      console.warn('No se pudo verificar el permiso de contactos:', e);
    }

    try {
      const pedido = await Contacts.requestPermissions();
      if (pedido.contacts === 'granted') return 'granted';
      console.warn('Permiso de contactos no concedido:', pedido.contacts);
      return 'denied';
    } catch (e) {
      // Antes se devolvía 'granted' y el error real (por ejemplo, un permiso
      // sin declarar en el manifiesto) quedaba escondido hasta fallar más abajo.
      console.error('Error solicitando el permiso de contactos:', e);
      return 'denied';
    }
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
  }

  // =====================================================
  // FORMULARIO (IGUAL QUE "AÑADIR CONTACTO" DEL TELÉFONO)
  // =====================================================

  /**
   * Abre el formulario con nombre, apellidos, teléfono, correo y parentesco,
   * igual que la pantalla de contacto del teléfono. Si viene de la agenda se
   * trae precargado, así que sólo falta completar lo que el teléfono no sabe.
   */
  async abrirFormulario(semilla: {
    nombre?: string;
    apellidopa?: string;
    apellidoma?: string;
    telefono?: string;
    correo?: string;
  } = {}) {
    if (!this.idUsuario) {
      await this.toast('Inicia sesión para guardar contactos de emergencia.');
      return;
    }

    // El texto cambia según venga de la agenda (sólo hay que completar) o
    // se escriba desde cero.
    const vieneDeAgenda = !!(semilla.nombre || semilla.telefono);

    this.formSubtitulo = vieneDeAgenda
      ? 'Tomamos los datos de tu teléfono. Completa lo que falte.'
      : 'Escribe los datos de tu contacto de confianza.';

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

    // El parentesco es texto libre, así que el formulario NO espera a la base:
    // se abre al instante y los parentescos ya vinieron al entrar a la pantalla.
    this.mostrarFormulario = true;
  }

  /** Botón "Añadir manualmente": formulario vacío. */
  async abrirFormularioManual() {
    await this.abrirFormulario();
  }

  cerrarFormulario() {
    this.mostrarFormulario = false;
  }

  async guardarFormulario() {
    const nombre = this.form.nombre.trim();
    const telefono = this.form.telefono.trim();

    this.formErrorNombre = !nombre;
    this.formErrorTelefono = telefono.replace(/\D/g, '').length < 3;

    if (this.formErrorNombre) {
      await this.toast('Escribe el nombre del contacto.');
      return;
    }

    if (this.formErrorTelefono) {
      await this.toast('Escribe un teléfono válido.');
      return;
    }

    if (this.guardando) return;

    this.guardando = true;
    try {
      // El parentesco vive en otra tabla: primero se consigue su id y después
      // se guarda el contacto apuntando a él. Viene del desplegable o, si se
      // eligió "Otro", del campo de texto que se despliega debajo.
      const parentesco = this.form.parentesco === this.otroParentesco
        ? this.form.parentescoLibre.trim()
        : this.form.parentesco.trim();

      let idRelacion: string | undefined;
      let falloRelacion = '';

      if (parentesco) {
        idRelacion = (await this.servicio.resolverRelacion(parentesco)) || undefined;
        falloRelacion = this.servicio.ultimoError;
      }

      const creado = await this.servicio.agregar({
        id_usuario: this.idUsuario,
        nombre,
        apellidopa: this.form.apellidopa.trim(),
        apellidoma: this.form.apellidoma.trim(),
        telefono,
        correo: this.form.correo.trim(),
        id_relacion: idRelacion
      });

      // Si la base devolvió un error REAL no se guarda nada y se corta. Cuando
      // el insert entró pero no devolvió la fila (políticas RLS que no traen el
      // registro), ultimoError queda vacío: antes eso se reportaba como
      // "error desconocido" aunque el contacto se hubiese guardado.
      if (!creado && this.servicio.ultimoError) {
        await this.toast(this.mensajeFallo(this.servicio.ultimoError, 'guardar'));
        return;
      }

      // El contacto insertado ya viene completo: se suma a la lista en vez de
      // consultarla de nuevo, así aparece al instante
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

      // La vista se refresca SIEMPRE desde la base al añadir: así la lista
      // nunca queda vieja aunque el insert no haya devuelto la fila.
      await this.cargarContactos();

      if (parentesco && !idRelacion) {
        console.warn('Contacto guardado sin parentesco:', falloRelacion);
        await this.toast('Contacto guardado. No se pudo guardar el parentesco.');
      } else {
        await this.toast('Contacto guardado.');
      }
    } finally {
      this.guardando = false;
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
        message: `¿Quitar a ${nombreCompleto(contacto)} de tus contactos de emergencia?`,
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
      void this.toast('Contacto eliminado.');
    } else {
      await this.toast(this.mensajeFallo(this.servicio.ultimoError || 'error desconocido', 'eliminar'));
    }
  }

  // =====================================================
  // UTILIDAD
  // =====================================================

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

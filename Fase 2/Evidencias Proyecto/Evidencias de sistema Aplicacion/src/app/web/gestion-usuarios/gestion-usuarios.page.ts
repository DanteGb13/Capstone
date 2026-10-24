import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonContent, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

/** Vistas del segmento. Cada una es un "slide" aparte. */
export type VistaGestion = 'listado' | 'acciones' | 'actividad';

interface UsuarioFila {
  id: string;
  nombre: string | null;
  apellidopa: string | null;
  apellidoma: string | null;
  correo: string | null;
  estado: boolean | null;
  ultimo_visto: string | null;
  id_rol: string | null;
  rol: { nombre: string } | { nombre: string }[] | null;
}

export interface UsuarioGestion {
  id: string;
  nombre: string;
  correo: string;
  rol: string;
  idRol: string | null;
  activo: boolean;
  ultimoVisto: string | null;
}

export interface RolOpcion {
  id: string;
  nombre: string;
}

export interface EventoAuditoria {
  id: number;
  accion: string;
  detalle: Record<string, unknown> | null;
  fecha: string;
  actor: string;
}

/** Filas por página del listado. */
const POR_PAGINA = 10;

@Component({
  selector: 'app-gestion-usuarios',
  templateUrl: 'gestion-usuarios.page.html',
  styleUrls: ['gestion-usuarios.page.scss'],
  imports: [
    WebNav,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    FormsModule
  ],
})
export class GestionUsuariosPage implements OnInit {

  /** Slide visible. Se guarda en la página y no en la URL a propósito:
   *  volver atrás desde el panel debe mostrar el listado, no el slide
   *  que quedó abierto la vez anterior. */
  vista: VistaGestion = 'listado';

  cargando = true;
  error = '';
  /** Aviso corto tras una acción, del mismo estilo que en Reportes. */
  mensaje = '';

  usuarios: UsuarioGestion[] = [];
  roles: RolOpcion[] = [];

  busqueda = '';
  filtroRol = '';
  filtroEstado = '';
  pagina = 1;

  seleccion: UsuarioGestion | null = null;

  guardando = false;
  cargandoActividad = false;
  actividad: EventoAuditoria[] = [];

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);
  private alertCtrl = inject(AlertController);

  readonly porPagina = POR_PAGINA;

  async ngOnInit() {
    await Promise.all([this.cargarUsuarios(), this.cargarRoles()]);
    this.cargando = false;
    this.refrescar();
  }

  // ---------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------

  private async cargarUsuarios() {
    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('usuario')
        .select(`
          id,
          nombre,
          apellidopa,
          apellidoma,
          correo,
          estado,
          ultimo_visto,
          id_rol,
          rol (nombre)
        `)
        .order('nombre');

      if (error) throw new Error(error.message);

      this.usuarios = ((data ?? []) as UsuarioFila[]).map((fila) => {
        const rolData = fila.rol as any;
        const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;

        const nombre = [fila.nombre, fila.apellidopa, fila.apellidoma]
          .filter(Boolean)
          .join(' ')
          .trim();

        return {
          id: fila.id,
          nombre: nombre || 'Sin nombre',
          correo: fila.correo ?? '—',
          rol: rol ?? '—',
          idRol: fila.id_rol ?? null,
          activo: fila.estado !== false,
          ultimoVisto: fila.ultimo_visto ?? null
        };
      });
    } catch (e: any) {
      this.error = e?.message || 'No se pudieron cargar los usuarios.';
    }
  }

  /**
   * Los roles se piden por función y no leyendo la tabla `rol` directo:
   * esa tabla no tiene RLS y habría que encenderla, lo que rompería el
   * join `rol(nombre)` de todos los guards de la app.
   */
  private async cargarRoles() {
    try {
      const { data, error } = await this.supabaseService.getClient()
        .rpc('admin_listar_roles');

      if (error) throw new Error(error.message);

      this.roles = (data ?? []) as RolOpcion[];
    } catch (e: any) {
      // Sin la migración aplicada el listado de roles simplemente queda
      // vacío; la pantalla sigue sirviendo para mirar cuentas.
      this.roles = [];
      if (!this.error) this.error = e?.message || '';
    }
  }

  // ---------------------------------------------------------------
  // Filtros y paginación (en el cliente: la tabla es chica)
  // ---------------------------------------------------------------

  get filtrados(): UsuarioGestion[] {
    const texto = this.busqueda.trim().toLowerCase();

    return this.usuarios.filter((u) => {
      if (this.filtroRol && u.rol !== this.filtroRol) return false;
      if (this.filtroEstado === 'activo' && !u.activo) return false;
      if (this.filtroEstado === 'inactivo' && u.activo) return false;
      if (!texto) return true;

      return u.nombre.toLowerCase().includes(texto)
        || u.correo.toLowerCase().includes(texto);
    });
  }

  get paginas(): number {
    return Math.max(1, Math.ceil(this.filtrados.length / this.porPagina));
  }

  get visibles(): UsuarioGestion[] {
    const inicio = (this.pagina - 1) * this.porPagina;
    return this.filtrados.slice(inicio, inicio + this.porPagina);
  }

  alFiltrar() {
    this.pagina = 1;
    this.mensaje = '';
    this.refrescar();
  }

  irPagina(nueva: number) {
    this.pagina = Math.min(Math.max(1, nueva), this.paginas);
    this.refrescar();
  }

  // ---------------------------------------------------------------
  // Selección y acciones
  // ---------------------------------------------------------------

  seleccionar(usuario: UsuarioGestion, destino: VistaGestion) {
    this.seleccion = usuario;
    this.mensaje = '';
    this.vista = destino;
    if (destino === 'actividad') void this.cargarActividad();
    this.refrescar();
  }

  /**
   * Cambia el rol por RPC. La base se encarga de las reglas duras (no
   * cambiar el propio rol, no dejar al panel sin administrador); acá sólo
   * se confirma con la persona antes de mandar la orden.
   */
  async cambiarRol(nuevoRolId: string) {
    if (!this.seleccion || this.guardando) return;
    if (this.seleccion.idRol === nuevoRolId) return;

    const destino = this.roles.find((r) => r.id === nuevoRolId)?.nombre ?? 'el nuevo rol';

    const ok = await this.confirmar(
      'Cambiar rol',
      `Se le pasará a ${this.seleccion.nombre} el rol ${destino}.`
    );
    if (!ok) return;

    this.guardando = true;
    this.mensaje = '';
    this.refrescar();

    try {
      const { error } = await this.supabaseService.getClient()
        .rpc('admin_cambiar_rol', {
          p_usuario: this.seleccion.id,
          p_rol_id: nuevoRolId
        });

      if (error) throw new Error(error.message);

      this.seleccion.idRol = nuevoRolId;
      this.seleccion.rol = destino;
      const fila = this.usuarios.find((u) => u.id === this.seleccion?.id);
      if (fila) {
        fila.idRol = nuevoRolId;
        fila.rol = destino;
      }
      this.mensaje = `Rol actualizado: ${this.seleccion.nombre} ahora es ${destino}.`;
    } catch (e: any) {
      this.mensaje = e?.message || 'No se pudo cambiar el rol.';
    } finally {
      this.guardando = false;
      this.refrescar();
    }
  }

  async cambiarEstado(activar: boolean) {
    if (!this.seleccion || this.guardando) return;
    if (this.seleccion.activo === activar) return;

    const ok = await this.confirmar(
      activar ? 'Activar cuenta' : 'Desactivar cuenta',
      activar
        ? `Se volverá a activar la cuenta de ${this.seleccion.nombre}.`
        : `Se desactivará la cuenta de ${this.seleccion.nombre}.`
    );
    if (!ok) return;

    this.guardando = true;
    this.mensaje = '';
    this.refrescar();

    try {
      const { error } = await this.supabaseService.getClient()
        .rpc('admin_cambiar_estado', {
          p_usuario: this.seleccion.id,
          p_activo: activar
        });

      if (error) throw new Error(error.message);

      this.seleccion.activo = activar;
      const fila = this.usuarios.find((u) => u.id === this.seleccion?.id);
      if (fila) fila.activo = activar;
      this.mensaje = activar
        ? `Cuenta activada: ${this.seleccion.nombre}.`
        : `Cuenta desactivada: ${this.seleccion.nombre}.`;
    } catch (e: any) {
      this.mensaje = e?.message || 'No se pudo cambiar el estado.';
    } finally {
      this.guardando = false;
      this.refrescar();
    }
  }

  // ---------------------------------------------------------------
  // Actividad
  // ---------------------------------------------------------------

  private async cargarActividad() {
    if (!this.seleccion) return;

    this.cargandoActividad = true;
    this.actividad = [];
    this.refrescar();

    try {
      const id = this.seleccion.id;

      const { data, error } = await this.supabaseService.getClient()
        .from('seguridad_auditoria')
        .select('id, accion, detalle, fecha, usuario_id')
        .or(`usuario_id.eq.${id},objetivo_id.eq.${id}`)
        .order('fecha', { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message);

      const nombres = new Map(this.usuarios.map((u) => [u.id, u.nombre]));

      this.actividad = ((data ?? []) as any[]).map((fila) => ({
        id: fila.id,
        accion: fila.accion,
        detalle: fila.detalle ?? null,
        fecha: fila.fecha,
        actor: nombres.get(fila.usuario_id) ?? '—'
      }));
    } catch (e: any) {
      this.error = e?.message || 'No se pudo leer la actividad.';
    } finally {
      this.cargandoActividad = false;
      this.refrescar();
    }
  }

  /** Etiqueta legible de una acción de la bitácora. */
  etiquetaAccion(accion: string): string {
    switch (accion) {
      case 'sesion_iniciada': return 'Inició sesión';
      case 'sesion_cerrada': return 'Cerró sesión';
      case 'inicio_sesion_fallido': return 'Intento de acceso fallido';
      case 'cambio_rol': return 'Cambio de rol';
      case 'cambio_estado': return 'Cambio de estado';
      case 'exportacion_reporte': return 'Exportó un reporte';
      default: return accion;
    }
  }

  /** Resumen corto del detalle, para no pintar el JSON crudo. */
  resumenDetalle(detalle: Record<string, unknown> | null): string {
    if (!detalle) return '';
    return Object.entries(detalle)
      .map(([clave, valor]) => `${clave}: ${valor}`)
      .join(' · ');
  }

  // ---------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------

  alCambiarVista(evento: Event) {
    const valor = (evento.target as HTMLIonSegmentElement | null)?.value;
    if (!valor) return;
    this.vista = valor as VistaGestion;
    this.mensaje = '';
    if (this.vista === 'actividad') void this.cargarActividad();
    this.refrescar();
  }

  /**
   * Vuelve al listado desde los otros dos slides. Existe como método y no se
   * hace `vista = 'listado'` desde la plantilla porque ahí también hay que
   * repintar, y `refrescar()` es privado.
   */
  irAlListado() {
    this.vista = 'listado';
    this.mensaje = '';
    this.refrescar();
  }

  private async confirmar(header: string, message: string): Promise<boolean> {
    const alerta = await this.alertCtrl.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Confirmar', role: 'destructive' }
      ]
    });

    await alerta.present();
    const { role } = await alerta.onDidDismiss();

    // El botón de confirmar lleva `role: 'destructive'` (la convención de toda
    // la app), así que hay que comparar con ese y no con 'confirm': con el
    // 'confirm' la función siempre devolvía false y el cambio jamás se mandaba.
    // Un toque en el fondo o la tecla Esc llegan con role 'backdrop'/'escape',
    // que acá cuentan como cancelar.
    return role === 'destructive';
  }

  haceCuanto(iso: string | null): string {
    if (!iso) return 'Nunca';

    const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutos < 1) return 'Hace un momento';
    if (minutos < 60) return `Hace ${minutos} min`;

    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} h`;

    const dias = Math.floor(horas / 24);
    if (dias === 1) return 'Ayer';
    return `Hace ${dias} días`;
  }

  fechaLegible(iso: string): string {
    return new Date(iso).toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

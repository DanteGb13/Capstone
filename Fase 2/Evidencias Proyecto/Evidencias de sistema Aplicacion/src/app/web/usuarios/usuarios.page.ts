import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonContent, IonIcon } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { closeOutline, createOutline, eyeOutline, personAddOutline } from 'ionicons/icons';
import { SupabaseService } from '../../services/supabase/supabase';
import { PerfilCacheService } from '../../services/perfil-cache/perfil-cache.service';
import { WebNav } from '../web-nav/web-nav';
import {
  validarEmail,
  validarFechaNacimiento,
  validarNombreOApellido,
  validarPassword,
  validarRutChileno,
  validarTelefonoChileno
} from '../../services/utils/validators';
import { RegionesComunasService, RegionChile } from '../../services/utils/regiones-comunas.service';

interface UsuarioFila {
  id: string;
  nombre: string | null;
  apellidopa: string | null;
  apellidoma: string | null;
  correo: string | null;
  rut: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  estado: boolean | null;
  ultimo_visto: string | null;
  direccion: { region: string | null; comuna: string | null; calle: string | null; numero: string | null } | { region: string | null; comuna: string | null; calle: string | null; numero: string | null }[] | null;
  rol: { nombre: string } | { nombre: string }[] | null;
  id_rol: string | null;
  id_direccion: string | null;
  fecha_confirmacion: string | null;
  direccion_region?: string | null;
  direccion_comuna?: string | null;
  direccion_calle?: string | null;
  direccion_numero?: string | null;
  rol_nombre?: string | null;
}

interface UsuarioVista {
  id: string;
  nombre: string;
  correo: string;
  rut: string;
  telefono: string;
  fechaNacimiento: string | null;
  direccion: string;
  rol: string;
  activo: boolean;
  ultimoVisto: string | null;
  fotoUrl: string | null;
  nombreCompleto: string;
  apellidopa: string;
  apellidoma: string;
  idRol: string | null;
  idDireccion: string | null;
  fechaCreacion: string | null;
  direccionDatos: {
    region: string;
    comuna: string;
    calle: string;
    numero: string;
  };
}

interface RolOpcion {
  id: string;
  nombre: string;
}

interface NuevoUsuarioFormulario {
  correo: string;
  contrasena: string;
  nombre: string;
  apellidopa: string;
  apellidoma: string;
  rut: string;
  telefono: string;
  fechaNacimiento: string;
  idRol: string;
  activo: boolean;
  region: string;
  comuna: string;
  calle: string;
  numero: string;
}

@Component({
  selector: 'app-usuarios',
  templateUrl: 'usuarios.page.html',
  styleUrls: ['usuarios.page.scss'],
  imports: [WebNav, IonContent, IonIcon, RouterLink, FormsModule],
})
export class UsuariosPage implements OnInit {

  cargando = true;
  error = '';
  usuarios: UsuarioVista[] = [];
  busqueda = '';
  filtroTipoCuenta = '';
  filtroEstado = '';
  usuarioSeleccionado: UsuarioVista | null = null;
  modoEdicion = false;
  usuarioEditado: UsuarioVista | null = null;
  roles: RolOpcion[] = [];
  regiones: RegionChile[] = [];
  comunasDisponibles: string[] = [];
  guardando = false;
  enviandoEnlace = false;
  mensajeEdicion = '';
  errorEdicion = '';
  nuevoUsuarioAbierto = false;
  creandoUsuario = false;
  nuevoUsuarioError = '';
  nuevoUsuario: NuevoUsuarioFormulario = this.nuevoUsuarioVacio();
  descargaAbierta = false;
  descargaTipoCuenta = '';
  descargaEstado = '';
  descargaPeriodo = 'todos';
  paginaActual = 1;
  tamanoPagina = 11;

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);
  private perfilCache = inject(PerfilCacheService);
  private regionesComunas = inject(RegionesComunasService);
  private alertCtrl = inject(AlertController);

  constructor() {
    addIcons({ closeOutline, createOutline, eyeOutline, personAddOutline });
  }

  get tiposCuenta(): string[] {
    return [...new Set(this.usuarios.map((usuario) => usuario.rol))].sort((a, b) => a.localeCompare(b));
  }

  get fechaHoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  get usuariosFiltrados(): UsuarioVista[] {
    const texto = this.normalizar(this.busqueda);
    const rutBusqueda = this.normalizarRut(this.busqueda);

    return this.usuarios.filter((usuario) => {
      const rutUsuario = this.normalizarRut(usuario.rut);
      const coincideBusqueda = !texto
        || this.normalizar(usuario.nombre).includes(texto)
        || this.normalizar(usuario.correo).includes(texto)
        || this.normalizar(usuario.rut).includes(texto)
        || (!!rutBusqueda && rutUsuario.includes(rutBusqueda));

      const coincideTipo = !this.filtroTipoCuenta || usuario.rol === this.filtroTipoCuenta;
      const coincideEstado = !this.filtroEstado
        || (this.filtroEstado === 'activo' && usuario.activo)
        || (this.filtroEstado === 'inactivo' && !usuario.activo);

      return coincideBusqueda && coincideTipo && coincideEstado;
    });
  }

  get usuariosPagina(): UsuarioVista[] {
    const inicio = (this.paginaActual - 1) * this.tamanoPagina;
    return this.usuariosFiltrados.slice(inicio, inicio + this.tamanoPagina);
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.usuariosFiltrados.length / this.tamanoPagina));
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

  get numeroPrimerUsuario(): number {
    return this.usuariosFiltrados.length ? (this.paginaActual - 1) * this.tamanoPagina + 1 : 0;
  }

  get numeroUltimoUsuario(): number {
    return Math.min(this.paginaActual * this.tamanoPagina, this.usuariosFiltrados.length);
  }

  get usuariosDescarga(): UsuarioVista[] {
    const limite = this.obtenerLimitePeriodo(this.descargaPeriodo);

    return this.usuarios.filter((usuario) => {
      const coincideTipo = !this.descargaTipoCuenta || usuario.rol === this.descargaTipoCuenta;
      const coincideEstado = !this.descargaEstado
        || (this.descargaEstado === 'activo' && usuario.activo)
        || (this.descargaEstado === 'inactivo' && !usuario.activo);
      const coincidePeriodo = !limite
        || (!!usuario.fechaCreacion && new Date(usuario.fechaCreacion).getTime() >= limite.getTime());

      return coincideTipo && coincideEstado && coincidePeriodo;
    });
  }

  alCambiarFiltros(): void {
    this.paginaActual = 1;
    this.refrescar();
  }

  alCambiarTamanoPagina(): void {
    this.paginaActual = 1;
    this.refrescar();
  }

  abrirDescarga(): void {
    this.descargaTipoCuenta = this.filtroTipoCuenta || '';
    this.descargaEstado = this.filtroEstado || '';
    this.descargaPeriodo = 'todos';
    this.descargaAbierta = true;
    this.refrescar();
  }

  cerrarDescarga(): void {
    this.descargaAbierta = false;
    this.refrescar();
  }

  descargarUsuariosCsv(): void {
    const usuarios = this.usuariosDescarga;
    if (!usuarios.length) return;

    const encabezados = [
      'Nombre',
      'Correo',
      'RUT',
      'Tipo de cuenta',
      'Estado',
      'Telefono',
      'Fecha de nacimiento',
      'Direccion',
      'Fecha de creacion',
      'Ultimo visto'
    ];
    const filas = usuarios.map((usuario) => [
      usuario.nombre,
      usuario.correo,
      usuario.rut,
      usuario.rol,
      usuario.activo ? 'Activo' : 'Inactivo',
      usuario.telefono,
      this.formatearFecha(usuario.fechaNacimiento),
      usuario.direccion,
      this.formatearUltimoVisto(usuario.fechaCreacion),
      this.formatearUltimoVisto(usuario.ultimoVisto)
    ]);
    const csv = [encabezados, ...filas]
      .map((fila) => fila.map((valor) => this.escaparCsv(valor)).join(';'))
      .join('\r\n');
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `usuarios_${new Date().toISOString().slice(0, 10)}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
    this.cerrarDescarga();
  }

  private obtenerLimitePeriodo(periodo: string): Date | null {
    if (periodo === 'todos') return null;

    const limite = new Date();
    limite.setHours(0, 0, 0, 0);
    const meses = periodo === '1mes' ? 1 : periodo === '3meses' ? 3 : 6;
    limite.setMonth(limite.getMonth() - meses);
    return limite;
  }

  private escaparCsv(valor: unknown): string {
    let texto = String(valor ?? '').replace(/\r?\n|\r/g, ' ');
    if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
    return `"${texto.replace(/"/g, '""')}"`;
  }

  private formatearUltimoVisto(fecha: string | null): string {
    if (!fecha) return 'Sin registrar';
    const valor = new Date(fecha);
    return Number.isNaN(valor.getTime())
      ? 'Sin registrar'
      : valor.toLocaleString('es-CL');
  }

  abrirNuevoUsuario(): void {
    this.nuevoUsuario = this.nuevoUsuarioVacio();
    this.nuevoUsuario.idRol = this.roles.find((rol) => rol.nombre === 'Usuario')?.id ?? '';
    this.nuevoUsuarioError = '';
    this.nuevoUsuarioAbierto = true;
    this.refrescar();
  }

  cerrarNuevoUsuario(): void {
    if (this.creandoUsuario) return;
    this.nuevoUsuarioAbierto = false;
    this.nuevoUsuarioError = '';
    this.refrescar();
  }

  async crearUsuario(): Promise<void> {
    this.nuevoUsuarioError = '';

    const correo = this.nuevoUsuario.correo.trim().toLowerCase();
    const nombre = this.nuevoUsuario.nombre.trim();
    const apellidopa = this.nuevoUsuario.apellidopa.trim();
    const telefono = this.nuevoUsuario.telefono.trim();
    const rut = this.nuevoUsuario.rut.trim();
    const contrasena = validarPassword(this.nuevoUsuario.contrasena);

    if (!validarEmail(correo)) {
      this.nuevoUsuarioError = 'Ingresa un correo válido.';
      return;
    }
    if (!contrasena.valida) {
      this.nuevoUsuarioError = contrasena.mensaje ?? 'La contraseña no es válida.';
      return;
    }
    if (!validarNombreOApellido(nombre)) {
      this.nuevoUsuarioError = 'Ingresa un nombre válido.';
      return;
    }
    if (!validarNombreOApellido(apellidopa)) {
      this.nuevoUsuarioError = 'Ingresa un apellido paterno válido.';
      return;
    }
    if (this.nuevoUsuario.apellidoma && !validarNombreOApellido(this.nuevoUsuario.apellidoma.trim())) {
      this.nuevoUsuarioError = 'Ingresa un apellido materno válido.';
      return;
    }
    if (!validarRutChileno(rut)) {
      this.nuevoUsuarioError = 'Ingresa un RUT válido.';
      return;
    }
    if (!validarTelefonoChileno(telefono)) {
      this.nuevoUsuarioError = 'Ingresa un teléfono móvil chileno válido.';
      return;
    }
    if (!validarFechaNacimiento(this.nuevoUsuario.fechaNacimiento)) {
      this.nuevoUsuarioError = 'Ingresa una fecha de nacimiento válida.';
      return;
    }
    if (!this.nuevoUsuario.idRol) {
      this.nuevoUsuarioError = 'Selecciona el tipo de cuenta.';
      return;
    }
    if (!this.nuevoUsuario.region || !this.nuevoUsuario.comuna || !this.nuevoUsuario.calle.trim() || !this.nuevoUsuario.numero.trim()) {
      this.nuevoUsuarioError = 'Completa toda la dirección.';
      return;
    }

    this.creandoUsuario = true;
    this.refrescar();

    try {
      const supabase = this.supabaseService.getClient();
      const sesionActual = (await supabase.auth.getSession()).data.session;
      const nombreCompleto = [nombre, apellidopa, this.nuevoUsuario.apellidoma.trim()].filter(Boolean).join(' ');

      const { data, error } = await supabase.auth.signUp({
        email: correo,
        password: this.nuevoUsuario.contrasena,
        options: {
          data: {
            nombre_completo: nombreCompleto,
            telefono,
            tipo_cuenta: this.roles.find((rol) => rol.id === this.nuevoUsuario.idRol)?.nombre ?? 'Usuario',
            rut,
            fecha_nacimiento: this.nuevoUsuario.fechaNacimiento,
            region: this.nuevoUsuario.region,
            comuna: this.nuevoUsuario.comuna,
            calle: this.nuevoUsuario.calle.trim(),
            numero: this.nuevoUsuario.numero.trim(),
            estado: this.nuevoUsuario.activo
          }
        }
      });

      if (error) throw error;
      if (!data.user || (Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
        throw new Error('Ese correo ya está registrado.');
      }

      if (sesionActual) {
        await supabase.auth.setSession({
          access_token: sesionActual.access_token,
          refresh_token: sesionActual.refresh_token
        });
      }

      this.nuevoUsuario = this.nuevoUsuarioVacio();
      await this.ngOnInit();
      this.nuevoUsuarioAbierto = false;
      await this.mostrarAlerta(
        'Usuario creado',
        `La cuenta de ${nombreCompleto} fue creada correctamente.`
      );
    } catch (error: any) {
      this.nuevoUsuarioError = error?.message || 'No se pudo crear el usuario.';
    } finally {
      this.creandoUsuario = false;
      this.refrescar();
    }
  }

  private nuevoUsuarioVacio(): NuevoUsuarioFormulario {
    return {
      correo: '',
      contrasena: '',
      nombre: '',
      apellidopa: '',
      apellidoma: '',
      rut: '',
      telefono: '',
      fechaNacimiento: '',
      idRol: '',
      activo: true,
      region: '',
      comuna: '',
      calle: '',
      numero: ''
    };
  }

  irAPagina(pagina: number): void {
    this.paginaActual = Math.max(1, Math.min(pagina, this.totalPaginas));
    this.refrescar();
  }

  async ngOnInit() {
    try {
      const { data, error } = await this.supabaseService.getClient()
        .rpc('admin_listar_usuarios');

      if (error) {
        const detalle = await (error as { context?: Response }).context?.clone().json().catch(() => null);
        const mensaje = detalle?.error || error.message || 'No se pudo actualizar la cuenta.';
        throw new Error(mensaje);
      }

      this.usuarios = ((data ?? []) as UsuarioFila[]).map((fila) => {
        const rol = fila.rol_nombre ?? (Array.isArray(fila.rol) ? fila.rol[0]?.nombre : fila.rol?.nombre);
        const direccion = Array.isArray(fila.direccion) ? fila.direccion[0] : fila.direccion;
        const direccionRegion = direccion?.region ?? fila.direccion_region;
        const direccionComuna = direccion?.comuna ?? fila.direccion_comuna;
        const direccionCalle = direccion?.calle ?? fila.direccion_calle;
        const direccionNumero = direccion?.numero ?? fila.direccion_numero;
        const partesDireccion = [direccionCalle, direccionNumero, direccionComuna, direccionRegion]
          .filter(Boolean).join(', ');
        const textoRegistrado = (valor: string | null | undefined): string =>
          valor?.trim() || 'Sin registrar';

        const nombre = [
          fila.nombre,
          fila.apellidopa,
          fila.apellidoma
        ].filter(Boolean).join(' ').trim();

        return {
          id: fila.id,
          nombre: nombre || 'Sin registrar',
          correo: textoRegistrado(fila.correo),
          rut: textoRegistrado(fila.rut),
          telefono: textoRegistrado(fila.telefono),
          fechaNacimiento: fila.fecha_nacimiento,
          direccion: textoRegistrado(partesDireccion),
          rol: rol === 'Usuario' ? 'Adulto mayor' : textoRegistrado(rol),
          activo: fila.estado !== false,
          ultimoVisto: fila.ultimo_visto ?? null,
          fechaCreacion: fila.fecha_confirmacion ?? null,
          fotoUrl: null,
          nombreCompleto: fila.nombre ?? '',
          apellidopa: fila.apellidopa ?? '',
          apellidoma: fila.apellidoma ?? '',
          idRol: fila.id_rol ?? null,
          idDireccion: fila.id_direccion ?? null,
          direccionDatos: {
            region: direccionRegion ?? '',
            comuna: direccionComuna ?? '',
            calle: direccionCalle ?? '',
            numero: direccionNumero ?? ''
          }
        };
      }).filter((usuario) => usuario.rol.trim().toLowerCase() !== 'administrador');
      await this.cargarRoles();
      await this.cargarRegiones();

    } catch (e: any) {
      this.error = e?.message || 'No se pudieron cargar los usuarios.';
    } finally {
      this.cargando = false;
      this.refrescar();
      void this.precargarFotosUsuarios();
    }
  }

  /**
   * "hace 3 días", "hace 2 horas". Con una fecha absoluta cuesta saber de un
   * vistazo a quién se le apagó la cuenta.
   */
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

  async verUsuario(usuario: UsuarioVista): Promise<void> {
    const fotoCacheada = this.perfilCache.obtenerFotoEnMemoria(usuario.id);
    if (fotoCacheada) {
      this.usuarioSeleccionado = { ...usuario, fotoUrl: fotoCacheada };
    } else {
      const fotoGuardada = this.perfilCache.obtenerFotoGuardada(usuario.id);
      this.usuarioSeleccionado = { ...usuario, fotoUrl: fotoGuardada };
    }
    const fotoUrl = await this.perfilCache.cargarFoto(usuario.id);
    if (this.usuarioSeleccionado?.id === usuario.id) {
      this.usuarioSeleccionado = { ...this.usuarioSeleccionado, fotoUrl };
      this.refrescar();
    }
  }

  iniciales(nombre: string): string {
    return nombre.split(/\s+/).filter(Boolean).slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase()).join('') || 'SC';
  }

  cerrarDetalle(): void {
    this.usuarioSeleccionado = null;
    this.modoEdicion = false;
    this.usuarioEditado = null;
  }

  async editarUsuario(usuario: UsuarioVista): Promise<void> {
    this.usuarioSeleccionado = { ...usuario, direccionDatos: { ...usuario.direccionDatos } };
    this.usuarioEditado = { ...usuario, direccionDatos: { ...usuario.direccionDatos } };
    this.modoEdicion = true;
    this.mensajeEdicion = '';
    this.errorEdicion = '';
    this.cargarComunas(usuario.direccionDatos.region);
    this.refrescar();

    const fotoUrl = await this.perfilCache.cargarFoto(usuario.id);
    if (this.usuarioEditado?.id === usuario.id) {
      this.usuarioEditado = { ...this.usuarioEditado, fotoUrl };
      this.usuarioSeleccionado = { ...this.usuarioSeleccionado!, fotoUrl };
      this.refrescar();
    }
  }

  alCambiarRegion(region: string): void {
    if (!this.usuarioEditado) return;
    this.usuarioEditado.direccionDatos.region = region;
    this.usuarioEditado.direccionDatos.comuna = '';
    this.cargarComunas(region);
  }

  alCambiarRegionNuevoUsuario(region: string): void {
    this.nuevoUsuario.region = region;
    this.nuevoUsuario.comuna = '';
    this.cargarComunas(region);
  }

  cargarComunas(region: string): void {
    this.comunasDisponibles = this.regiones.find((item) => item.nombre === region)?.comunas ?? [];
  }

  async guardarUsuario(): Promise<void> {
    if (!this.usuarioEditado || this.guardando) return;

    this.guardando = true;
    this.errorEdicion = '';
    this.mensajeEdicion = '';
    this.refrescar();

    try {
      const usuario = this.usuarioEditado;
      const nombreCompleto = usuario.nombreCompleto.trim();
      if (!nombreCompleto) throw new Error('El nombre es obligatorio.');
      if (!validarNombreOApellido(nombreCompleto)) {
        throw new Error('El nombre solo puede contener letras y debe tener al menos 2 caracteres.');
      }
      if (!usuario.apellidopa.trim()) {
        throw new Error('El apellido paterno es obligatorio.');
      }
      if (!validarNombreOApellido(usuario.apellidopa) || usuario.apellidopa.trim().includes(' ')) {
        throw new Error('El apellido paterno debe ser una sola palabra, usando solo letras.');
      }
      if (
        usuario.apellidoma.trim()
        && (!validarNombreOApellido(usuario.apellidoma) || usuario.apellidoma.trim().includes(' '))
      ) {
        throw new Error('El apellido materno debe ser una sola palabra, usando solo letras.');
      }
      if (!usuario.correo.trim()) throw new Error('El correo es obligatorio.');
      if (!validarEmail(usuario.correo)) throw new Error('El correo tiene un formato inválido.');
      if (!usuario.idRol) throw new Error('Selecciona un tipo de cuenta.');
      if (usuario.rut !== '—' && usuario.rut.trim() && !validarRutChileno(usuario.rut)) {
        throw new Error('El RUT tiene un formato o dígito verificador inválido.');
      }
      if (!usuario.telefono || usuario.telefono === '—') {
        throw new Error('El teléfono es obligatorio.');
      }
      if (!validarTelefonoChileno(usuario.telefono)) {
        throw new Error('El teléfono debe ser un número móvil chileno válido, por ejemplo 9 1234 5678.');
      }

      const correoOriginal = this.usuarios.find((item) => item.id === usuario.id)?.correo ?? usuario.correo;
      const correoCambio = usuario.correo.trim().toLowerCase() !== correoOriginal.trim().toLowerCase();
      const datosPerfil = {
        p_usuario: usuario.id,
        p_nombre: nombreCompleto,
        p_apellidopa: usuario.apellidopa.trim() || null,
        p_apellidoma: usuario.apellidoma.trim() || null,
        p_correo: usuario.correo.trim(),
        p_rut: usuario.rut === '—' ? null : usuario.rut.trim(),
        p_telefono: usuario.telefono === '—' ? null : usuario.telefono.trim(),
        p_fecha_nacimiento: usuario.fechaNacimiento || null,
        p_rol_id: usuario.idRol,
        p_direccion_id: usuario.idDireccion || null,
        p_region: usuario.direccionDatos.region.trim() || null,
        p_comuna: usuario.direccionDatos.comuna.trim() || null,
        p_calle: usuario.direccionDatos.calle.trim() || null,
        p_numero: usuario.direccionDatos.numero.trim() || null
      };

      if (correoCambio) {
        const { data, error } = await this.supabaseService.getClient().functions.invoke('admin-actualizar-usuario', {
          body: {
            usuario_id: usuario.id,
            nombre: nombreCompleto,
            apellidopa: datosPerfil.p_apellidopa,
            apellidoma: datosPerfil.p_apellidoma,
            correo: usuario.correo.trim(),
            rut: datosPerfil.p_rut,
            telefono: datosPerfil.p_telefono,
            fecha_nacimiento: usuario.fechaNacimiento || null,
            rol_id: usuario.idRol,
            direccion_id: usuario.idDireccion,
            region: datosPerfil.p_region,
            comuna: datosPerfil.p_comuna,
            calle: datosPerfil.p_calle,
            numero: datosPerfil.p_numero
          }
        });

        if (error) throw new Error(error.message);
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      } else {
        const { error } = await this.supabaseService.getClient().rpc('admin_actualizar_usuario', datosPerfil);
        if (error) throw new Error(error.message);
      }

      const { data: estadoData, error: estadoEdgeError } =
        await this.supabaseService.getClient().functions.invoke('admin-cambiar-estado', {
          body: {
            usuario_id: usuario.id,
            activo: usuario.activo
          }
        });
      if (estadoEdgeError) throw new Error(estadoEdgeError.message);
      if ((estadoData as { error?: string })?.error) {
        throw new Error((estadoData as { error: string }).error);
      }

      await this.ngOnInit();
      const actualizado = this.usuarios.find((item) => item.id === usuario.id) ?? usuario;
      this.usuarioSeleccionado = actualizado;
      this.usuarioEditado = null;
      this.modoEdicion = false;
      this.mensajeEdicion = 'Información actualizada correctamente.';
      this.usuarioSeleccionado = { ...actualizado, fotoUrl: usuario.fotoUrl };
      await this.mostrarAlerta(
        'Cambios guardados',
        `La información de ${usuario.nombreCompleto.trim()} se actualizó correctamente.`
      );
    } catch (e: any) {
      this.errorEdicion = e?.message || 'No se pudo actualizar la información.';
      await this.mostrarAlerta(
        'No se pudieron guardar los cambios',
        e?.message || 'Revisa los datos e inténtalo nuevamente.'
      );
    } finally {
      this.guardando = false;
      this.refrescar();
    }
  }

  private async mostrarAlerta(header: string, message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      cssClass: 'alerta-usuarios',
      buttons: [{ text: 'Entendido', role: 'cancel' }]
    });

    await alert.present();
  }

  async enviarCambioContrasena(): Promise<void> {
    if (!this.usuarioEditado || this.guardando || this.enviandoEnlace) return;
    const correo = this.usuarioEditado.correo.trim();
    if (!correo || !validarEmail(correo)) {
      this.errorEdicion = 'Ingresa un correo válido antes de enviar el enlace.';
      await this.mostrarAlerta(
        'Correo inválido',
        'Revisa el correo de la persona antes de enviar el enlace de cambio de contraseña.'
      );
      return;
    }

    this.enviandoEnlace = true;
    this.errorEdicion = '';
    this.mensajeEdicion = '';
    this.refrescar();

    try {
      const redirectTo = `${window.location.origin}/cambiar-contrasena`;
      let tiempoAgotado: ReturnType<typeof setTimeout> | undefined;
      const limiteTiempo = new Promise<never>((_, rechazar) => {
        tiempoAgotado = setTimeout(
          () => rechazar(new Error('El correo está tardando demasiado en enviarse. Inténtalo nuevamente.')),
          15000
        );
      });

      const { error } = await Promise.race([
        this.supabaseService.getClient().auth.resetPasswordForEmail(correo, { redirectTo }),
        limiteTiempo
      ]);
      if (tiempoAgotado) clearTimeout(tiempoAgotado);
      if (error) throw new Error(error.message);
      this.mensajeEdicion = `Se envió el enlace de cambio de contraseña a ${correo}.`;
      await this.mostrarAlerta(
        'Enlace enviado',
        `Se envió el enlace de cambio de contraseña al correo ${correo}.`
      );
    } catch (e: any) {
      this.errorEdicion = e?.message || 'No se pudo enviar el enlace.';
      await this.mostrarAlerta(
        'No se pudo enviar el enlace',
        'No fue posible enviar el enlace ahora. Revisa la conexión y vuelve a intentarlo.'
      );
    } finally {
      this.enviandoEnlace = false;
      this.refrescar();
    }
  }

  formatearFecha(fecha: string | null): string {
    if (!fecha) return '—';
    const [anio, mes, dia] = fecha.split('-');
    if (!anio || !mes || !dia) return fecha;
    return `${dia}/${mes}/${anio}`;
  }

  private normalizar(valor: string): string {
    return valor.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private normalizarRut(valor: string): string {
    return valor.toUpperCase().replace(/[^0-9K]/g, '');
  }

  private async cargarRoles(): Promise<void> {
    const { data, error } = await this.supabaseService.getClient().rpc('admin_listar_roles');
    if (!error) this.roles = (data ?? []) as RolOpcion[];
  }

  private async cargarRegiones(): Promise<void> {
    try {
      this.regiones = await this.regionesComunas.regiones();
    } catch {
      this.regiones = [];
    }
  }

  private async precargarFotosUsuarios(): Promise<void> {
    await Promise.all(this.usuarios.map(async (usuario) => {
      await this.perfilCache.cargarFoto(usuario.id);
    }));
    this.refrescar();
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

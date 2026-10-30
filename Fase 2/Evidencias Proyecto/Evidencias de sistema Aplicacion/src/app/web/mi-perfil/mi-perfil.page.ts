import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { SupabaseService } from '../../services/supabase/supabase';
import { PerfilCacheService, PerfilResumen } from '../../services/perfil-cache/perfil-cache.service';
import {
  MotivoNombreInvalido,
  motivoNombreInvalido,
  validarFechaNacimiento,
  validarTelefonoChileno,
  validarTextoBasico
} from '../../services/utils/validators';
import { WebNav } from '../web-nav/web-nav';
import { RegionesComunasService, RegionChile } from '../../services/utils/regiones-comunas.service';

/** Lo que el formulario edita. Todo lo demás es de sólo lectura. */
interface FormularioPerfil {
  nombre: string;
  apellidopa: string;
  apellidoma: string;
  telefono: string;
  fecha_nacimiento: string;
  region: string;
  comuna: string;
  calle: string;
  numero: string;
}

/**
 * Tope de caracteres por campo.
 *
 * Los validadores chequean el formato pero no cuánto pesa el texto: sin esto
 * un nombre de diez mil caracteres pasa igual y se guarda igual.
 */
const LONGITUDES: Record<keyof FormularioPerfil, number> = {
  nombre: 50,
  apellidopa: 50,
  apellidoma: 50,
  telefono: 15,
  fecha_nacimiento: 10,
  region: 60,
  comuna: 60,
  calle: 80,
  numero: 10
};

/** Tamaño máximo del archivo de foto: más que de sobra para un retrato. */
const LIMITE_FOTO_BYTES = 5 * 1024 * 1024;

/** Por encima de este tamaño se achica antes de subir, para no llenar Storage. */
const UMBRAL_REDUCCION_BYTES = 800 * 1024;

/** Lado máximo que se conserva al achicar. */
const LADO_MAXIMO = 512;

@Component({
  selector: 'app-mi-perfil',
  templateUrl: 'mi-perfil.page.html',
  styleUrls: ['mi-perfil.page.scss'],
  imports: [WebNav, IonContent, FormsModule, RouterLink],
})
export class MiPerfilPage implements OnInit {

  cargando = true;
  guardando = false;

  /**
   * Los datos se ven en modo lectura hasta que se pide editar. Sin esto la
   * pantalla arrancaba con nueve campos en blanco llenables, y la mayoría de
   * las visitas son para mirar y no para cambiar nada.
   */
  modoEdicion = false;

  /** Copia editable. El perfil del caché nunca se toca: se copia. */
  borrador: FormularioPerfil | null = null;
  /** Copia de arranque, para poder cancelar sin volver a la base. */
  private original: FormularioPerfil | null = null;

  /** Correo, RUT y rol no se editan desde la web. */
  correo = '';
  rut = '';
  rol = '';

  errores: Record<string, string> = {};
  mensajeError = '';
  mensaje = '';

  fotoUrl: string | null = null;
  cargandoFoto = false;
  errorFoto = '';

  /** Imagen elegida, todavía sin subir. */
  private archivo: File | null = null;
  /** Vista previa local de la imagen elegida. */
  vistaPrevia: string | null = null;

  /** Guarda si hay dirección registrada: sin ella no hay fila que actualizar. */
  hayDireccion = false;
  regiones: RegionChile[] = [];
  comunasDisponibles: string[] = [];

  /** Para que el template pueda escribir los tope de largo en cada input. */
  readonly longitudes = LONGITUDES;

  private perfil: PerfilResumen | null = null;

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);
  private perfilCache = inject(PerfilCacheService);
  private regionesComunas = inject(RegionesComunasService);

  async ngOnInit() {
    this.perfil = await this.perfilCache.perfil();
    this.cargarEnFormulario(this.perfil);
    await this.cargarRegiones();
    this.cargando = false;
    this.refrescar();
  }

  // ---------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------

  private cargarEnFormulario(perfil: PerfilResumen | null): void {
    this.perfil = perfil;
    this.correo = perfil?.correo ?? '';
    this.rut = perfil?.rut ?? '';
    this.rol = perfil?.rol ?? '';
    this.fotoUrl = perfil?.fotoUrl ?? null;

    this.hayDireccion = !!(perfil?.idDireccion && perfil.direccion);

    const d = perfil?.direccion;
    const formulario: FormularioPerfil = {
      nombre: perfil?.nombre ?? '',
      apellidopa: perfil?.apellidopa ?? '',
      apellidoma: perfil?.apellidoma ?? '',
      telefono: perfil?.telefono ?? '',
      fecha_nacimiento: perfil?.fechaNacimiento ?? '',
      region: d?.region ?? '',
      comuna: d?.comuna ?? '',
      calle: d?.calle ?? '',
      numero: d?.numero ?? ''
    };

    this.borrador = formulario;
    this.original = { ...formulario };
  }

  /** Nombre completo armado, para el modo lectura. */
  get nombreCompleto(): string {
    return [this.borrador?.nombre, this.borrador?.apellidopa, this.borrador?.apellidoma]
      .map((parte) => (parte ?? '').trim())
      .filter(Boolean)
      .join(' ');
  }

  get direccionLegible(): string {
    const d = this.perfil?.direccion;
    if (!d) return 'Sin dirección registrada';
    return [d.calle, d.numero, d.comuna, d.region].filter(Boolean).join(', ');
  }

  get regionActualNoCatalogada(): string {
    const region = this.borrador?.region ?? '';
    return region && !this.regiones.some((item) => item.nombre === region) ? region : '';
  }

  // ---------------------------------------------------------------
  // Edición
  // ---------------------------------------------------------------

  editar() {
    this.modoEdicion = true;
    this.errores = {};
    this.mensajeError = '';
    this.mensaje = '';
    this.cargarComunas(this.borrador?.region ?? '');
    this.refrescar();
  }

  alCambiarRegion(region: string): void {
    if (!this.borrador) return;
    this.borrador.region = region;
    this.borrador.comuna = '';
    this.cargarComunas(region);
  }

  private async cargarRegiones(): Promise<void> {
    try {
      this.regiones = await this.regionesComunas.regiones();
      this.cargarComunas(this.borrador?.region ?? '');
    } catch {
      this.regiones = [];
      this.comunasDisponibles = [];
    }
  }

  private cargarComunas(region: string): void {
    const regionNormalizada = this.normalizarUbicacion(region);
    const coincide = this.regiones.find((item) => {
      const nombre = this.normalizarUbicacion(item.nombre);
      return nombre === regionNormalizada ||
        nombre.includes(regionNormalizada) ||
        regionNormalizada.includes(nombre);
    });
    this.comunasDisponibles = coincide?.comunas ?? [];
  }

  private normalizarUbicacion(valor: string): string {
    return valor.trim().toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\bregion\b/g, '')
      .replace(/\bde\b/g, '')
      .replace(/\bsantiago\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  cancelar() {
    if (!this.original) return;
    this.borrador = { ...this.original };
    this.errores = {};
    this.mensajeError = '';
    this.mensaje = '';
    // La foto elegida todavía no se subió: cancelar la descarta también,
    // igual que cualquier otro campo del formulario.
    this.errorFoto = '';
    this.archivo = null;
    this.vistaPrevia = null;
    this.modoEdicion = false;
    this.refrescar();
  }

  /**
   * Las mismas funciones que usa la app móvil, más el tope de largo, que los
   * validadores no cubren, y el motivo de cada error para poder decir algo
   * preciso ("no debe contener números") en vez del genérico de siempre.
   *
   * Única diferencia con la app: el apellido no admite espacios, porque un
   * apellido es una sola palabra; el nombre sí los admite (dos nombres).
   */
  private validar(): boolean {
    const f = this.borrador!;
    const errores: Record<string, string> = {};

    (Object.keys(LONGITUDES) as Array<keyof FormularioPerfil>).forEach((campo) => {
      if (f[campo].length > LONGITUDES[campo]) {
        errores[campo] = `Máximo ${LONGITUDES[campo]} caracteres.`;
      }
    });

    // El nombre admite espacios (hay personas con dos nombres); los
    // apellidos no: cada uno es una sola palabra.
    this.revisarNombre(errores, 'nombre', f.nombre, 'El nombre', false);
    this.revisarNombre(errores, 'apellidopa', f.apellidopa, 'El apellido paterno', true);
    if (f.apellidoma.trim().length > 0) {
      this.revisarNombre(errores, 'apellidoma', f.apellidoma, 'El apellido materno', true);
    }
    if (!validarTelefonoChileno(f.telefono)) {
      errores['telefono'] = 'Ingresa un teléfono chileno de 9 dígitos, ej: 912345678.';
    }
    if (!validarFechaNacimiento(f.fecha_nacimiento)) {
      errores['fecha_nacimiento'] = 'Ingresa una fecha de nacimiento válida y no futura.';
    }

    if (this.hayDireccion) {
      if (!validarTextoBasico(f.region, 2)) errores['region'] = 'La región es requerida.';
      if (!validarTextoBasico(f.comuna, 2)) errores['comuna'] = 'La comuna es requerida.';
      if (!validarTextoBasico(f.calle, 2)) errores['calle'] = 'La calle es requerida.';
      if (!validarTextoBasico(f.numero, 1)) errores['numero'] = 'El número es requerido.';
    }

    this.errores = errores;
    const hayErrores = Object.keys(errores).length > 0;
    this.mensajeError = hayErrores ? 'Revisa los campos marcados en rojo.' : '';
    return !hayErrores;
  }

  /**
   * Deja en `errores` el mensaje que corresponde al motivo real del campo.
   *
   * Decir sólo "debe tener al menos 2 letras" cuando se escribió un número
   * hace perder tiempo: la persona no sabe qué corregir.
   */
  private revisarNombre(
    errores: Record<string, string>,
    campo: keyof FormularioPerfil,
    valor: string,
    etiqueta: string,
    esApellido: boolean
  ): void {
    const motivo = motivoNombreInvalido(valor, { apellido: esApellido });
    if (motivo) errores[campo] = this.mensajeNombre(motivo, etiqueta, esApellido);
  }

  /** Mensaje legible para cada motivo, con el nombre del campo al frente. */
  private mensajeNombre(
    motivo: MotivoNombreInvalido,
    etiqueta: string,
    esApellido: boolean
  ): string {
    switch (motivo) {
      case 'vacio':
        return `${etiqueta} es requerido.`;
      case 'numeros':
        return `${etiqueta} no debe contener números.`;
      case 'espacios':
        return `${etiqueta} no debe contener espacios.`;
      case 'corto':
        return `${etiqueta} debe tener al menos 2 letras.`;
      case 'caracteres':
      default:
        return esApellido
          ? `${etiqueta} debe contener sólo letras.`
          : `${etiqueta} debe contener sólo letras y espacios.`;
    }
  }

  async guardar() {
    if (!this.borrador || !this.perfil || this.guardando) return;

    this.errores = {};
    this.mensajeError = '';
    this.mensaje = '';

    if (!this.validar()) {
      this.refrescar();
      return;
    }

    this.guardando = true;
    this.refrescar();

    let datosOk = false;
    let subioFoto = false;
    let fotoFallo = false;

    try {
      const cliente = this.supabaseService.getClient();
      const f = this.borrador;

      if (this.hayDireccion) {
        const { error: errorDireccion } = await cliente
          .from('direccion')
          .update({
            region: f.region,
            comuna: f.comuna,
            calle: f.calle,
            numero: f.numero
          })
          .eq('id', this.perfil.idDireccion);

        if (errorDireccion) throw new Error(errorDireccion.message);
      }

      const { error } = await cliente
        .from('usuario')
        .update({
          nombre: f.nombre.trim(),
          apellidopa: f.apellidopa.trim(),
          apellidoma: f.apellidoma.trim(),
          telefono: f.telefono.trim(),
          fecha_nacimiento: f.fecha_nacimiento
        })
        .eq('id', this.perfil.id);

      if (error) throw new Error(error.message);

      // El navbar y los demás paneles pintan el nombre desde este caché, que
      // dura 5 minutos. Sin invalidarlo acá seguirían viendo el nombre viejo.
      this.perfilCache.limpiar();

      this.original = { ...f };
      datosOk = true;
    } catch (e: any) {
      this.mensajeError = e?.message || 'No se pudieron guardar los datos.';
    }

    // La foto elegida se sube en el MISMO guardar que los datos: no hay un
    // botón aparte para eso. Si los datos no se guardaron no se sube nada,
    // para no dejar la foto cambiada con el formulario a medias.
    if (datosOk && this.archivo) {
      this.cargandoFoto = true;
      this.errorFoto = '';
      this.refrescar();

      try {
        await this.subirFoto();
        subioFoto = true;
      } catch (e: any) {
        fotoFallo = true;
        this.errorFoto =
          'Los datos se guardaron, pero no se pudo subir la foto: ' +
          `${e?.message || 'intenta de nuevo.'}`;
      }

      this.cargandoFoto = false;
    }

    this.guardando = false;

    if (this.mensajeError || fotoFallo) {
      // Se sigue en modo edición para poder reintentar la foto o corregir
      // lo que falle; la cancelar descarta lo que quedó elegido.
      this.refrescar();
      return;
    }

    this.modoEdicion = false;
    this.errorFoto = '';
    this.mensaje = subioFoto ? 'Datos y foto actualizados.' : 'Datos actualizados.';
    this.refrescar();
  }

  // ---------------------------------------------------------------
  // Foto de perfil
  // ---------------------------------------------------------------

  /**
   * Archivo elegido desde el disco. Se valida el tipo y el tamaño antes de
   * generar la vista previa: si no, se sube lo que sea.
   */
  async alElegirFoto(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0] ?? null;
    input.value = '';

    this.errorFoto = '';
    this.archivo = null;
    this.vistaPrevia = null;

    if (!archivo) return;

    if (archivo.type !== 'image/jpeg' && archivo.type !== 'image/png') {
      this.errorFoto = 'La imagen debe ser JPG o PNG.';
      this.refrescar();
      return;
    }

    if (archivo.size > LIMITE_FOTO_BYTES) {
      this.errorFoto = 'La imagen pesa más de 5 MB. Elige una más liviana.';
      this.refrescar();
      return;
    }

    try {
      const dataUrl = await this.leerComoDataUrl(archivo);
      this.archivo = archivo;
      this.vistaPrevia = dataUrl;
    } catch {
      this.errorFoto = 'No se pudo leer la imagen elegida.';
    }

    this.refrescar();
  }

  /**
   * Sube la foto elegida. Sólo se llama desde `guardar()`: elegir el archivo
   * no sube nada, la subida es parte de "Guardar cambios".
   */
  private async subirFoto(): Promise<void> {
    if (!this.archivo || !this.perfil) return;

    let dataUrl = this.vistaPrevia!;
    if (this.archivo.size > UMBRAL_REDUCCION_BYTES) {
      dataUrl = await this.reducirImagen(dataUrl);
    }

    const bytes = this.dataUrlABytes(dataUrl);
    const ruta = `${this.perfil.id}/perfil_${Date.now()}.jpg`;

    await this.eliminarFotoExistente();

    const { error } = await this.supabaseService.getClient()
      .storage
      .from('fotos-perfil')
      .upload(ruta, bytes, { contentType: 'image/jpeg', upsert: true });

    if (error) throw new Error(error.message);

    // `limpiar()` además avisa a la barra, que repinta al instante.
    this.perfilCache.limpiar();

    this.archivo = null;
    this.vistaPrevia = null;

    // El caché de foto quedó vacío arriba: se pide la firma de la que acaba
    // de subirse para que la miniatura muestre la nueva de una.
    const url = await this.perfilCache.cargarFoto(this.perfil.id);
    this.fotoUrl = url ?? null;
  }

  /** Borra el archivo que haya en la carpeta del usuario (sólo puede haber uno). */
  private async eliminarFotoExistente(): Promise<void> {
    if (!this.perfil) return;

    const carpeta = `${this.perfil.id}/`;
    const { data } = await this.supabaseService.getClient()
      .storage
      .from('fotos-perfil')
      .list(carpeta, { limit: 1 });

    if (data?.length) {
      await this.supabaseService.getClient()
        .storage
        .from('fotos-perfil')
        .remove([`${carpeta}${data[0].name}`]);
    }
  }

  private leerComoDataUrl(archivo: File): Promise<string> {
    return new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(String(lector.result ?? ''));
      lector.onerror = () => rechazar(new Error('no se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });
  }

  /**
   * Achica una imagen grande antes de subirla.
   *
   * Sólo se invoca para archivos pesados: una foto de celular moderno pesa
   * varios MB y no aporta nada tenerla a tamaño original en Storage. Si algo
   * falla se sube la original en vez de dejar a la persona sin foto.
   */
  private async reducirImagen(dataUrl: string): Promise<string> {
    try {
      const imagen = new Image();
      await new Promise<void>((resolver, rechazar) => {
        imagen.onload = () => resolver();
        imagen.onerror = () => rechazar(new Error('imagen ilegible'));
        imagen.src = dataUrl;
      });

      const escala = LADO_MAXIMO / Math.max(imagen.width, imagen.height);
      if (escala >= 1) return dataUrl;

      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(imagen.width * escala);
      lienzo.height = Math.round(imagen.height * escala);

      const contexto = lienzo.getContext('2d');
      if (!contexto) return dataUrl;

      contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
      return lienzo.toDataURL('image/jpeg', 0.85);
    } catch {
      return dataUrl;
    }
  }

  private dataUrlABytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1] ?? '';
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) {
      bytes[i] = binario.charCodeAt(i);
    }
    return bytes;
  }

  // ---------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   *
   * `markForCheck()` dejaba la vista "sucia" y esperando al programador de
   * cambio de detección, que en este caso no llegaba: elegir una foto
   * dejaba la vista previa invisible hasta que alguien hacía click en
   * cualquier lado. `detectChanges()` repinta en el
   * acto, sin depender de esa segunda vuelta.
   */
  private refrescar() {
    this.cdr.detectChanges();
  }
}

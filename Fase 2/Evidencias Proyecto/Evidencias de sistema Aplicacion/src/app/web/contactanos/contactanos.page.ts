import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonContent, IonSpinner } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { validarEmail, validarNombreOApellido, validarTelefonoChileno } from '../../services/utils/validators';
import { WebNav } from '../web-nav/web-nav';

/**
 * Campos que puede marcar el servidor, para poder remarcar la casilla exacta y
 * no marcarlo todo cuando falló una sola cosa.
 */
type Campo = 'nombre' | 'correo' | 'telefono' | 'motivo' | 'comentario';

/**
 * Cuánto se espera al servidor antes de cortar.
 *
 * Una Edge Function en frío (la primera llamada después de un rato sin uso)
 * tarda varios segundos en arrancar. El timeout no es para Alexandría: es para
 * que si algo se queda colgado la persona no quede mirando un botón apagado sin
 * saber si salió o no.
 */
const TIEMPO_LIMITE_MS = 20000;

@Component({
  selector: 'app-contactanos',
  templateUrl: 'contactanos.page.html',
  styleUrls: ['contactanos.page.scss'],
  imports: [WebNav, RouterLink, FormsModule, IonContent, IonSpinner],
})
export class ContactanosPage {
  /**
   * Motivos que se ofrecen. Deben coincidir con la lista `MOTIVOS` de la función
   * `enviar-contacto`: si se agrega una opción acá y no allá, la función la
   * rechaza por no estar en su lista cerrada.
   */
  readonly motivos = [
    'Consulta general',
    'Problema con mi cuenta',
    'Ayuda para usar la app',
    'Sugerencia',
    'Reclamo',
    'Otro',
  ];

  nombre = '';
  correo = '';
  telefono = '';
  motivo = '';
  comentario = '';

  /** Campo trampa: invisible para la persona, irresistible para los robots. */
  sitio_web = '';

  cargando = false;

  errores: {
    nombre?: string;
    correo?: string;
    telefono?: string;
    motivo?: string;
    comentario?: string;
  } = {};

  private cdr = inject(ChangeDetectorRef);
  private alertCtrl = inject(AlertController);

  // La app corre SIN zone.js (zoneless): cambiar `cargando` después de un await
  // NO repinta la vista por sí solo.
  private refrescar() {
    this.cdr.markForCheck();
  }

  /**
   * Usa los mismos validadores que el login y el registro en vez de reglas
   * propias: así el correo, el nombre y el teléfono se comportan igual en toda
   * la aplicación, y si mañana se cambia una regla se cambia en un solo lugar.
   */
  private esValido(): boolean {
    this.errores = {};

    if (!this.nombre.trim()) {
      this.errores.nombre = 'Ingresa tu nombre completo.';
    } else if (!validarNombreOApellido(this.nombre)) {
      // `validarNombreOApellido` también falla con menos de 2 caracteres, así
      // que el mensaje tiene que servir para los dos casos.
      this.errores.nombre = 'Solo puede contener letras. Ej: María Fernández Pérez.';
    }

    if (!this.correo.trim()) {
      this.errores.correo = 'Ingresa tu correo electrónico.';
    } else if (!validarEmail(this.correo)) {
      this.errores.correo = 'El correo no tiene un formato válido.';
    }

    if (!this.telefono.trim()) {
      this.errores.telefono = 'Ingresa tu número de teléfono.';
    } else if (!validarTelefonoChileno(this.telefono)) {
      this.errores.telefono = 'Debe tener 9 dígitos, empezando con 9. Ej: 912345678 o +56 9 1234 5678.';
    }

    if (!this.motivo) {
      this.errores.motivo = 'Selecciona un motivo de contacto.';
    }

    if (!this.comentario.trim()) {
      this.errores.comentario = 'Escribe tu comentario.';
    } else if (this.comentario.trim().length < 10) {
      this.errores.comentario = 'Cuéntanos un poco más (mínimo 10 caracteres).';
    }

    return Object.keys(this.errores).length === 0;
  }

  async enviar() {
    if (!this.esValido()) {
      this.refrescar();
      return;
    }

    // Se manda lo que la persona escribió ANTES de esperar al servidor. Si el
    // envío falla y hay que reintentar, no perdió el texto, y el botón puede
    // mostrar de inmediato en qué estado va.
    const cuerpo = {
      nombre: this.nombre.trim(),
      correo: this.correo.trim(),
      telefono: this.telefono.trim(),
      motivo: this.motivo,
      comentario: this.comentario.trim(),
      sitio_web: this.sitio_web,
    };

    this.cargando = true;
    this.refrescar();

    try {
      const response = await fetch(`${environment.supabaseUrl}/functions/v1/enviar-contacto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': environment.supabaseKey,
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        // La función devuelve en qué campo falló, así que se marca sólo esa
        // casilla. Sin eso habría que marcar todo (engañoso: sugiere que los
        // cinco campos están mal) o no marcar nada.
        const campo: unknown = result?.campo;
        if (this.esCampoValido(campo)) {
          this.errores[campo] = result.error;
          this.refrescar();
        }

        await this.mostrarAlerta(
          'Revisa el formulario',
          result?.error || 'Hay datos que no pudimos procesar. Revisa los campos marcados.',
          'error'
        );
        return;
      }

      this.limpiarFormulario();
      await this.mostrarAlerta(
        'Mensaje enviado',
        'Gracias por escribirnos. Te responderemos a la brevedad.',
        'ok'
      );

    } catch (error) {
      const seVencio = error instanceof DOMException && error.name === 'TimeoutError';

      await this.mostrarAlerta(
        seVencio ? 'Demasiado tiempo' : 'Error de conexión',
        seVencio
          ? 'El servidor tardó demasiado en responder. Revisa tu internet e intenta otra vez.'
          : 'No pudimos enviar el mensaje. Revisa tu conexión a internet.',
        'error'
      );

      // El texto NO se borra en el error: perder lo que alguien escribió por un
      // problema de red es la peor forma de tratar a quien pidió ayuda.
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

  private limpiarFormulario() {
    this.nombre = '';
    this.correo = '';
    this.telefono = '';
    this.motivo = '';
    this.comentario = '';
    this.errores = {};
  }

  /**
   * El nombre del campo viene del servidor. Se acepta sólo si es uno de los
   * campos reales: sin esta comprobación, un `campo: "__proto__"` en la
   * respuesta terminaría escribiendo en el objeto equivocado.
   */
  private esCampoValido(campo: unknown): campo is Campo {
    return campo === 'nombre' ||
      campo === 'correo' ||
      campo === 'telefono' ||
      campo === 'motivo' ||
      campo === 'comentario';
  }

  /**
   * Avisos de resultado como alert, igual que el resto de la app
   * (`alerta-cerrar-sesion`, `alerta-detalle-historial`). Los errores de campo
   * NO van aquí: esos van debajo del input, porque corresponden a un campo
   * concreto y se leen de un vistazo junto al que hay que corregir.
   */
  private async mostrarAlerta(header: string, message: string, tipo: 'ok' | 'error') {
    const alert = await this.alertCtrl.create({
      header,
      message,
      cssClass: `alerta-contacto alerta-contacto--${tipo}`,
      buttons: [
        {
          text: 'Entendido',
          role: 'cancel',
        },
      ],
    });

    await alert.present();
  }
}

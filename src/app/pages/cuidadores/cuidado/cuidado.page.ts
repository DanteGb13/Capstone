import { Component, OnInit, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonBackButton,
  AlertController,
  ToastController,
  IonRefresher,
  IonRefresherContent
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { NavegacionRolService } from '../../../services/navegacion-rol/navegacion-rol';
import { SupabaseService } from '../../../services/supabase/supabase';
import { PermisosExtra } from '../../../services/Backend/permisos-extra/permisos-extra';
import { EstadoConexionComponent } from '../../../components/estado-conexion/estado-conexion.component';
import { estaEnLinea } from '../../../services/Backend/presencia/presencia';
import { Capacitor } from '@capacitor/core';

@Component({
  selector: 'app-cuidado',
  templateUrl: './cuidado.page.html',
  styleUrls: ['./cuidado.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonBackButton,
    IonRefresher,
    IonRefresherContent,
    CommonModule,
    EstadoConexionComponent
  ]
})
export class CuidadoPage implements OnInit {

  @ViewChild(IonRefresher) refresher!: IonRefresher;

  adultosACargo: any[] = [];
  cargandoAdultos = false;

  constructor(
    private vinculacionService: Vinculacion,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private navRol: NavegacionRolService,
    private supabaseService: SupabaseService,
    private alertController: AlertController,
    private toastController: ToastController
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    await this.cargarAdultos();
  }

  async ionViewWillEnter() {
    await this.cargarAdultos();
  }

  async handleRefresh(event: any) {
    await this.cargarAdultos();
    event.target.complete();
  }

  async cargarAdultos() {
    this.cargandoAdultos = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();
      this.cdr.detectChanges();
      this.cargarFotosPerfiles().then(() => this.cdr.detectChanges());
    } catch (e) {
      console.error('Error:', e);
    } finally {
      this.cargandoAdultos = false;
      this.cdr.detectChanges();
    }
  }

  async cargarFotosPerfiles() {
    const supabase = this.supabaseService.getClient();

    await Promise.all(
      this.adultosACargo.map(async (item) => {
        const userId = item.adulto_mayor?.id;
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
        } catch (error) {
          item.adulto_mayor.foto_url = null;
        }
      })
    );
  }

  /**
 * Menú de acciones de una persona a cargo.
 *
 * Antes era una hoja de acciones escondida detrás del avatar, y el avatar no
 * tenía nada que indicara que fuera pulsable. Ahora es un botón visible que
 * abre una alerta: se lee mejor en pantalla chica, muestra de qué persona se
 * trata y deja ordenada la información útil (estado, comuna y teléfono) antes
 * de las acciones.
 *
 * "Llamar" sólo aparece si la persona tiene teléfono: ofrecer la opción y que
 * no pase nada sería peor que no ofrecerla.
 */
async abrirOpcionesAdulto(item: any) {
    const nombre = item.adulto_mayor?.nombre || '';
    const apellido = item.adulto_mayor?.apellidopa || '';
    const nombreCompleto = `${nombre} ${apellido}`.trim() || 'Persona a tu cuidado';
    const telefono = item.adulto_mayor?.telefono;
    const comuna = item.adulto_mayor?.direccion?.comuna;

    // El mensaje va como texto plano a propósito. Esta app tiene
    // `innerHTMLTemplatesEnabled` en false, así que cualquier etiqueta que se
    // pase acá se vería literalmente escrita en pantalla ("<br>", "<strong>").
    // Los saltos de línea los resuelve el CSS con `white-space: pre-line`.
    const lineas: string[] = [];

    const enLinea = this.estaConectado(item);
    lineas.push(
      enLinea === true ? 'En línea ahora' : enLinea === false ? 'Sin conexión' : 'Sin datos de conexión'
    );

    if (comuna) lineas.push(`Comuna: ${comuna}`);
    if (telefono) lineas.push(`Teléfono: ${telefono}`);

    // Lo que se pierde al desvincular, escrito aquí y no sólo en la pantalla
    // siguiente: el dedo llega a estos botones mucho antes que a la
    // confirmación, así que es el momento en que hay que leerlo.
    lineas.push('');
    lineas.push('⚠ Desvincular no se puede deshacer: dejarás de ver su ubicación y de recibir sus alertas.');

    const buttons: any[] = [];

    if (telefono) {
      buttons.push({
        text: 'Llamar',
        cssClass: 'alerta-btn-llamar',
        handler: () => {
          this.llamarAdulto(telefono);
        }
      });
    }

    buttons.push({
      text: 'Desvincular',
      role: 'destructive',
      handler: () => {
        this.confirmarDesvincular(item);
      }
    });

    buttons.push({
      text: 'Cancelar',
      role: 'cancel'
    });

    const alert = await this.alertController.create({
      header: nombreCompleto,
      cssClass: 'alerta-opciones-adulto',
      message: lineas.join('\n'),
      buttons
    });

    await alert.present();
  }

  /**
   * Si la persona tiene la app con internet en este momento.
   *
   * Usa el mismo umbral que el badge de conexión para que el anillo del avatar
   * y el texto "En línea / Sin conexión" nunca se contradigan.
   */
  estaConectado(item: any): boolean | null {
    return estaEnLinea(item?.adulto_mayor?.ultimo_visto);
  }

  /**
 * Confirmación final de la desvinculación.
 *
 * Pide el nombre completo en vez de un "¿Seguro?" genérico: la pregunta
 * "¿Seguro que quieres desvincular?" no dice a quién, y con varias personas a
 * cargo es fácil confirmar sobre la persona equivocada.
 */
async confirmarDesvincular(item: any) {
    const nombre = item.adulto_mayor?.nombre || 'esta persona';
    const apellido = item.adulto_mayor?.apellidopa || '';
    const nombreCompleto = `${nombre} ${apellido}`.trim();

    const alert = await this.alertController.create({
      header: 'Desvincular',
      message: `Vas a dejar de cuidar a ${nombreCompleto}. Esta acción no se puede deshacer.`,
      cssClass: 'alerta-opciones-adulto',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel'
        },
        {
          text: 'Desvincular',
          role: 'destructive',
          handler: async () => {
            await this.desvincularAdulto(item);
          }
        }
      ]
    });

    await alert.present();
  }

  async desvincularAdulto(item: any) {
    try {
      const idCuidador = item.id_cuidador;
      const idUsuario = item.adulto_mayor?.id || item.id_usuario;

      // Sin volcar `item`: trae el perfil del adulto mayor (nombre, RUT,
      // teléfono, correo), que es dato personal de un tercero.
      if (!idCuidador || !idUsuario) {
        console.error('Faltan datos para desvincular: idCuidador o idUsuario vacío');
        const alert = await this.alertController.create({
          header: 'Error',
          message: 'No se pudieron obtener los datos para desvincular.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      await this.vinculacionService.desvincular(idCuidador, idUsuario);

      const toast = await this.toastController.create({
        message: 'Vinculación eliminada',
        duration: 2000,
        color: 'success'
      });
      await toast.present();

      this.adultosACargo = [];
      this.cdr.detectChanges();
      await this.cargarAdultos();
    } catch (error: any) {
      console.error('Error al desvincular:', error);
      const alert = await this.alertController.create({
        header: 'Error al desvincular',
        message: error?.message || 'No se pudo completar la desvinculación. Verifica tu conexión y permisos.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  verUbicacion(item: any) {
    const id = item?.adulto_mayor?.id || item?.id_usuario || item?.id;
    if (id) {
      this.router.navigate(['/ubicacion'], { queryParams: { id } });
    } else {
      this.router.navigate(['/ubicacion']);
    }
  }

  async llamarAdulto(telefono: string) {
    if (!telefono) return;
    const telLimpio = telefono.replace(/[\s\-\(\)\+]/g, '');
    if (Capacitor.isNativePlatform()) {
      await PermisosExtra.realizarLlamada({ telefono: telLimpio });
    } else {
      window.location.href = `tel:${telLimpio}`;
    }
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }
}

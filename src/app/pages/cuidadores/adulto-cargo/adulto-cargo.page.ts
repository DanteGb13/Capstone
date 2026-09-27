import { Component, OnInit, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonIcon,
  IonSpinner,
  AlertController,
  ActionSheetController,
  ToastController,
  IonRefresher,
  IonRefresherContent
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { EstadoConexionComponent } from '../../../components/estado-conexion/estado-conexion.component';
import { SupabaseService } from '../../../services/supabase/supabase';

@Component({
  selector: 'app-adulto-cargo',
  templateUrl: './adulto-cargo.page.html',
  styleUrls: ['./adulto-cargo.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonIcon,
    IonSpinner,
    IonRefresher,
    IonRefresherContent,
    CommonModule,
    FormsModule,
    EstadoConexionComponent
  ]
})
export class AdultoCargoPage implements OnInit {

  @ViewChild(IonRefresher) refresher!: IonRefresher;

  adultosACargo: any[] = [];
  cargando: boolean = false;

  constructor(
    private vinculacionService: Vinculacion,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private supabaseService: SupabaseService,
    private alertController: AlertController,
    private actionSheetController: ActionSheetController,
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
    this.cargando = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();
      this.changeDetectorRef.detectChanges();
      this.cargarFotosPerfiles().then(() => this.changeDetectorRef.detectChanges());
    } catch (error: any) {
      console.error('Error al obtener adultos a cargo:', error);
    } finally {
      this.cargando = false;
      this.changeDetectorRef.detectChanges();
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

  async abrirOpcionesAdulto(item: any) {
    const nombre = item.adulto_mayor?.nombre || '';
    const apellido = item.adulto_mayor?.apellidopa || '';
    const nombreCompleto = `${nombre} ${apellido}`.trim();
    const telefono = item.adulto_mayor?.telefono;

    const buttons: any[] = [];

    if (telefono) {
      buttons.push({
        text: 'Llamar',
        icon: 'call-outline',
        handler: () => {
          this.llamarAdulto(telefono);
        }
      });
    }

    buttons.push({
      text: 'Desvincular',
      icon: 'trash-outline',
      role: 'destructive',
      handler: () => {
        this.confirmarDesvincular(item);
      }
    });

    buttons.push({
      text: 'Cancelar',
      role: 'cancel'
    });

    const actionSheet = await this.actionSheetController.create({
      header: nombreCompleto,
      buttons
    });

    await actionSheet.present();
  }

  async confirmarDesvincular(item: any) {
    const nombre = item.adulto_mayor?.nombre || 'esta persona';
    const apellido = item.adulto_mayor?.apellidopa || '';
    const nombreCompleto = `${nombre} ${apellido}`.trim();

    const alert = await this.alertController.create({
      header: 'Desvincular',
      message: `¿Seguro que quieres desvincular a <strong>${nombreCompleto}</strong>?`,
      cssClass: 'alerta-cerrar-sesion',
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

      console.log('Intentando desvincular:', { idCuidador, idUsuario, item });

      if (!idCuidador || !idUsuario) {
        console.error('Faltan datos para desvincular', { idCuidador, idUsuario });
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
      this.changeDetectorRef.detectChanges();
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

  verUbicacion(adulto: any) {
    const id = adulto?.adulto_mayor?.id || adulto?.id_usuario || adulto?.id;
    if (id) {
      this.router.navigate(['/ubicacion'], { queryParams: { id } });
    } else {
      this.router.navigate(['/ubicacion']);
    }
  }

  verHistorial(adulto: any) {
    this.router.navigate(['/historial']);
  }

  llamarAdulto(telefono?: string) {
    if (telefono) {
      window.open(`tel:${telefono}`, '_system');
    }
  }

}

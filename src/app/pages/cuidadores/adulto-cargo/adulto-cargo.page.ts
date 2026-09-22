import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
  IonSpinner
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
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
    CommonModule,
    FormsModule
  ]
})
export class AdultoCargoPage implements OnInit {

  adultosACargo: any[] = [];
  cargando: boolean = false;

  constructor(
    private vinculacionService: Vinculacion,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private supabaseService: SupabaseService
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    await this.cargarAdultos();
  }

  async cargarAdultos() {
    this.cargando = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();
      await this.cargarFotosPerfiles();
    } catch (error: any) {
      console.error('Error al obtener adultos a cargo:', error);
    } finally {
      this.cargando = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async cargarFotosPerfiles() {
    const supabase = this.supabaseService.getClient();

    for (const item of this.adultosACargo) {
      const userId = item.adulto_mayor?.id;
      if (!userId) continue;

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

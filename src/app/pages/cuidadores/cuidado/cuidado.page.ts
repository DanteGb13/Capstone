import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
  IonBackButton
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { NavegacionRolService } from '../../../services/navegacion-rol/navegacion-rol';
import { SupabaseService } from '../../../services/supabase/supabase';

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
    CommonModule
  ]
})
export class CuidadoPage implements OnInit {

  adultosACargo: any[] = [];
  cargandoAdultos = false;

  constructor(
    private vinculacionService: Vinculacion,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private navRol: NavegacionRolService,
    private supabaseService: SupabaseService
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    await this.cargarAdultos();
  }

  async ionViewWillEnter() {
    await this.cargarAdultos();
  }

  async cargarAdultos() {
    this.cargandoAdultos = true;
    try {
      this.adultosACargo = await this.vinculacionService.obtenerAdultosACargo();
      await this.cargarFotosPerfiles();
    } catch (e) {
      console.error('Error:', e);
    } finally {
      this.cargandoAdultos = false;
      this.cdr.detectChanges();
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

  verUbicacion(item: any) {
    const id = item?.adulto_mayor?.id || item?.id_usuario || item?.id;
    if (id) {
      this.router.navigate(['/ubicacion'], { queryParams: { id } });
    } else {
      this.router.navigate(['/ubicacion']);
    }
  }

  llamarAdulto(telefono: string) {
    if (telefono) {
      window.open(`tel:${telefono}`, '_system');
    }
  }

  verHistorial() {
    this.router.navigate(['/historial']);
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }
}

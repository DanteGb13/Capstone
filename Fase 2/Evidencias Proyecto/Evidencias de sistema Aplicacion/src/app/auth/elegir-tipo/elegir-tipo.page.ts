import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { personOutline, peopleOutline } from 'ionicons/icons';
import { Login } from '../../services/guards/login/login';
import { SupabaseService } from '../../services/supabase/supabase';
import { NavegacionRolService } from '../../services/navegacion-rol/navegacion-rol';
import { PushNotificationService } from '../../services/Backend/push-notification/push-notification';
import { PerfilCacheService } from '../../services/perfil-cache/perfil-cache.service';

@Component({
  selector: 'app-elegir-tipo',
  templateUrl: './elegir-tipo.page.html',
  styleUrls: ['./elegir-tipo.page.scss'],
  imports: [
    IonContent,
    IonButton,
    IonIcon,
    CommonModule
  ]
})
export class ElegirTipoPage implements OnInit {

  cargando: boolean = false;

  constructor(
    private loginService: Login,
    private router: Router,
    private supabaseService: SupabaseService,
    private navRol: NavegacionRolService,
    private pushService: PushNotificationService,
    private perfilCache: PerfilCacheService
  ) {
    addIcons({ personOutline, peopleOutline });
  }

  async ngOnInit() {
    const supabase = this.supabaseService.getClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  async elegir(tipo: 'Usuario' | 'Familiar') {
    this.cargando = true;
    try {
      await this.loginService.completarRegistroGoogle(tipo);
      this.navRol.limpiarCache();
      this.router.navigate(['/siguiente-paso'], { replaceUrl: true });
    } catch (error: any) {
      console.error('Error al completar el registro:', error);
      this.cargando = false;
    }
  }

  async irLogin() {
    // Este celular deja de estar atado a la cuenta actual antes de salir.
    //
    // Va en su propio try: si la limpieza del token falla (sin red, por
    // ejemplo) NO debe impedir cerrar sesión. Antes estaba todo junto y un
    // fallo de red dejaba la sesión abierta, que es justo lo que hace que
    // después lleguen avisos de la cuenta anterior.
    try {
      await this.pushService.eliminarToken();
    } catch (e) {
      console.warn('No se pudo liberar el token de esta cuenta:', e);
    }

    try {
      await this.supabaseService.getClient().auth.signOut();
    } catch (e) {
      console.warn('No se pudo cerrar la sesión:', e);
    }

    this.perfilCache.limpiar();
    localStorage.removeItem('tipo_cuenta_google');
    localStorage.removeItem('datos_registro_temp');
    this.navRol.limpiarCache();
    this.router.navigate(['/login'], { replaceUrl: true });
  }

}

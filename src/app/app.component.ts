import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AlarmasService } from './services/alarmas/alarmas';
import { FontSizeService } from './services/font-size/font-size';
import { ColorblindService } from './services/colorblind/colorblind.service';
import { PresenciaService } from './services/Backend/presencia/presencia';
import { PushNotificationService } from './services/Backend/push-notification/push-notification';
import { PermisosService } from './services/permisos/permisos.service';
import { PerfilCacheService } from './services/perfil-cache/perfil-cache.service';
import { RealtimeService } from './services/realtime/realtime.service';
import { SupabaseService } from './services/supabase/supabase';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {

  private presenciaService = inject(PresenciaService);
  private pushService = inject(PushNotificationService);
  private permisosService = inject(PermisosService);
  private perfilCache = inject(PerfilCacheService);
  private realtimeService = inject(RealtimeService);
  private supabaseService = inject(SupabaseService);

  constructor(
    private router: Router,
    private alarmasService: AlarmasService,
    // Se inyecta para que aplique el tamaño de letra guardado al arrancar.
    private fontSizeService: FontSizeService,
    // Igual que el tamaño de letra: el filtro de daltónicos guardado tiene que
    // estar puesto antes del primer pintado de pantalla.
    private colorblindService: ColorblindService
  ) {
    void this.fontSizeService;
    void this.colorblindService;

    this.alarmasService.escucharTap(() => {
      this.router.navigate(['/recordatorios']);
    });

    // Deja constancia de que la app está activa (estado "en línea" para el cuidador)
    this.presenciaService.iniciar();

    // Tocar una alerta SOS con la app cerrada tiene que confirmarse aunque
    // el panel del cuidador todavía no se haya abierto.
    this.pushService.escucharDesdeArranque();

    this.escucharCambioDeSesion();
    this.revisarAlVolver();
  }

  /**
   * Limpia TODO lo que es de la cuenta anterior al cambiar de sesión.
   *
   * Sin esto aparecen dos bugs de la misma familia:
   *  - se muestra el nombre y la foto del usuario que estaba antes,
   *  - el token de push queda asociado a la cuenta vieja y las dos siguen
   *    recibiendo las alertas en este teléfono.
   */
  private escucharCambioDeSesion(): void {
    try {
      this.supabaseService.getClient().auth.onAuthStateChange((evento, sesion) => {
        if (evento === 'SIGNED_OUT' || !sesion) {
          console.log('[App] sesión cerrada: se limpian los datos de la cuenta anterior');
          this.perfilCache.limpiar();
          void this.realtimeService.cerrar();
          return;
        }

        if (evento === 'SIGNED_IN') {
          console.log('[App] sesión iniciada: se relee el perfil');

          // IMPORTANTE: el trabajo se saca del callback con un setTimeout.
          // Llamar a métodos de `auth` (como getSession) DENTRO de
          // onAuthStateChange es una reentrancia conocida de supabase-js: el
          // cliente se bloquea a sí mismo mientras emite el evento y la
          // promesa nunca resuelve. Con el setTimeout la notificación ya
          // terminó de emitirse y consultar la sesión es seguro.
          setTimeout(() => {
            void this.perfilCache.perfil(true);
          }, 0);
        }
      });
    } catch (e) {
      console.warn('No se pudo escuchar el cambio de sesión:', e);
    }
  }

  /**
   * Revisa los permisos cada vez que la app vuelve al primer plano.
   *
   * Esto NO es paranoia: Android revoca permisos solo. En Android 13+ si el
   * usuario descarta el diálogo de notificaciones dos veces, el sistema hace
   * "auto-reset" y lo apaga; y Android 12+ apaga permisos de apps que no se
   * usan hace meses. Sin esta relectura la app sigue creyendo que tiene todo
   * activo y el SOS deja de sonar sin ninguna señal visible.
   */
  private revisarAlVolver(): void {
    if (!Capacitor.isNativePlatform()) return;

    let ultimoEstado = '';

    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;

      void (async () => {
        try {
          const lista = await this.permisosService.verificarTodos();
          const apagados = lista
            .filter((p) => p.estado === 'denegado' || p.estado === 'bloqueado')
            .map((p) => p.id)
            .sort()
            .join(',');

          // Sólo se avisa cuando algo CAMBIÓ: si no, se revisaría en cada
          // vuelta a la app sin motivo.
          if (apagados !== ultimoEstado) {
            if (ultimoEstado) {
              console.log('[App] cambiaron los permisos. Apagados ahora:', apagados || 'ninguno');
            }
            ultimoEstado = apagados;
          }
        } catch (e) {
          console.warn('[App] no se pudieron releer los permisos:', e);
        }
      })();
    });
  }
}

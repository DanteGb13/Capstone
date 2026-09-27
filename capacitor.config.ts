import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'SiempreCerca',
  webDir: 'www',
  plugins: {
    LocalNotifications: {
      iconColor: '#7715c7',
      sound: 'alarmmelodia.wav'
    },
    /**
     * El splash nativo se oculta solo (launchAutoHide por defecto en true).
     *
     * Se probó atarlo a la capa de arranque de la app (launchAutoHide: false +
     * hide() manual) y fue un error: si la navegación o el temporizador
     * fallaban, la pantalla quedaba pegada. El comportamiento por defecto no
     * puede quedar colgado porque no depende de nada de nuestro lado.
     *
     * La capa de arranque de la app (app.component.html) es la que cubre el
     * hueco entre que termina el splash nativo y que hay pantalla, y esa se
     * va sola con CSS.
     */
    SplashScreen: {
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: '#7734d9',
      androidSplashResourceName: 'ic_splash_marca',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false
    }
  }
};

export default config;

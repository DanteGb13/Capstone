import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'SiempreCerca',
  webDir: 'www',

  /**
   * Apaga el volcado de datos de las llamadas a plugins, para que el access
   * token y el refresh token no queden escritos en el log del sistema.
   *
   * Con el logging activo, Capacitor escribe en `logcat` los argumentos
   * COMPLETOS de cada llamada nativa a plugin, no sólo el nombre del método
   * (Bridge.java: `", methodData: " + call.getData().toString()`). Una de esas
   * llamadas es la que guarda la sesión de Supabase para el servicio en segundo
   * plano, así que el access token, el refresh token y el correo del usuario
   * quedan en texto plano en el log. Con eso, cualquiera con `adb logcat` sobre
   * un dispositivo con depuración USB puede leer la sesión y suplantar la
   * cuenta. No es una fuga de este código: ocurre aunque no haya un solo
   * `console.log` en la app.
   *
   * OJO con la clave: NO es `loggingEnabled`. Capacitor ignora ese campo y lee
   * `android.loggingBehavior` (CapConfig.java:290-304). Con el valor por defecto
   * `debug` queda en `isDebug`, o sea activo en cualquier build de depuración.
   * El valor que lo apaga de verdad es `none`.
   *
   * Para depurar se puede poner en `debug`, sabiendo que los tokens aparecerán
   * en el log mientras esté activo.
   */
  android: {
    loggingBehavior: 'none'
  },

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

# Capstone
App movil **SiempreCerca** (Ionic + Angular + Capacitor + Supabase).

## Requisitos

| Herramienta | Version |
|---|---|
| Node.js | 20 o superior |
| JDK | 21 (obligatorio, ver nota) |
| Android SDK | Platform 36 + Build-Tools + Platform-Tools |

> **Nota sobre el JDK:** Gradle no compila con Java 23 o superior. Falla con
> `BUG! exception in phase 'semantic analysis' ... Unsupported class file major
> version`, un error que no dice que el problema es el JDK. El JDK que trae
> Android Studio suele ser el mas nuevo, asi que **no** alcanza con usar ese.
>
> Cada quien instala el suyo. En Linux y macOS normalmente ya esta en el sistema.
> En Windows lo mas simple es un JDK 21 portable (Eclipse Temurin 21) descomprimido
> en `~/.local/jdk-21`: no se agrega al PATH, no queda instalado en el sistema y
> `npm run android` lo detecta solo.

## Instalar

```
npm install
```

## `google-services.json` (push notifications)

Va en `android/app/google-services.json`, que es donde el plugin de Google lo
busca. El archivo esta en `.gitignore`, asi que **no se sube al repositorio**:
cada quien descarga el suyo de Firebase con el paquete `io.ionic.starter`.

Si el archivo falta, el proyecto sigue compilando; solo quedan sin configurar
las notificaciones push. Plantilla del archivo: `android/app/google-services.json.example`.

## Correr en el celular

1. En el celular: Ajustes > Acerca del telefono, tocar 7 veces "Numero de
   compilacion" para activar las opciones de desarrollador.
2. Ajustes > Sistema > Opciones de desarrollador > **Depuracion USB** en ON.
3. Conectar el celular por USB y acceptar el dialogo "Permitir depuracion USB".
   Ojo: hay que buscar la app en la lista de dispositivos que sale en pantalla.

Con el celular conectado:

```
npm run android
```

Eso hace todo: compila la web, sincroniza Capacitor, instala la app en el
telefono y la abre. Para cambiar de dispositivo o tener mas detalle:

```
npm run android -- --list
npm run android -- --target <dispositivo-id>
```

Para generar el APK sin instalarlo (por ejemplo para pasarlo a otro telefono):

```
npm run android:apk
```

Queda en `android/app/build/outputs/apk/debug/app-debug.apk`. Es un APK de
depuracion: se puede instalar a mano, pero Android va a pedir permitir
"fuentes desconocidas" y la app figura como de pruebas.

## Correr con Android Studio

```
npx cap sync android
npx cap open android
```

En Android Studio, el JDK del build se cambia en **Settings > Build, Execution,
Deployment > Build Tools > Gradle > Gradle JDK**: tiene que ser un **JDK 21**.
Si se deja el JDK de Android Studio (25) el build falla con el error de
`Unsupported class file major version` de arriba.

El archivo `android/local.properties` ya apunta al SDK de esta maquina y no se
sube a git; Android Studio lo regenera solo si hace falta.

## Antes de commitear

Si se toco algo de la capa nativa (`android/**` o `capacitor.config.ts`),
revisar que `google-services.json` siga ignorado:

```
git status
```

`android/app/google-services.json` nunca debe aparecer como archivo nuevo.
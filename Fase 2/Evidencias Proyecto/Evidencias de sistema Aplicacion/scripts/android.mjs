#!/usr/bin/env node
/**
 * SiempreCerca - compila, instala y abre la app en un celular Android.
 *
 *   npm run android       -> build web + sync + compilar + instalar y abrir
 *   npm run android:apk   -> solo genera el APK (no instala)
 *
 * Funciona en Linux, macOS y Windows. No requiere Android Studio.
 * Requiere: Node, JDK 21 y Android SDK (Platform 36 + Build-Tools + Platform-Tools).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const win = platform() === 'win32';
const modo = process.argv[2] === 'apk' ? 'apk' : 'run';
const extra = process.argv.slice(3);

// Los plugins de Capacitor 8 compilan con Java 21.

/**
 * ¿La carpeta es un JDK usable?
 *
 * No basta con que exista `java`: hay instalaciones que sólo traen el runtime
 * (un JRE) y ésos NO sirven, porque no traen `javac`. Gradle usa el JAVA_HOME
 * tal cual, así que apuntarle a un JRE termina en:
 *
 *   Toolchain installation '...jre-17...' does not provide the required
 *   capabilities: [JAVA_COMPILER]
 *
 * un error que no dice que el problema es el propio JAVA_HOME.
 */
const esJdk = (dir) =>
  !!dir && (existsSync(join(dir, 'bin', 'javac')) || existsSync(join(dir, 'bin', 'javac.exe')));

const jdkPortable = join(homedir(), '.local', 'jdk-21');

// Candidatos en orden de preferencia: el JDK portable del proyecto, luego los
// lugares donde un JDK queda instalado por defecto en cada sistema.
const candidatosJdk = [
  jdkPortable,
  join(homedir(), '.jdks'),
  '/usr/lib/jvm/java-21-openjdk',
  '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
];

// En Windows un JDK también suele quedar en "Program Files", y ahí la máquina
// puede tener un JRE viejo en JAVA_HOME mientras el JDK de verdad está al lado.
if (win) {
  for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft']) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base)) {
      candidatosJdk.push(join(base, dir));
    }
  }
}

// Si JAVA_HOME ya apunta a algo CON javac se respeta: puede ser un JDK
// instalado a propósito por el equipo de desarrollo.
let javaHomeValido = process.env.JAVA_HOME && esJdk(process.env.JAVA_HOME);

if (!javaHomeValido) {
  if (process.env.JAVA_HOME) {
    console.log(
      `\nAVISO: JAVA_HOME apunta a ${process.env.JAVA_HOME}, que NO trae javac (es un JRE).\n` +
      '       Gradle lo usaría igual y la compilación fallaría con\n' +
      '       "does not provide the required capabilities: [JAVA_COMPILER]".\n' +
      '       Se busca un JDK 21 en su lugar.\n'
    );
  }

  const elegido = candidatosJdk.find(esJdk);
  if (elegido) {
    process.env.JAVA_HOME = elegido;
    javaHomeValido = true;
  }
}

// Gradle no puede compilar con Java 23 o superior: su Groovy lee las clases del
// JDK y revienta con "Unsupported class file major version" sin decir cuál. Como
// el JDK que trae Android Studio suele ser el mas nuevo, se avisa aqui para no
// perder tiempo descifrando ese error.
if (!javaHomeValido) {
  console.warn(
    '\nAVISO: no se encontro un JDK 21, asi que Gradle usara el del sistema y puede fallar\n' +
      `       con "Unsupported class file major version". Descarga uno en ${jdkPortable}\n` +
      '       (Eclipse Temurin 21) o exporta JAVA_HOME antes de correr este script.\n'
  );
} else {
  // El `bin` del JDK va primero en el PATH.
  //
  // JAVA_HOME ya lo respeta gradlew.bat, pero otras herramientas que se lanzan
  // durante el build buscan `java` en el PATH, y si ahí está el JRE se quedan
  // sin compilador igual.
  process.env.PATH = [join(process.env.JAVA_HOME, 'bin'), process.env.PATH].join(delimiter);

  console.log(`> JDK: ${process.env.JAVA_HOME}`);
}

// Android SDK: se respeta el que ya esté configurado en el sistema.
if (!process.env.ANDROID_HOME) {
  const candidatos = [
    join(homedir(), 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  ];
  const sdk = candidatos.find((p) => existsSync(p));
  if (sdk) {
    process.env.ANDROID_HOME = sdk;
    process.env.ANDROID_SDK_ROOT = sdk;
    process.env.PATH = [
      join(sdk, 'platform-tools'),
      join(sdk, 'cmdline-tools', 'latest', 'bin'),
      process.env.PATH ?? '',
    ].join(delimiter);
  }
}

const npm = win ? 'npm.cmd' : 'npm';
const npx = win ? 'npx.cmd' : 'npx';

function run(cmd, args, cwd = raiz) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: win,
  });
  if (r.error) {
    console.error(`\nNo se pudo ejecutar "${cmd}": ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(npm, ['run', 'build']);
run(npx, ['cap', 'sync', 'android']);

if (modo === 'apk') {
  const gradlew = win ? 'gradlew.bat' : './gradlew';
  run(gradlew, ['assembleDebug', ...extra], join(raiz, 'android'));
  console.log('\nAPK generado en: android/app/build/outputs/apk/debug/app-debug.apk');
} else {
  run(npx, ['cap', 'run', 'android', ...extra]);
}

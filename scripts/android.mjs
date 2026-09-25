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
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const win = platform() === 'win32';
const modo = process.argv[2] === 'apk' ? 'apk' : 'run';
const extra = process.argv.slice(3);

// Los plugins de Capacitor 8 compilan con Java 21.
const jdkPortable = join(homedir(), '.local', 'jdk-21');
if (existsSync(join(jdkPortable, 'bin', 'java'))) {
  process.env.JAVA_HOME = jdkPortable;
} else if (existsSync('/usr/lib/jvm/java-21-openjdk')) {
  process.env.JAVA_HOME = '/usr/lib/jvm/java-21-openjdk';
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

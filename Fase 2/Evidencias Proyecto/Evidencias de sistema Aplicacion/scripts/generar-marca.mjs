/**
 * Genera los assets de marca (logo, íconos, splash) a partir de
 * resources/marca-original.png, que es el maestro del ícono de la app.
 *
 * Por qué NO se lee resources/icon.png: este script también lo escribe, así que
 * al segundo CORRIDO leería su propia salida (ya sin píxeles transparentes) y
 * no encontraría ninguna figura. El maestro nunca se sobrescribe.
 *
 * Por qué extraer la figura en vez de dibujarla en SVG: así el logo de la app
 * es EXACTAMENTE el mismo dibujo que el ícono del launcher, sin aproximaciones.
 *
 * Dato clave del original: el ícono es un cuadrado morado con gradiente y la
 * figura (corazón + dos personas) RECORTADA en transparente. No es blanca. Por
 * eso el logo dentro de la app siempre necesita su fondo morado: sin él, la
 * figura desaparece.
 *
 * Uso: node scripts/generar-marca.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAESTRO = join(RAIZ, 'resources', 'marca-original.png');
const RECURSOS = join(RAIZ, 'resources');
const ASSETS = join(RAIZ, 'src', 'assets', 'logo');

/** Gradiente muestreado píxel a píxel del ícono (arriba-izq -> abajo-der). */
const GRADIENTE = { desde: [0x81, 0x3e, 0xdc], hacia: [0x6c, 0x2d, 0xd4] };

/**
 * Proporción del lienzo del adaptive icon que ocupa la figura.
 *
 * El lienzo de un adaptive icon es 108x108dp pero Android solo muestra los
 * 72dp centrales, y la zona segura es un círculo de 66dp. Para que la figura
 * quede a ~48dp dentro de los 72 visibles (el tamaño de un ícono normal) hace
 * falta 0.45 del lienzo completo: 0.45 * 72dp = 32dp... es decir, el cálculo
 * es 48/72 * (72/108) = 0.44. Con 0.45 las puntas del corazón no se recortan
 * en ningún launcher circular.
 */
const OCUPACION_FIGURA = 0.45;

/** Proporción del ícono clásico que ocupa la figura. */
const OCUPACION_ICONO = 0.72;

// =============================================================================
// PNG
// =============================================================================

/** Lee un PNG RGBA de 8 bits, sin interlazar. */
function leerPng(ruta) {
  const buf = readFileSync(ruta);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG: ' + ruta);

  let pos = 8;
  let ancho = 0, alto = 0, profundidad = 0, tipoColor = 0;
  const idat = [];

  while (pos < buf.length) {
    const largo = buf.readUInt32BE(pos);
    const tipo = buf.toString('ascii', pos + 4, pos + 8);
    const datos = buf.subarray(pos + 8, pos + 8 + largo);

    if (tipo === 'IHDR') {
      if (datos[12] !== 0) throw new Error('PNG entrelazado no soportado');
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      profundidad = datos[8];
      tipoColor = datos[9];
    } else if (tipo === 'IDAT') {
      idat.push(datos);
    } else if (tipo === 'IEND') {
      break;
    }
    pos += 12 + largo;
  }

  if (profundidad !== 8) throw new Error('Solo PNG de 8 bits por canal');
  const canales = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipoColor];
  if (!canales) throw new Error('Tipo de color PNG no soportado: ' + tipoColor);

  const crudo = inflateSync(Buffer.concat(idat));
  const bpp = canales;
  const stride = ancho * bpp;
  const out = Buffer.alloc(alto * stride);

  let p = 0;
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[p++];
    const fila = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const val = crudo[p++];
      const a = x >= bpp ? fila[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v;
      switch (filtro) {
        case 0: v = val; break;
        case 1: v = val + a; break;
        case 2: v = val + b; break;
        case 3: v = val + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('Filtro PNG desconocido: ' + filtro);
      }
      fila[x] = v & 0xff;
    }
  }

  const rgba = Buffer.alloc(ancho * alto * 4, 255);
  for (let i = 0; i < ancho * alto; i++) {
    const s = i * bpp, d = i * 4;
    if (canales === 1 || canales === 2) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s];
      if (canales === 2) rgba[d + 3] = out[s + 1];
    } else {
      rgba[d] = out[s];
      rgba[d + 1] = out[s + 1];
      rgba[d + 2] = out[s + 2];
      if (canales === 4) rgba[d + 3] = out[s + 3];
    }
  }
  return { ancho, alto, datos: rgba };
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function escribirPng(ruta, ancho, alto, rgba) {
  const bloque = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo), 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;  // bits por canal
  ihdr[9] = 6;  // RGBA

  // Filtro "None": estos assets son planos, no compensa filtrar.
  const filas = Buffer.alloc(alto * (ancho * 4 + 1));
  for (let y = 0; y < alto; y++) {
    const base = y * ancho * 4;
    filas[y * (ancho * 4 + 1)] = 0;
    rgba.copy(filas, y * (ancho * 4 + 1) + 1, base, base + ancho * 4);
  }

  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(filas, { level: 9 })),
    bloque('IEND', Buffer.alloc(0))
  ]));
}

// =============================================================================
// Lienzo
// =============================================================================

const crear = (n) => ({ ancho: n, alto: n, datos: Buffer.alloc(n * n * 4, 0) });

const get = (c, x, y) => {
  const i = (y * c.ancho + x) * 4;
  return [c.datos[i], c.datos[i + 1], c.datos[i + 2], c.datos[i + 3]];
};

function escribirPx(c, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= c.ancho || y >= c.alto || a <= 0) return;
  const i = (y * c.ancho + x) * 4;
  c.datos[i] = r; c.datos[i + 1] = g; c.datos[i + 2] = b; c.datos[i + 3] = a;
}

/** Mezcla alfa-sobre: para los bordes del logo escalado. */
function encima(c, x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= c.ancho || y >= c.alto) return;
  const i = (y * c.ancho + x) * 4;
  const sa = a / 255, da = c.datos[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) { c.datos[i + 3] = 0; return; }
  c.datos[i] = Math.round((r * sa + c.datos[i] * da * (1 - sa)) / oa);
  c.datos[i + 1] = Math.round((g * sa + c.datos[i + 1] * da * (1 - sa)) / oa);
  c.datos[i + 2] = Math.round((b * sa + c.datos[i + 2] * da * (1 - sa)) / oa);
  c.datos[i + 3] = Math.round(oa * 255);
}

/** Rellena el lienzo con el gradiente de marca. */
function fondoGradiente(c) {
  for (let y = 0; y < c.alto; y++) {
    const t = y / (c.alto - 1);
    const r = Math.round(GRADIENTE.desde[0] + (GRADIENTE.hacia[0] - GRADIENTE.desde[0]) * t);
    const g = Math.round(GRADIENTE.desde[1] + (GRADIENTE.hacia[1] - GRADIENTE.desde[1]) * t);
    const b = Math.round(GRADIENTE.desde[2] + (GRADIENTE.hacia[2] - GRADIENTE.desde[2]) * t);
    for (let x = 0; x < c.ancho; x++) escribirPx(c, x, y, r, g, b, 255);
  }
}

/**
 * Cuadrado redondeado (el del ícono original).
 *
 * MULTIPLICA el alfa existente en vez de reemplazarlo: si lo reemplazara,
 * borraría el recorte de la figura que se aplicó antes y el ícono quedaría
 * morado macizo sin corazón.
 */
function redondear(c, radio) {
  for (let y = 0; y < c.alto; y++) {
    for (let x = 0; x < c.ancho; x++) {
      const dx = Math.min(x, c.ancho - 1 - x);
      const dy = Math.min(y, c.alto - 1 - y);
      let a = 255;
      if (dx < radio && dy < radio) {
        const d = Math.hypot(radio - dx, radio - dy);
        a = Math.round(Math.min(255, Math.max(0, radio + 0.5 - d) * 255));
      }
      const i = (y * c.ancho + x) * 4;
      c.datos[i + 3] = Math.round((c.datos[i + 3] * a) / 255);
    }
  }
}

// =============================================================================
// Extracción de la figura desde el ícono original
// =============================================================================

const origen = leerPng(MAESTRO);
console.log(`Maestro: ${MAESTRO.replace(RAIZ + '\\', '')}  ${origen.ancho}x${origen.alto}`);

// La figura es lo transparente DENTRO del cuadrado; hay que ignorar el exterior
// del redondeo, que también es transparente.
const margen = Math.round(origen.ancho * 0.18);
let fx0 = Infinity, fx1 = -1, fy0 = Infinity, fy1 = -1;
for (let y = margen; y < origen.alto - margen; y++) {
  for (let x = margen; x < origen.ancho - margen; x++) {
    if (origen.datos[(y * origen.ancho + x) * 4 + 3] < 128) {
      if (x < fx0) fx0 = x;
      if (x > fx1) fx1 = x;
      if (y < fy0) fy0 = y;
      if (y > fy1) fy1 = y;
    }
  }
}
const figW = fx1 - fx0 + 1;
const figH = fy1 - fy0 + 1;
const lado = Math.max(figW, figH);
console.log(`Figura: ${figW}x${figH} en (${fx0},${fy0})`);

/**
 * Muestrea la máscara de la FIGURA (el recorte) con filtro box 3x3, que es lo
 * que suaviza el borde al escalar.
 *
 * OJO con la inversión: en el ícono original la figura es lo TRANSPARENTE, así
 * que la cobertura de la figura es 1 - (alfa/255). Devolver el alfa directo
 * pinta el morado en vez del recorte.
 *
 * Solo se muestrea dentro de la caja de la figura: si se leyera el lienzo
 * completo, el exterior del cuadrado redondeado (también transparente) se
 * contaría como figura y la logo quedaría casi toda blanca.
 */
function mascaraFigura(c, ocupacion) {
  const escala = (c.ancho * ocupacion) / lado;
  const dx0 = (c.ancho - figW * escala) / 2 - fx0 * escala;
  const dy0 = (c.alto - figH * escala) / 2 - fy0 * escala;
  const m = new Float32Array(c.ancho * c.alto);

  for (let y = 0; y < c.alto; y++) {
    for (let x = 0; x < c.ancho; x++) {
      const ox = Math.floor((x - dx0) / escala);
      const oy = Math.floor((y - dy0) / escala);
      if (ox < fx0 - 1 || ox > fx1 + 1 || oy < fy0 - 1 || oy > fy1 + 1) continue;

      let suma = 0, n = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = ox + sx, py = oy + sy;
          if (px < 0 || py < 0 || px >= origen.ancho || py >= origen.alto) continue;
          suma += origen.datos[(py * origen.ancho + px) * 4 + 3];
          n++;
        }
      }
      if (n) m[y * c.ancho + x] = Math.max(0, 1 - suma / n / 255);
    }
  }
  return m;
}

/** Figura blanca sobre transparente (capa foreground / logo suelto). */
function figuraBlanca(c, ocupacion = OCUPACION_FIGURA) {
  const m = mascaraFigura(c, ocupacion);
  for (let y = 0; y < c.alto; y++) {
    for (let x = 0; x < c.ancho; x++) {
      const v = m[y * c.ancho + x];
      if (v > 0) escribirPx(c, x, y, 255, 255, 255, Math.round(255 * v));
    }
  }
}

/** Cuadrado con gradiente y la figura recortada (ícono clásico). */
function iconoClasico(c, ocupacion = OCUPACION_ICONO) {
  fondoGradiente(c);
  const m = mascaraFigura(c, ocupacion);
  for (let i = 0; i < m.length; i++) {
    if (m[i] > 0) c.datos[i * 4 + 3] = Math.round(c.datos[i * 4 + 3] * (1 - m[i]));
  }
  redondear(c, Math.round(c.ancho * 0.235));
}

// =============================================================================
// Generación
// =============================================================================

const escribe = (ruta, c) => {
  escribirPng(ruta, c.ancho, c.alto, c.datos);
  console.log(`  ${ruta.replace(RAIZ + '\\', '')}  ${(statSync(ruta).size / 1024).toFixed(1)} KB`);
};

console.log('\nAdaptive icon (Android):');
{
  const c = crear(432);
  figuraBlanca(c);
  escribe(join(RECURSOS, 'icon-foreground.png'), c);
}
{
  const c = crear(432);
  fondoGradiente(c);
  escribe(join(RECURSOS, 'icon-background.png'), c);
}

console.log('\nLauncher clásico:');
{
  const c = crear(1024);
  iconoClasico(c);
  escribe(join(RECURSOS, 'icon.png'), c);
}

console.log('\nLogo para la app:');
mkdirSync(ASSETS, { recursive: true });
for (const t of [512, 256, 128, 64]) {
  const c = crear(t);
  iconoClasico(c);
  escribe(join(ASSETS, `logo-${t}.png`), c);
}
for (const t of [256, 128]) {
  const c = crear(t);
  figuraBlanca(c);
  escribe(join(ASSETS, `logo-figura-${t}.png`), c);
}
{
  // Reemplaza el favicon de 346 KB por uno de 64 px.
  const c = crear(64);
  iconoClasico(c);
  escribe(join(ASSETS, 'favicon.png'), c);
}

console.log('\nIconos web (PWA):');
const ICONOS_WEB = [48, 72, 96, 128, 192, 256, 512];
mkdirSync(join(RAIZ, 'src', 'assets', 'icons'), { recursive: true });
for (const t of ICONOS_WEB) {
  const c = crear(t);
  iconoClasico(c);
  escribe(join(RAIZ, 'src', 'assets', 'icons', `icon-${t}.png`), c);
}

console.log('\nSplash:');
function splash(destino) {
  fondoGradiente(destino);
  const t = Math.round(destino.ancho * 0.30);
  const fig = crear(t);
  figuraBlanca(fig);
  const ox = Math.round((destino.ancho - t) / 2);
  const oy = Math.round((destino.alto - t) / 2);
  for (let y = 0; y < t; y++) {
    for (let x = 0; x < t; x++) {
      const [r, g, b, a] = get(fig, x, y);
      if (a) encima(destino, ox + x, oy + y, r, g, b, a);
    }
  }
}
{
  const c = crear(2732);
  splash(c);
  escribe(join(RECURSOS, 'splash.png'), c);
}
{
  const c = crear(1284);
  splash(c);
  escribe(join(RECURSOS, 'splash-dark.png'), c);
}

console.log('\nRegenerando recursos de Android...');

/**
 * Copia la figura blanca al drawable que usa la pantalla de arranque.
 *
 * Se copia desde el asset ya generado en vez de exportar otra vez para no
 * tener dos versiones del mismo dibujo: si se regenera el asset y se olvida
 * esta copia, el splash queda con la figura de la corrida anterior (pasó:
 * la figura estaba al 56% mientras el ícono ya iba al 45%).
 */
const FIGURA_ANDROID = join(
  RAIZ, 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash_figura.png'
);
if (existsSync(join(RAIZ, 'android'))) {
  mkdirSync(dirname(FIGURA_ANDROID), { recursive: true });
  writeFileSync(FIGURA_ANDROID, readFileSync(join(ASSETS, 'logo-figura-256.png')));
  console.log('  copiado: android/.../drawable/splash_figura.png');
}

const { execFileSync } = await import('node:child_process');
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(NPX, ['capacitor-assets', 'generate', '--android'], {
  cwd: RAIZ,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

/**
 * capacitor-assets mete un <inset> del 16.7% dentro de las DOS capas del
 * adaptive icon. En el fondo está mal: el fondo va a sangre y con el inset
 * quedaría un marco transparente alrededor del ícono. En la figura tampoco
 * hace falta, porque el tamaño ya se controla con OCUPACION_FIGURA.
 *
 * El <inset> va anidado dentro de <background>/<foreground>, así que hay que
 * colapsar el elemento padre completo, no solo borrar la etiqueta.
 */
for (const nombre of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const ruta = join(RAIZ, 'android', 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26', nombre);
  if (!existsSync(ruta)) continue;

  const original = readFileSync(ruta, 'utf8');
  const limpio = original.replace(
    /<(background|foreground)>\s*<inset\b[^>]*\/>\s*<\/\1>/g,
    (_todo, capa, drawable) => {
      const d = original.match(new RegExp(`<${capa}>\\s*<inset\\b[^>]*android:drawable="([^"]+)"`))?.[1];
      return d ? `<${capa} android:drawable="${d}" />` : `<${capa} />`;
    }
  );

  if (limpio === original) {
    console.log(`  sin cambios: ${nombre} (no había <inset>)`);
    continue;
  }
  writeFileSync(ruta, limpio);
  console.log(`  parcheado: ${ruta.replace(RAIZ + '\\', '')}`);
}

console.log('\nListo. Reconstruye la app: npm run android');

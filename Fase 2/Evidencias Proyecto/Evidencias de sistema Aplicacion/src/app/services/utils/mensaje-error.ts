/**
 * Traduce errores crudos (Postgres, Supabase Auth, red) a mensajes que una
 * persona normal entiende — y si es un dato repetido, DICE cuál es.
 *
 * Motivo: al guardar un RUT repetido se mostraba
 * "duplicate key value violates constraint usuario_rut_key", y después una
 * versión genérica que tampoco decía qué estaba repetido. Ningún error
 * técnico debe llegar a la vista, y el aviso tiene que nombrar el dato.
 *
 * Uso: `mensajeErrorApp(error, 'Mensaje por si no se reconoce.')`
 */

/** Dato repetido → frase que lo nombra. */
const COLUMNAS_REPETIDAS: Record<string, string> = {
  rut: 'Este RUT ya está en uso.',
  correo: 'Este correo ya está registrado.',
  email: 'Este correo ya está registrado.',
  telefono: 'Este teléfono ya está registrado.',
  id_usuario: 'Este usuario ya tiene un registro.',
  codigo: 'Este código ya está en uso.',
  id: ''
};

/**
 * Frases que ya salieron de este mismo traductor: si llegan de vuelta (por
 * ejemplo, el servicio traduce y la pantalla vuelve a traducir) no se tocan.
 */
const YA_TRADUCIDOS = [
  'Este RUT ya está en uso.',
  'Este correo ya está registrado.',
  'Este teléfono ya está registrado.',
  'Este usuario ya tiene un registro.',
  'Este código ya está en uso.',
  'Ese dato ya está registrado. Usa otro distinto.',
  'No hay conexión a internet. Revisa tu red e inténtalo de nuevo.',
  'Correo o contraseña incorrectos.',
  'Confirma tu correo electrónico antes de entrar.',
  'No tienes permiso para hacer esto.',
  'Demasiados intentos. Espera un minuto y prueba de nuevo.'
];

/** Palabras que marcan un mensaje ya humano (en español, nuestro). */
const PARECE_HUMANO =
  /[áéíóúñ¿]|\b(el|la|los|las|un|una|de|del|que|no|ya|ese|esta|este|está|están|existe|registro|datos|dato|correo|rut|teléfono|sesión|permiso|contraseña|revisa|inténtalo|intenta|faltan|confirma|pudo|puede|guardar|crear|actualizar|completar|usuario|cuenta|perfil|dirección|vinculación|nombre|código|uso|registrado|conexión|válido|permitido|correctamente)\b/i;

/** Patrones que delatan un mensaje técnico que NO debe mostrarse. */
const PARECE_TECNICO =
  /[a-z]+_[a-z_]+|constraint|duplicate|unique|violates|relation |column |row-level|jwt|sqlstate|syntax|insert into|update |select |fetch|network|socket|credentials|password should|email not confirmed|rate limit|already exists|failed to|error creating|error updating|error deleting|permission denied/i;

export function mensajeErrorApp(
  error: unknown,
  porDefecto = 'Algo salió mal. Inténtalo de nuevo.'
): string {
  const bruto =
    typeof error === 'string'
      ? error
      : ((error as { message?: string })?.message ?? '');
  const m = bruto.toLowerCase();

  // Ya viene traducido de una pasada anterior: no se vuelve a tocar.
  if (YA_TRADUCIDOS.includes(bruto)) {
    return bruto;
  }

  // --- Dato repetido: decir CUÁL ---
  const repetido = datoRepetido(error, bruto);
  if (repetido) {
    return repetido;
  }

  // --- Correo ya existente (Supabase Auth) ---
  if (
    m.includes('user already registered') ||
    m.includes('user_already_exists') ||
    (m.includes('correo') && (m.includes('duplicate') || m.includes('ya está registrado')))
  ) {
    return 'Este correo ya está registrado.';
  }

  // --- Relaciones y campos ---
  if (m.includes('foreign key')) {
    return 'No se puede completar la operación porque tiene datos relacionados.';
  }
  if (m.includes('not-null') || m.includes('not null') || m.includes('null value')) {
    return 'Faltan datos obligatorios. Revisa el formulario.';
  }
  if (m.includes('check constraint')) {
    return 'Uno de los datos no cumple los requisitos permitidos.';
  }

  // --- Permisos ---
  if (
    m.includes('row-level security') ||
    m.includes('row level security') ||
    m.includes('permission denied') ||
    m.includes('not authorized')
  ) {
    return 'No tienes permiso para hacer esto.';
  }

  // --- Contraseña y acceso ---
  if (
    m.includes('password should be') ||
    m.includes('weak_password') ||
    m.includes('password must')
  ) {
    return 'La contraseña debe tener al menos 8 caracteres, una mayúscula, un número y un símbolo.';
  }
  if (m.includes('invalid login credentials') || m.includes('invalid_grant') || m.includes('invalid credentials')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (m.includes('email not confirmed')) {
    return 'Confirma tu correo electrónico antes de entrar.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Demasiados intentos. Espera un minuto y prueba de nuevo.';
  }

  // --- Red ---
  if (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('fetch failed') ||
    m.includes('load failed') ||
    m.includes('socket hang up') ||
    m.includes('network')
  ) {
    return 'No hay conexión a internet. Revisa tu red e inténtalo de nuevo.';
  }

  // Mensaje nuestro o ya entendible: se muestra tal cual.
  if (PARECE_HUMANO.test(bruto) && !PARECE_TECNICO.test(bruto)) {
    return bruto;
  }

  // Técnico no reconocido: jamás se muestra crudo.
  return porDefecto;
}

/**
 * Si el error es un "dato repetido", devuelve la frase que nombra el dato.
 * Se fija en dos lados:
 *  - `details`: Postgres escribe `Key (rut)=(12345678-9) already exists.`
 *  - el nombre del constraint: `unique constraint "usuario_rut_key"`
 * y traduce la columna a algo humano ("Este RUT ya está en uso.").
 */
function datoRepetido(error: unknown, bruto: string): string | null {
  const e = error as { details?: string; hint?: string } | null;
  const texto = [e?.details, e?.hint, bruto].filter(Boolean).join(' ');

  // Sólo si el error ES de dato repetido: un "foreign key constraint"
  // también trae `constraint "..."`, pero no significa lo mismo.
  const esRepetido =
    /already exists/i.test(texto) ||
    /duplicate key|unique constraint/i.test(bruto);
  if (!esRepetido) {
    return null;
  }

  // Key (rut)=(…) already exists.
  const colDetalle = /Key \(([^)]+)\)=/i.exec(texto)?.[1]?.trim().toLowerCase();

  // unique constraint "usuario_rut_key"
  const constraint = /constraint "([^"]+)"/i.exec(bruto)?.[1] ?? '';
  const colConstraint = columnaDesdeConstraint(constraint);

  const col = colDetalle || colConstraint;
  if (!col) {
    if (/duplicate key|unique constraint/i.test(bruto)) {
      return 'Ese dato ya está registrado. Usa otro distinto.';
    }
    return null;
  }

  if (col === 'id') {
    return 'Ese registro ya existe.';
  }

  const frase = COLUMNAS_REPETIDAS[col];
  if (frase) {
    return frase;
  }

  // Columna desconocida: se nombra igual para que el aviso no quede vacío.
  return `Ya existe un registro con ese ${col}.`;
}

/**
 * `usuario_rut_key` → `rut`; `cuidador_id_usuario_key` → `id_usuario`.
 * Se quita el `_key` final y el prefijo de la tabla si la columna no se
 * reconoce sin él.
 */
function columnaDesdeConstraint(constraint: string): string {
  const base = constraint.replace(/_key$/, '').toLowerCase();
  if (!base) return '';
  if (COLUMNAS_REPETIDAS[base] !== undefined) return base;
  const sinTabla = base.includes('_') ? base.slice(base.indexOf('_') + 1) : base;
  if (COLUMNAS_REPETIDAS[sinTabla] !== undefined) return sinTabla;
  return sinTabla || base;
}

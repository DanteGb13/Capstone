/**
 * Utilidades de validación y formateo para autenticación y registro
 */

/**
 * Valida nombres y apellidos: solo letras (incluyendo acentos y ñ/ü) y espacios.
 * No permite números ni caracteres especiales.
 */
export function validarNombreOApellido(texto: string): boolean {
  if (!texto) return false;
  const limpio = texto.trim();
  if (limpio.length < 2) return false;
  // Letras con o sin tilde, ñ, ü, mayúsculas, minúsculas y espacios simples
  const regex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/;
  return regex.test(limpio);
}

/**
 * Valida formato estándar de correo electrónico.
 */
export function validarEmail(correo: string): boolean {
  if (!correo) return false;
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(correo.trim());
}

/**
 * Valida contraseña amigable (mínimo 6 caracteres y al menos un número).
 */
export function validarPassword(password: string): { valida: boolean; mensaje?: string } {
  if (!password) {
    return { valida: false, mensaje: 'La contraseña es requerida.' };
  }
  if (password.length < 8) {
    return { valida: false, mensaje: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (!/\d/.test(password)) {
    return { valida: false, mensaje: 'La contraseña debe incluir al menos un número.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valida: false, mensaje: 'La contraseña debe incluir al menos una letra minúscula.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valida: false, mensaje: 'La contraseña debe incluir al menos una letra mayúscula.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valida: false, mensaje: 'La contraseña debe incluir al menos un símbolo.' };
  }
  return { valida: true };
}

/**
 * Valida un número telefónico chileno:
 * Debe tener 9 dígitos numéricos (por ej. empezando con 9 para móviles: 9XXXXXXXX)
 * o con prefijo +569 / 569.
 */
export function validarTelefonoChileno(telefono: string): boolean {
  if (!telefono) return false;
  // Eliminar espacios, guiones y signos de más
  const limpio = telefono.replace(/[\s\-\+\(\)]/g, '');
  
  // Si empieza con 569 y tiene 11 dígitos
  if (/^569\d{8}$/.test(limpio)) {
    return true;
  }
  // Si tiene 9 dígitos y empieza con 9
  if (/^9\d{8}$/.test(limpio)) {
    return true;
  }
  return false;
}

/**
 * Formatea un número de teléfono a formato visual chileno: +56 9 1234 5678
 */
export function formatearTelefonoChileno(telefono: string): string {
  if (!telefono) return '';
  const limpio = telefono.replace(/\D/g, '');
  let nueveDigitos = limpio;
  if (limpio.startsWith('56') && limpio.length >= 11) {
    nueveDigitos = limpio.substring(2);
  }
  if (nueveDigitos.length === 9) {
    return `+56 9 ${nueveDigitos.substring(1, 5)} ${nueveDigitos.substring(5)}`;
  }
  return telefono;
}

/**
 * Valida un RUT chileno calculando el dígito verificador (Módulo 11).
 */
export function validarRutChileno(rutCompleto: string): boolean {
  if (!rutCompleto) return false;
  // Limpiar puntos y guiones
  const valor = rutCompleto.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
  if (valor.length < 8 || valor.length > 9) return false;

  const cuerpo = valor.slice(0, -1);
  const dv = valor.slice(-1);

  if (!/^\d+$/.test(cuerpo)) return false;

  // Algoritmo Módulo 11
  let suma = 0;
  let multiplo = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i), 10) * multiplo;
    multiplo = multiplo < 7 ? multiplo + 1 : 2;
  }

  const dvEsperado = 11 - (suma % 11);
  let dvCalculado = '';

  if (dvEsperado === 11) {
    dvCalculado = '0';
  } else if (dvEsperado === 10) {
    dvCalculado = 'K';
  } else {
    dvCalculado = dvEsperado.toString();
  }

  return dvCalculado === dv;
}

/**
 * Formatea un RUT a XX.XXX.XXX-Y
 */
export function formatearRut(rut: string): string {
  if (!rut) return '';
  const limpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length === 0) return '';
  if (limpio.length === 1) return limpio;

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);

  // Formatear cuerpo con puntos
  let cuerpoFormateado = '';
  for (let i = cuerpo.length - 1, j = 0; i >= 0; i--, j++) {
    if (j > 0 && j % 3 === 0) {
      cuerpoFormateado = '.' + cuerpoFormateado;
    }
    cuerpoFormateado = cuerpo.charAt(i) + cuerpoFormateado;
  }

  return `${cuerpoFormateado}-${dv}`;
}

/**
 * Valida fecha de nacimiento (debe ser fecha válida en el pasado, no futura, edad razonable 0-120 años).
 */
export function validarFechaNacimiento(fechaStr: string): boolean {
  if (!fechaStr) return false;
  const fecha = new Date(fechaStr);
  if (isNaN(fecha.getTime())) return false;

  const hoy = new Date();
  if (fecha > hoy) return false;

  const anio = fecha.getFullYear();
  const anioActual = hoy.getFullYear();
  if (anio < anioActual - 120 || anio > anioActual) return false;

  return true;
}

/**
 * Valida campos de texto generales (ej: Dirección, Calle, Comuna).
 */
export function validarTextoBasico(texto: string, minLength: number = 2): boolean {
  if (!texto) return false;
  return texto.trim().length >= minLength;
}

/**
 * Marca de build.
 *
 * Sirve para verificar, desde la propia app, qué versión está instalada en el
 * teléfono. Pasó de creerse que había una corrección y estar probando un APK
 * viejo: los números de línea del log no coincidían con el código.
 *
 * Bumpar la fecha ANTES de compilar cuando haya cambios de comportamiento.
 */
export const VERSION_APP = '2026-09-27-b';
export const BUILD_APP = 'sincronizar-token';

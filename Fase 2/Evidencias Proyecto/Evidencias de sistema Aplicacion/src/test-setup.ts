// Polyfills for running unit tests under jsdom (the default Vitest environment).
// Ionic components such as ion-menu and ion-split-pane query `window.matchMedia`,
// which jsdom does not implement.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/**
 * `localStorage` en memoria para las pruebas.
 *
 * Node 22+ declara un `localStorage` experimental global que queda `undefined`
 * salvo que se arranque con `--localstorage-file`. Como es un global de Node,
 * gana sobre el `window.localStorage` que sí implementa jsdom, y queda
 * indefinido dentro del entorno de pruebas:
 *
 *   ExperimentalWarning: localStorage is not available because
 *   --localstorage-file was not provided.
 *
 * Varios servicios leen el almacen en su propio constructor (tamano de letra,
 * alarmas, filtro de color, voz), asi que sin esto `TestBed.inject(...)` falla
 * con "Cannot read properties of undefined (reading 'getItem')" antes de que la
 * prueba alcance a hacer nada.
 *
 * Se implementa la parte de `Storage` que usa la app: getItem, setItem,
 * removeItem, clear, key y length. Es un almacen nuevo por archivo de prueba,
 * igual que en un navegador, asi que un test no puede ver lo que guardo otro.
 */
function crearAlmacenEnMemoria(): Storage {
  const datos = new Map<string, string>();

  return {
    get length(): number {
      return datos.size;
    },
    key(indice: number): string | null {
      // La interfaz real devuelve las claves en orden de insercion, que es
      // justo el orden en que las recorre un Map.
      return [...datos.keys()][indice] ?? null;
    },
    getItem(clave: string): string | null {
      // La clave ausente devuelve null, no undefined: varios servicios hacen
      // `localStorage.getItem(k) || valorPorDefecto` y con undefined tambien
      // funcionaria, pero `null` es lo que garantiza el estandar.
      return datos.has(clave) ? datos.get(clave)! : null;
    },
    setItem(clave: string, valor: string): void {
      // El navegador convierte a texto: setItem(1, 2) guarda "1" -> "2".
      datos.set(String(clave), String(valor));
    },
    removeItem(clave: string): void {
      datos.delete(clave);
    },
    clear(): void {
      datos.clear();
    }
  } as Storage;
}

if (typeof localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: crearAlmacenEnMemoria(),
    writable: true,
    configurable: true
  });
}

if (typeof sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: crearAlmacenEnMemoria(),
    writable: true,
    configurable: true
  });
}
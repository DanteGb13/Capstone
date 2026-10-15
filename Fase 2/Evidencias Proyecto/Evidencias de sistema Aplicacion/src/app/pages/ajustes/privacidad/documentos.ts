/**
 * Los seis documentos de la sección de privacidad.
 *
 * Viven juntos en un solo archivo a propósito: la página índice los muestra y
 * cada página usa el número y el total para dejar claro en qué documento está.
 * Si mañana se agrega, quita o reordena un documento, se edita esta lista y
 * nada más: las rutas de los botones salen de acá.
 *
 * La primera entrada NO es la ruta `/privacidad`, porque esa es la del índice.
 * Por eso la sección 1 vive en `/privacidad-datos`.
 */
export interface DocumentoPrivacidad {
  numero: string;
  titulo: string;
  resumen: string;
  ruta: string;
}

export const DOCUMENTOS_PRIVACIDAD: DocumentoPrivacidad[] = [
  {
    numero: '1',
    titulo: 'Política de privacidad',
    resumen: 'Qué datos guarda la app, para qué los usa, con quién los comparte y hasta cuándo.',
    ruta: '/privacidad-datos'
  },
  {
    numero: '2',
    titulo: 'Términos y condiciones',
    resumen: 'Las reglas de uso: para qué sirve, qué se espera de cada persona y qué no se puede hacer con ella.',
    ruta: '/privacidad-terminos'
  },
  {
    numero: '3',
    titulo: 'Política de seguridad',
    resumen: 'Qué hace la app para proteger tu cuenta y tus datos, y qué se puede hacer si algo sale mal.',
    ruta: '/privacidad-seguridad'
  },
  {
    numero: '4',
    titulo: 'Estándares y buenas prácticas',
    resumen: 'Las normas ISO que se usan como lista de control al revisar el trabajo, y en qué se relaciona cada una.',
    ruta: '/privacidad-estandares'
  },
  {
    numero: '5',
    titulo: 'Tus derechos sobre tus datos',
    resumen: 'Qué puedes hacer tú, dentro de la app o escribiendo al equipo, y por qué importa.',
    ruta: '/privacidad-derechos'
  },
  {
    numero: '6',
    titulo: 'Contacto y fecha de actualización',
    resumen: 'A quién escribir, qué datos poner en el mensaje y cuándo se actualizó esta página.',
    ruta: '/privacidad-contacto'
  }
];

export const TOTAL_DOCUMENTOS = DOCUMENTOS_PRIVACIDAD.length;

/** Ruta de la página índice, a la que vuelve la flecha de cada documento. */
export const RUTA_INDICE_PRIVACIDAD = '/privacidad';

/**
 * Fecha de última actualización de los textos.
 *
 * No es una fecha escrita a mano: sale de `version.ts`, que ya se bumpea antes
 * de cada compilación. Así el documento no puede quedar diciendo "septiembre"
 * con la app ya publicada en octubre.
 */
export function formatearActualizacion(version: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(version);
  if (!partes) {
    return version;
  }

  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  return `${Number(partes[3])} de ${meses[Number(partes[2]) - 1]} de ${partes[1]}`;
}

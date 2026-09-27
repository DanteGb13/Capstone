import { PasoTutorial } from '../../components/tutorial-juego/tutorial-juego.component';

/** Tutorial del juego "Memoria": encontrar las parejas de dibujos. */
export const TUTORIAL_MEMORIA: PasoTutorial[] = [
  { icono: '👆', texto: 'Toca una tarjeta para ver su dibujo. Quedará boca arriba.' },
  { icono: '👆', texto: 'Toca otra tarjeta para buscar su pareja igual.' },
  { icono: '✅', texto: 'Si los dos dibujos son iguales, la pareja queda descubierta.' },
  { icono: '🔄', texto: 'Si no son iguales, se vuelven a tapar. Intenta recordar dónde estaban.' },
  { icono: '🏆', texto: 'Encuentra las 6 parejas para ganar.' }
];

/** Tutorial del juego "Rompecabeza": ordenar las piezas para armar la imagen. */
export const TUTORIAL_ROMPECABEZA: PasoTutorial[] = [
  { icono: '👀', texto: 'Mira la imagen de referencia: es la foto que debes armar.' },
  { icono: '👆', texto: 'Toca una pieza que esté junto al espacio vacío.' },
  { icono: '🧩', texto: 'La pieza se desliza sola hacia el espacio vacío.' },
  { icono: '🔁', texto: 'Repite hasta que las piezas queden en su lugar y se vea la imagen.' },
  { icono: '📸', texto: 'Si quieres, toca "Tu foto" para armarlo con una foto tuya.' }
];

/** Tutorial del juego "Tres en línea": hacer una línea de tres X. */
export const TUTORIAL_TRES_EN_LINEA: PasoTutorial[] = [
  { icono: '⚙️', texto: 'Elige la dificultad: Fácil, Medio o Difícil.' },
  { icono: '👆', texto: 'Toca un casillero libre para poner tu "X".' },
  { icono: '🎯', texto: 'Haz una línea de 3 "X" seguidas para ganar: en fila, columna o diagonal.' },
  { icono: '🤖', texto: 'La computadora juega con "O" después de tu turno.' },
  { icono: '🛡️', texto: 'Si la "O" puede formar una línea, ¡bloquéala antes!' }
];

/** Tutorial del juego "Sopa de letras": marcar las palabras escondidas. */
export const TUTORIAL_SOPA: PasoTutorial[] = [
  { icono: '📜', texto: 'Lee la lista de palabras que aparece abajo del tablero.' },
  { icono: '👆', texto: 'Apoya el dedo en la primera letra de la palabra.' },
  { icono: '➡️', texto: 'Desliza el dedo por las letras, una detrás de otra, en línea recta.' },
  { icono: '↘️', texto: 'Se vale de izquierda a derecha, de arriba a abajo o en diagonal.' },
  { icono: '🏆', texto: 'Cuando la palabra quede marcada, busca la siguiente. ¡Encuéntralas todas!' }
];

/** Tutorial del juego "Memoria de secuencias": repetir el orden de las luces. */
export const TUTORIAL_SECUENCIAS: PasoTutorial[] = [
  { icono: '▶️', texto: 'Toca "Comenzar" para que el juego encienda las luces.' },
  { icono: '👀', texto: 'Observa las luces que se encienden, una por una.' },
  { icono: '🧠', texto: 'Recuerda bien el orden exacto en que se encendieron.' },
  { icono: '👆', texto: 'Toca los botones de colores en el mismo orden que viste las luces.' },
  { icono: '📈', texto: 'Si aciertas, la secuencia se hace más larga. ¡Cada vez más difícil!' }
];
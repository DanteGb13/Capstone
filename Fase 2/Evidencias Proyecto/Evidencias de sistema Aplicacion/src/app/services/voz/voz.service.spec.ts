import { TestBed } from '@angular/core/testing';
import { VozService } from './voz.service';

describe('VozService', () => {

  let service: VozService;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    TestBed.configureTestingModule({});
    service = TestBed.inject(VozService);
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  /**
   * Monta un HTML, simula un toque y devuelve lo que la voz habría dicho.
   *
   * Se prueba por comportamiento y no llamando al método privado: `decir` no
   * hace nada en el navegador, así que una prueba directa no oiría nada y no
   * comprobaría nada.
   */
  function tocar(html: string, selector = 'div'): string {
    document.body.innerHTML = html;

    let dicho = '';
    (service as any).decir = (t: string) => {
      dicho = t;
    };

    const evento = new MouseEvent('click', { bubbles: true });
    document.querySelector(selector)!.dispatchEvent(evento);
    return dicho;
  }

  describe('ajuste', () => {
    it('arranca apagada', () => {
      expect(service.activo()).toBe(false);
    });

    it('el resumen dice Desactivada cuando está apagada', () => {
      expect(service.resumen()).toBe('Desactivada');
    });
  });

  describe('resumen', () => {
    it('avisa cuando el sistema ya lee la pantalla', () => {
      service.activo.set(true);
      service.info.set({
        listo: true,
        motorListo: true,
        lectorExterno: true,
        velocidad: 1,
        tono: 1,
        idioma: 'español'
      });

      // Con TalkBack encendido, decir "Activada" haría creer que hay una sola
      // voz cuando en realidad hay dos superpuestas.
      expect(service.resumen()).toBe('Apagada: el sistema ya lee la pantalla');
      expect(service.chocaConLector()).toBe(true);
    });
  });

  /** La función de extraer etiquetas es privada a propósito: se prueba a
   *  través del comportamiento, que es como la usa el resto de la app. */
  function etiquetaDe(html: string, selector?: string): string {
    return tocar(html, selector);
  }

  describe('anunciar lo que se toca', () => {
    beforeEach(async () => {
      // Se enciende por la vía real y no tocando el signal: si el interruptor
      // se pone a true sin enganchar el escuchador, la voz queda muda y el
      // test pasaría sin comprobar nada.
      await service.establecer(true);
    });

    it('usa aria-label cuando existe', () => {
      const dicho = etiquetaDe(
        `<div><div aria-label="Tamaño de letra">
           <span>Tamaño de letra</span><span>Grande</span>
         </div></div>`,
        '[aria-label]'
      );
      // Sin aria-label esto sería "Tamaño de letraGrande".
      expect(dicho).toBe('Tamaño de letra');
    });

    it('sube desde el texto hasta el control que lo contiene', () => {
      const dicho = etiquetaDe(
        `<div><div class="tarjeta"><span>Contactos</span></div></div>`,
        'span'
      );
      expect(dicho).toBe('Contactos');
    });

    it('no se lee a sí mismo un párrafo largo', () => {
      const largo = 'a'.repeat(200);
      const dicho = etiquetaDe(`<div><div><span>${largo}</span></div></div>`, 'span');
      expect(dicho).not.toBe(largo);
    });

    it('ignora lo que se toca dentro de un modal ya abierto', () => {
      // El modal anuncia su apertura; si esta capa también hablara, se oiría
      // dos veces lo mismo.
      const dicho = etiquetaDe(
        `<div><div class="ion-overlay"><span>Cancelar</span></div></div>`,
        'span'
      );
      expect(dicho).toBe('');
    });
  });

  describe('al apagar', () => {
    it('deja de anunciar', async () => {
      await service.establecer(true);
      await service.establecer(false);
      const dicho = etiquetaDe(`<div><div><span>Contactos</span></div></div>`, 'span');
      expect(dicho).toBe('');
    });
  });
});

import {
  motivoNombreInvalido,
  validarNombreOApellido,
  validarEmail,
  validarPassword,
  validarTelefonoChileno,
  formatearTelefonoChileno,
  validarRutChileno,
  formatearRut,
  validarFechaNacimiento,
  validarTextoBasico
} from './validators';

describe('validators', () => {

  describe('validarNombreOApellido', () => {
    it('acepta nombres y apellidos normales', () => {
      expect(validarNombreOApellido('Maria')).toBe(true);
      expect(validarNombreOApellido('Perez')).toBe(true);
    });

    it('acepta tildes y la enye, que son obligatoria en nombres chilenos', () => {
      expect(validarNombreOApellido('Ñuñez')).toBe(true);
      expect(validarNombreOApellido('Múñoz')).toBe(true);
      expect(validarNombreOApellido('Gutiérrez')).toBe(true);
    });

    it('acepta espacios, incluidos los que unen dos palabras', () => {
      expect(validarNombreOApellido('Maria Jose')).toBe(true);
    });

    it('rechaza vacio, null y un solo caracter', () => {
      expect(validarNombreOApellido('')).toBe(false);
      expect(validarNombreOApellido('a')).toBe(false);
      expect(validarNombreOApellido('  ')).toBe(false);
    });

    it('rechaza numeros y simbolos, que en un nombre no tienen sentido', () => {
      expect(validarNombreOApellido('Maria1')).toBe(false);
      expect(validarNombreOApellido('O\'Brien')).toBe(false);
      expect(validarNombreOApellido('Perez-Smith')).toBe(false);
    });
  });

  describe('motivoNombreInvalido', () => {
    it('dice que el problema son los numeros, no el largo', () => {
      expect(motivoNombreInvalido('Siempre1')).toBe('numeros');
      expect(motivoNombreInvalido('1')).toBe('numeros');
    });

    it('acepta dos nombres separados por espacio', () => {
      expect(motivoNombreInvalido('Maria Jose')).toBeNull();
      expect(motivoNombreInvalido('  Ana  María  ')).toBeNull();
    });

    it('prohibe espacios en los apellidos, que son una sola palabra', () => {
      expect(motivoNombreInvalido('Cer ca', { apellido: true })).toBe('espacios');
      expect(motivoNombreInvalido('Perez', { apellido: true })).toBeNull();
    });

    it('distingue vacio, corto y simbolos', () => {
      expect(motivoNombreInvalido('')).toBe('vacio');
      expect(motivoNombreInvalido('   ')).toBe('vacio');
      expect(motivoNombreInvalido('A')).toBe('corto');
      expect(motivoNombreInvalido('O\'Brien')).toBe('caracteres');
    });
  });

  describe('validarEmail', () => {
    it('acepta correos con y sin puntos', () => {
      expect(validarEmail('maria@correo.cl')).toBe(true);
      expect(validarEmail('maria.perez@correo.cl')).toBe(true);
    });

    it('acepta el signo mas y el guion bajo, comunes en correos institucionales', () => {
      expect(validarEmail('nombre+etiqueta@correo.cl')).toBe(true);
      expect(validarEmail('nombre_apellido@correo.cl')).toBe(true);
    });

    it('rechaza lo que no trae arroba o dominio completo', () => {
      expect(validarEmail('mariacorreo.cl')).toBe(false);
      expect(validarEmail('maria@correo')).toBe(false);
      expect(validarEmail('maria@')).toBe(false);
    });

    it('rechaza vacio y espacios', () => {
      expect(validarEmail('')).toBe(false);
      expect(validarEmail('   ')).toBe(false);
    });
  });

  describe('validarPassword', () => {
    it('acepta una contrasena que cumple todas las reglas', () => {
      expect(validarPassword('Abc1234!').valida).toBe(true);
    });

    it('no devuelve mensaje cuando la contrasena es valida', () => {
      expect(validarPassword('Abc1234!').mensaje).toBeUndefined();
    });

    it('pide contrasena cuando viene vacia', () => {
      const r = validarPassword('');
      expect(r.valida).toBe(false);
      expect(r.mensaje).toBe('La contraseña es requerida.');
    });

    it('pide al menos 8 caracteres', () => {
      const r = validarPassword('Ab1');
      expect(r.valida).toBe(false);
      expect(r.mensaje).toContain('8 caracteres');
    });

    it('pide un numero', () => {
      const r = validarPassword('Abcdefgh');
      expect(r.valida).toBe(false);
      expect(r.mensaje).toContain('número');
    });

    it('pide una minuscula', () => {
      const r = validarPassword('ABC12345');
      expect(r.valida).toBe(false);
      expect(r.mensaje).toContain('minúscula');
    });

    it('pide una mayuscula', () => {
      const r = validarPassword('abc12345');
      expect(r.valida).toBe(false);
      expect(r.mensaje).toContain('mayúscula');
    });

    it('pide un simbolo', () => {
      const r = validarPassword('Abc12345');
      expect(r.valida).toBe(false);
      expect(r.mensaje).toContain('símbolo');
    });

    it('avisa primero la regla que falta, no todas juntas', () => {
      // Con una sola regla fallando a la vez, el mensaje tiene que ser el de
      // esa regla: si se reportaran todas, la pantalla se llenaria de texto.
      expect(validarPassword('abc').mensaje).toBe('La contraseña debe tener al menos 8 caracteres.');
      expect(validarPassword('abcdefgh').mensaje).toBe('La contraseña debe incluir al menos un número.');
    });
  });

  describe('validarTelefonoChileno', () => {
    it('acepta los 9 digitos de un movil', () => {
      expect(validarTelefonoChileno('912345678')).toBe(true);
    });

    it('acepta el movil con prefijo pais', () => {
      expect(validarTelefonoChileno('56912345678')).toBe(true);
      expect(validarTelefonoChileno('+56912345678')).toBe(true);
    });

    it('acepta el movil escrito como la persona lo teclea', () => {
      expect(validarTelefonoChileno('+56 9 1234 5678')).toBe(true);
      expect(validarTelefonoChileno('(9) 1234-5678')).toBe(true);
    });

    it('rechaza un fijo, porque el codigo de pais chileno no es el 9', () => {
      expect(validarTelefonoChileno('812345678')).toBe(false);
    });

    it('rechaza un movil al que le falta o sobra un digito', () => {
      expect(validarTelefonoChileno('91234567')).toBe(false);
      expect(validarTelefonoChileno('9123456789')).toBe(false);
    });

    it('rechaza vacio', () => {
      expect(validarTelefonoChileno('')).toBe(false);
    });
  });

  describe('formatearTelefonoChileno', () => {
    it('agrupa los 9 digitos como los ve la persona', () => {
      expect(formatearTelefonoChileno('912345678')).toBe('+56 9 1234 5678');
    });

    it('normaliza cuando ya viene con el prefijo pais', () => {
      expect(formatearTelefonoChileno('56912345678')).toBe('+56 9 1234 5678');
    });

    it('devuelve el numero tal cual si no son 9 digitos', () => {
      // Inventar el resto de los digitos dejaria a la persona con un numero
      // equivocado al que luego marca, que es peor que no formatear nada.
      expect(formatearTelefonoChileno('123')).toBe('123');
    });

    it('devuelve vacio cuando no hay numero', () => {
      expect(formatearTelefonoChileno('')).toBe('');
    });
  });

  describe('validarRutChileno', () => {
    it('acepta un rut con el digito verificador correcto', () => {
      expect(validarRutChileno('12.345.678-5')).toBe(true);
    });

    it('acepta el mismo rut sin puntos ni guion', () => {
      expect(validarRutChileno('123456785')).toBe(true);
    });

    it('acepta la K mayuscula como digito verificador', () => {
      expect(validarRutChileno('11.111.111-1')).toBe(true);
    });

    it('rechaza cuando el digito verificador no calza', () => {
      expect(validarRutChileno('12.345.678-6')).toBe(false);
    });

    it('rechaza un cuerpo que no sean solo digitos', () => {
      expect(validarRutChileno('abcdefgh')).toBe(false);
    });

    it('rechaza lo que es demasiado corto para ser un rut', () => {
      expect(validarRutChileno('1-9')).toBe(false);
    });

    it('rechaza vacio', () => {
      expect(validarRutChileno('')).toBe(false);
    });
  });

  describe('formatearRut', () => {
    it('pone los puntos y el guion del verificador', () => {
      expect(formatearRut('123456785')).toBe('12.345.678-5');
    });

    it('deja la K en mayuscula', () => {
      expect(formatearRut('12345678k')).toBe('12.345.678-K');
    });

    it('no parte un digito suelto en cuerpo y verificador', () => {
      expect(formatearRut('5')).toBe('5');
    });

    it('devuelve vacio cuando no hay nada que formatear', () => {
      expect(formatearRut('')).toBe('');
      expect(formatearRut('---')).toBe('');
    });
  });

  describe('validarFechaNacimiento', () => {
    it('acepta una fecha pasada razonable', () => {
      expect(validarFechaNacimiento('1950-06-15')).toBe(true);
    });

    it('rechaza una fecha futura', () => {
      const manana = new Date();
      manana.setFullYear(manana.getFullYear() + 1);
      expect(validarFechaNacimiento(manana.toISOString())).toBe(false);
    });

    it('rechaza texto que no es fecha', () => {
      expect(validarFechaNacimiento('ayer')).toBe(false);
    });

    it('rechaza un mes imposible como el 13', () => {
      expect(validarFechaNacimiento('1950-13-01')).toBe(false);
    });

    it('rechaza mas de 120 anos, que no es una persona viva', () => {
      const anioActual = new Date().getFullYear();
      expect(validarFechaNacimiento(`${anioActual - 130}-01-01`)).toBe(false);
    });

    it('rechaza texto que no es fecha', () => {
      expect(validarFechaNacimiento('ayer')).toBe(false);
    });

    it('rechaza vacio', () => {
      expect(validarFechaNacimiento('')).toBe(false);
    });
  });

  describe('validarTextoBasico', () => {
    it('acepta un texto que llega al largo minimo', () => {
      expect(validarTextoBasico('Ñuñoa')).toBe(true);
    });

    it('cuenta el largo sin los espacios de los bordes', () => {
      expect(validarTextoBasico('  ab  ', 4)).toBe(false);
    });

    it('respeta el largo minimo que le pidan', () => {
      expect(validarTextoBasico('ab', 2)).toBe(true);
      expect(validarTextoBasico('ab', 3)).toBe(false);
    });

    it('rechaza vacio y solo espacios', () => {
      expect(validarTextoBasico('')).toBe(false);
      expect(validarTextoBasico('   ', 2)).toBe(false);
    });
  });
});
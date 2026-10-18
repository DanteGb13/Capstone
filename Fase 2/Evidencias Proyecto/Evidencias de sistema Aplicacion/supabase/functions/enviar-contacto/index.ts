// Formulario de contacto de la página web.
//
// POR QUÉ EXISTE ESTA FUNCIÓN
//
// El formulario es público: lo llena alguien que todavía no tiene cuenta y que
// puede no haber descargado la app. No hay sesión que verificar, así que esta
// función NO lee un JWT: acepta el pedido de cualquiera que abra la web.
//
// El envío tiene que pasar por acá porque el navegador no puede mandar correos
// solos, y mandar la API key del proveedor desde el cliente la expondría a
// cualquier visitante.
//
// ANTISpam
//
// Al ser pública, sin sesión ni验证码 se volvería un buzón de entrada libre.
// Hay dos barreras baratas:
//
//  1. Campo trampa (`sitio_web`): invisible para la persona y para el lector de
//     pantalla, pero los robots lo llenan. Si viene con algo, se descarta todo.
//  2. Límites de largo en cada campo: acotan tanto el correo malicioso como el
//     costo de un envío con el cuerpo inflado.
//
// CONFIGURACIÓN PENDIENTE
//
// El correo se manda con Brevo, el mismo proveedor que ya usan
// `enviar-codigo-recuperacion` y `enviar-codigo-correo` en este proyecto, así
// que no hace falta ninguna cuenta nueva.
//
// La clave va en un secret y NO escrita en el código:
//
//   supabase secrets set BREVO_API_KEY=xkeysib-...
//   supabase functions deploy enviar-contacto
//
// Se deja así a propósito aunque las otras funciones tengan la suya pegada en
// el fuente: una clave dentro del `index.ts` queda en el repositorio apenas
// alguien versiona esa carpeta.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/** A quién llega cada mensaje del formulario. */
const CORREO_DESTINO = "siemprecerca2026@gmail.com";

/**
 * Remitente. Es la misma cuenta con la que ya envía el resto de las funciones
 * de este proyecto, que es además adónde van los mensajes, así que en Brevo ya
 * está como remitente verificado y no hay que verificar ningún dominio nuevo.
 */
const REMITENTE = { name: "Siempre Cerca", email: CORREO_DESTINO };

/**
 * Motivos permitidos. Es una lista cerrada a propósito: el motivo se usa tal
 * cual en el asunto del correo, así que aceptarlo libre dejaría que cualquiera
 * escribiera un asunto gigante o con asteriscos de unsubscribe para mandar el
 * mensaje a otra persona.
 */
const MOTIVOS = [
  "Consulta general",
  "Problema con mi cuenta",
  "Ayuda para usar la app",
  "Sugerencia",
  "Reclamo",
  "Otro",
] as const;

type Motivo = (typeof MOTIVOS)[number];

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

const LIMITE = {
  nombre: 120,
  correo: 254,
  telefono: 30,
  comentario: 2000,
};

interface Peticion {
  nombre?: string;
  correo?: string;
  telefono?: string;
  /** Motivo del contacto. Se valida contra la lista cerrada MOTIVOS. */
  motivo?: string;
  comentario?: string;
  /** Campo trampa. Viene vacío si lo llenó una persona. */
  sitio_web?: string;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Quita lo que sobra en los bordes y corta al límite, para no arrastrar basura. */
function limpiar(valor: unknown, maximo: number): string {
  return String(valor ?? "").trim().slice(0, maximo);
}

/**
 * Escapa para HTML. El comentario lo escribe una persona externa y va dentro
 * del correo: sin esto, un `<script>` o un `"><img onerror=...>` viajaría tal
 * cual al correo de quien lo lea.
 */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function correoValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor);
}

/**
 * Las mismas reglas que usa el formulario, y las mismas que usa el resto de la
 * app. Se repiten acá porque esta función es pública: alguien puede llamarla
 * saltándose el formulario, así que validar sólo en el cliente no alcanzaría.
 *
 *  - Nombre: sólo letras con tilde, ñ/ü y espacios.
 *  - Correo: formato estándar.
 *  - Teléfono: 9 dígitos empezando con 9, o los 11 de `569XXXXXXXX`.
 */
function nombreValido(valor: string): boolean {
  return valor.length >= 2 && /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/.test(valor);
}

function telefonoValido(valor: string): boolean {
  const limpio = valor.replace(/[\s\-()+]/g, "");
  return /^9\d{8}$/.test(limpio) || /^569\d{8}$/.test(limpio);
}

/** Cortar un texto largo sin partir una palabra a la mitad. */
function recortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  return texto.slice(0, maximo).replace(/\s+\S*$/, "") + "…";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Método no permitido." });
  }

  if (!BREVO_API_KEY) {
    // No se responde con el detalle de qué falta: esa información ayuda a
    // quien vaya a abusar de la función.
    console.error("Falta BREVO_API_KEY en los secrets.");
    return jsonResponse(500, { error: "El servicio no está disponible en este momento." });
  }

  let cuerpo: Peticion;
  try {
    cuerpo = await req.json();
  } catch {
    return jsonResponse(400, { error: "No se pudo leer el formulario." });
  }

  // Barrera 1: campo trampa lleno.
  if (limpiar(cuerpo.sitio_web, 200).length > 0) {
    // Se responde como si fuera un envío correcto. Confirmarle que lo detected
    // le diría al bot cuál es el filtro, y el visitoro real no tiene por qué ver
    // un error por escribir en un campo que no vio.
    return jsonResponse(200, { ok: true, mensaje: "Mensaje enviado." });
  }

  const nombre = limpiar(cuerpo.nombre, LIMITE.nombre);
  const correo = limpiar(cuerpo.correo, LIMITE.correo).toLowerCase();
  const telefono = limpiar(cuerpo.telefono, LIMITE.telefono);
  const comentario = limpiar(cuerpo.comentario, LIMITE.comentario);

const motivo = MOTIVOS.find((m) => m === limpiar(cuerpo.motivo, 40));
  if (!motivo) {
    return jsonResponse(400, {
      error: "Selecciona un motivo de contacto.",
      campo: "motivo",
    });
  }

  if (!nombre) {
    return jsonResponse(400, {
      error: "Ingresa tu nombre completo.",
      campo: "nombre",
    });
  }

  if (!nombreValido(nombre)) {
    return jsonResponse(400, {
      error: "El nombre solo puede contener letras, sin números ni símbolos.",
      campo: "nombre",
    });
  }

  if (!correo) {
    return jsonResponse(400, {
      error: "Ingresa tu correo electrónico.",
      campo: "correo",
    });
  }

  if (!correoValido(correo)) {
    return jsonResponse(400, {
      error: "El correo no tiene un formato válido.",
      campo: "correo",
    });
  }

  if (!telefono) {
    return jsonResponse(400, {
      error: "Ingresa tu número de teléfono.",
      campo: "telefono",
    });
  }

  // El teléfono es obligatorio: sin él no hay forma de responderle a quien
  // escribió, y el contacto queda en el limbo.
  if (!telefonoValido(telefono)) {
    return jsonResponse(400, {
      error: "El teléfono debe tener 9 dígitos empezando con 9, o incluir el prefijo +56.",
      campo: "telefono",
    });
  }

  if (!comentario) {
    return jsonResponse(400, {
      error: "Escribe tu comentario.",
      campo: "comentario",
    });
  }

  if (comentario.length < 10) {
    return jsonResponse(400, {
      error: "Cuéntanos un poco más (mínimo 10 caracteres).",
      campo: "comentario",
    });
  }

  const fecha = new Date().toLocaleString("es-CL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#7715c7;margin:0 0 4px">Nuevo mensaje desde la web</h2>
      <p style="color:#6b7280;margin:0 0 24px;font-size:14px">${escaparHtml(fecha)}</p>

      <table style="width:100%;border-collapse:collapse;font-size:15px">
        <tr>
          <td style="padding:8px 12px 8px 0;color:#6b7280;white-space:nowrap;vertical-align:top">Motivo</td>
          <td style="padding:8px 0;color:#1a1d26"><strong>${escaparHtml(motivo)}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;color:#6b7280;white-space:nowrap;vertical-align:top">Nombre</td>
          <td style="padding:8px 0;color:#1a1d26"><strong>${escaparHtml(nombre)}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;color:#6b7280;vertical-align:top">Correo</td>
          <td style="padding:8px 0"><a href="mailto:${escaparHtml(correo)}" style="color:#7715c7">${escaparHtml(correo)}</a></td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;color:#6b7280;vertical-align:top">Teléfono</td>
          <td style="padding:8px 0;color:#1a1d26">${escaparHtml(telefono)}</td>
        </tr>
        <tr>
          <td style="padding:16px 12px 8px 0;color:#6b7280;vertical-align:top">Comentario</td>
          <td style="padding:16px 0 0;color:#1a1d26;line-height:1.6">${escaparHtml(comentario).replace(/\n/g, "<br>")}</td>
        </tr>
      </table>

      <p style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px">
        Responde a este correo para escribirle directamente.
      </p>
    </div>
  `;

  try {
    const respuesta = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: REMITENTE,
        to: [{ email: CORREO_DESTINO }],
        // `replyTo` es con R y pegado: en Brevo así se define a quién responde
        // el correo si le contestan desde la bandeja. Con eso, responderle a
        // alguien que escribió por la web llega a su correo y no a la casilla
        // de la empresa.
        replyTo: { email: correo, name: nombre },
        subject: `[${motivo}] ${recortar(nombre, 40)}`,
        htmlContent: html,
      }),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      console.error("Brevo rechazó el envío:", respuesta.status, detalle);
      return jsonResponse(502, { error: "No se pudo enviar el mensaje. Intenta nuevamente." });
    }

    return jsonResponse(200, {
      ok: true,
      mensaje: "Mensaje enviado. Te responderemos a la brevedad.",
    });
  } catch (error) {
    console.error("Fallo de red al enviar el mensaje:", error);
    return jsonResponse(502, { error: "No se pudo enviar el mensaje. Intenta nuevamente." });
  }
});
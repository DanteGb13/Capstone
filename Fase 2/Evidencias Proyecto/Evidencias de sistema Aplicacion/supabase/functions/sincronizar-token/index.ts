// Sincronización del token de push de un dispositivo.
//
// POR QUÉ EXISTE ESTA FUNCIÓN
//
// `push_tokens` está protegida por RLS de forma restrictiva: el usuario puede
// LEER sus propias filas, pero no puede INSERTAR ni borrar las ajenas. Eso está
// bien por seguridad, pero deja a la app sin forma de registrar el token del
// dispositivo.
//
// La consecuencia sería grave: si la fila se pierde (porque FCM marcó el token
// como caducado, o porque alguien cerró sesión), el teléfono queda sin
// NINGÚN push — ni SOS, ni zona segura, ni "estoy en casa" — y no hay forma de
// recuperarlo desde el móvil.
//
// Por eso el registro se hace acá, con service_role, que es el mismo patrón
// que `enviar-push` ya usa en este proyecto para descartar tokens caducados.
//
// QUÉ HACE, EN ORDEN
//
//  1. Suelta el token de las OTRAS cuentas (el token es del teléfono, no de la
//     persona; sin esto, la cuenta anterior sigue recibiendo alertas).
//  2. Guarda el token de la cuenta actual.
//
// La app llama a esta función en cada arranque, así que una fila perdida se
// recupera sola en la siguiente apertura.
//
// ALCANCE
//
// El cliente nunca dice QUÉ USUARIO registrar: sale de `auth.uid()` del JWT, que
// no se puede falsificar. Y la limpieza sólo toca filas de ESE token que
// pertenecen a otra cuenta; jamás la fila propia.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

interface Peticion {
  /** Token del dispositivo, lo entrega FCM al teléfono. */
  token?: string;
  plataforma?: string;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Id del usuario que llama, leído del JWT. Nunca viene del cuerpo. */
function usuarioDe(authorization: string | null): string | null {
  if (!authorization) return null;
  const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
  try {
    // atob recibe el payload (segunda parte del JWT), no el JWT entero:
    // con el token completo atob lanza "Invalid character", usuarioDe
    // devolvía null y la función contestaba 401 aunque la sesión fuera válida.
    const payloadSegmento = jwt.split(".")[1] ?? "";
    const payload = JSON.parse(
      atob(payloadSegmento.replace(/-/g, "+").replace(/_/g, "/"))
    );
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse(500, { error: "Faltan credenciales del servidor" });
  }

  const usuario = usuarioDe(req.headers.get("Authorization"));
  if (!usuario) {
    return jsonResponse(401, { error: "Se requiere sesión iniciada" });
  }

  let body: Peticion;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Cuerpo inválido" });
  }

  const token = body.token?.trim();
  if (!token) {
    return jsonResponse(400, { error: "Falta el token del dispositivo" });
  }

  const plataforma = body.plataforma || "android";
  const cabeceras = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. Suelta el token de otras cuentas.
    const liberar = await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}` +
        `&id_usuario=neq.${encodeURIComponent(usuario)}`,
      { method: "DELETE", headers: cabeceras }
    );

    if (!liberar.ok) {
      // No es fatal: se sigue con el registro. Lo que importa es que la cuenta
      // actual quede con su token.
      console.warn("No se pudo liberar el token de otras cuentas:", liberar.status);
    }

    // 2. Guarda el de la cuenta actual.
    //    Se borra primero y se inserta después (en vez de upsert con onConflict)
    //    porque upsert exige un índice único que puede no existir, y si falta
    //    el POST falla entero y el teléfono queda sin push.
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?id_usuario=eq.${encodeURIComponent(usuario)}` +
        `&token=eq.${encodeURIComponent(token)}`,
      { method: "DELETE", headers: cabeceras }
    );

    const guardar = await fetch(`${SUPABASE_URL}/rest/v1/push_tokens`, {
      method: "POST",
      headers: { ...cabeceras, Prefer: "return=representation" },
      body: JSON.stringify({
        id_usuario: usuario,
        token,
        plataforma,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!guardar.ok) {
      const detalle = await guardar.text();
      console.error("No se pudo registrar el token:", guardar.status, detalle);
      return jsonResponse(500, { error: "No se pudo registrar el token", detalle });
    }

    // 3. Confirmación: se vuelve a leer para no depender de que el insert
    //    haya funcionado. Esta línea es la que aparece en los logs como
    //    "token OK" y sirve para diagnosticar.
    const verificacion = await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}` +
        `&id_usuario=eq.${encodeURIComponent(usuario)}&select=id_usuario`,
      { headers: cabeceras }
    );
    const filas = verificacion.ok ? await verificacion.json() : [];

    console.log(
      `Token sincronizado para ${usuario.slice(0, 8)}: ${filas.length} fila(s).`
    );

    return jsonResponse(200, { ok: true, filas: filas.length });
  } catch (e) {
    console.error("Error sincronizando el token:", e?.message || e);
    return jsonResponse(500, { error: "Error interno" });
  }
});

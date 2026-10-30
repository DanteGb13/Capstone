import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function respuesta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return respuesta(200, {});
  if (request.method !== "POST") return respuesta(405, { error: "Método no permitido" });

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return respuesta(401, { error: "Se requiere una sesión iniciada" });
  }

  let datos: Record<string, unknown>;
  try {
    datos = await request.json();
  } catch {
    return respuesta(400, { error: "Datos inválidos" });
  }

  const usuarioId = String(datos.usuario_id ?? "");
  const activo = datos.activo === true;
  if (!usuarioId || typeof datos.activo !== "boolean") {
    return respuesta(400, { error: "Usuario y estado son obligatorios" });
  }

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return respuesta(500, { error: "La función no tiene credenciales configuradas" });
  }

  const clienteConToken = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: actor, error: errorActor } = await clienteConToken.auth.getUser();
  if (errorActor || !actor.user) {
    return respuesta(401, { error: "La sesión no es válida" });
  }
  if (actor.user.id === usuarioId) {
    return respuesta(403, { error: "No puedes cambiar el estado de tu propia cuenta" });
  }

  const { data: esAdministrador, error: errorAdmin } = await clienteConToken.rpc("es_administrador");
  if (errorAdmin || !esAdministrador) {
    return respuesta(403, { error: "Solo un administrador puede cambiar el estado de cuentas" });
  }

  const { data: estadoAnterior, error: errorEstado } = await clienteConToken.rpc("admin_cambiar_estado", {
    p_usuario: usuarioId,
    p_activo: activo,
  });
  if (errorEstado) {
    return respuesta(400, { error: errorEstado.message });
  }

  const clienteAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  try {
    const { error } = await clienteAdmin.auth.admin.updateUserById(usuarioId, {
      ban_duration: activo ? "none" : "876000h",
    });
    if (error) throw error;

    return respuesta(200, { ok: true, estado: estadoAnterior });
  } catch (error: unknown) {
    await clienteConToken.rpc("admin_cambiar_estado", {
      p_usuario: usuarioId,
      p_activo: !activo,
    });
    const mensaje = error instanceof Error ? error.message : String(error);
    return respuesta(400, { error: mensaje || "No se pudo actualizar el acceso de la cuenta" });
  }
});

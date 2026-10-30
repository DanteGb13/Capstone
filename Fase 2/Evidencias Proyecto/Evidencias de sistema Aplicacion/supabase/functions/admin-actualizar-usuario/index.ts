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
  const correo = String(datos.correo ?? "").trim();
  if (!usuarioId || !correo) {
    return respuesta(400, { error: "Usuario y correo son obligatorios" });
  }

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return respuesta(500, { error: "La función no tiene credenciales configuradas" });
  }

  const clienteConToken = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: usuarioActual, error: errorUsuario } = await clienteConToken.auth.getUser();
  if (errorUsuario || !usuarioActual.user) {
    return respuesta(401, { error: "La sesión no es válida" });
  }

  const { data: esAdministrador, error: errorAdmin } = await clienteConToken
    .rpc("es_administrador");
  if (errorAdmin || !esAdministrador) {
    return respuesta(403, { error: "Solo un administrador puede editar usuarios" });
  }

  const clienteAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: perfilAuth, error: errorPerfilAuth } =
    await clienteAdmin.auth.admin.getUserById(usuarioId);
  if (errorPerfilAuth || !perfilAuth.user) {
    return respuesta(404, { error: "No se encontró la cuenta de inicio de sesión" });
  }

  const correoAnterior = perfilAuth.user.email ?? null;

  try {
    if (correoAnterior !== correo) {
      const { error } = await clienteAdmin.auth.admin.updateUserById(usuarioId, {
        email: correo,
      });
      if (error) throw error;
    }

    const { error } = await clienteConToken.rpc("admin_actualizar_usuario", {
      p_usuario: usuarioId,
      p_nombre: datos.nombre,
      p_apellidopa: datos.apellidopa,
      p_apellidoma: datos.apellidoma,
      p_correo: correo,
      p_rut: datos.rut,
      p_telefono: datos.telefono,
      p_fecha_nacimiento: datos.fecha_nacimiento,
      p_rol_id: datos.rol_id,
      p_direccion_id: datos.direccion_id,
      p_region: datos.region,
      p_comuna: datos.comuna,
      p_calle: datos.calle,
      p_numero: datos.numero,
    });

    if (error) {
      if (correoAnterior && correoAnterior !== correo) {
        await clienteAdmin.auth.admin.updateUserById(usuarioId, { email: correoAnterior });
      }
      throw error;
    }

    return respuesta(200, { ok: true });
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return respuesta(400, { error: mensaje || "No se pudo actualizar la cuenta" });
  }
});

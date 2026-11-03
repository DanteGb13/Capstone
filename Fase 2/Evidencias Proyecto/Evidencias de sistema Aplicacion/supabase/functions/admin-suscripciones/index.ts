import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TRANSBANK_API_URL = Deno.env.get("TRANSBANK_API_URL") ?? "";
const TRANSBANK_COMMERCE_CODE = Deno.env.get("TRANSBANK_COMMERCE_CODE") ?? "";
const TRANSBANK_API_KEY = Deno.env.get("TRANSBANK_API_KEY") ?? "";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return respuesta(200, {});
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respuesta(401, { error: "Se requiere sesión iniciada" });

  let datos: Record<string, unknown>;
  try { datos = await request.json(); } catch { return respuesta(400, { error: "Datos inválidos" }); }

  const clienteUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: usuario, error } = await clienteUsuario.auth.getUser();
  if (error || !usuario.user) return respuesta(401, { error: "Sesión inválida" });
  const { data: administrador } = await clienteUsuario.rpc("es_administrador");
  if (!administrador) return respuesta(403, { error: "Solo administradores pueden gestionar suscripciones" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const accion = String(datos.accion ?? "");

  if (accion === "listar") {
    const { data, error: errorConsulta } = await admin
      .from("suscripcion")
      .select("id, usuario_id, plan_codigo, estado, inicia_en, vence_en, mejora_en, plan_anterior_codigo")
      .in("estado", ["activa", "cancelada"])
      .order("actualizada_en", { ascending: false });
    if (errorConsulta) return respuesta(500, { error: "No se pudieron cargar las suscripciones" });

    const ids = [...new Set((data ?? []).map((fila) => fila.usuario_id))];
    const nombres = new Map<string, string>();
    const correos = new Map<string, string>();
    if (ids.length) {
      const usuarios = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const cuenta of usuarios.data?.users ?? []) {
        if (!ids.includes(cuenta.id)) continue;
        correos.set(cuenta.id, cuenta.email ?? "");
        const perfil = await admin.from("usuario").select("nombre, apellidopa").eq("id", cuenta.id).maybeSingle();
        nombres.set(cuenta.id, [perfil.data?.nombre, perfil.data?.apellidopa].filter(Boolean).join(" ").trim());
      }
    }

    return respuesta(200, {
      suscripciones: (data ?? []).map(fila => ({
        ...fila,
        correo: correos.get(fila.usuario_id) ?? "",
        nombre: nombres.get(fila.usuario_id) ?? "",
      })),
    });
  }

  if (accion === "revertir_mejora") {
    const suscripcionId = String(datos.suscripcion_id ?? "");
    const { data: mejora, error: errorMejora } = await admin
      .from("suscripcion")
      .select("id, usuario_id, plan_codigo, mejora_en, plan_anterior_codigo, plan_anterior_inicia_en, plan_anterior_vence_en")
      .eq("id", suscripcionId)
      .eq("plan_codigo", "anual")
      .eq("estado", "activa")
      .maybeSingle();
    if (errorMejora || !mejora?.mejora_en || mejora.plan_anterior_codigo !== "mensual") {
      return respuesta(404, { error: "No hay una mejora anual elegible para revertir" });
    }

    const inicioMejora = new Date(mejora.mejora_en);
    let cursor = new Date(inicioMejora);
    const ahora = new Date();
    let diasHabiles = 0;
    while (cursor <= ahora && diasHabiles <= 7) {
      cursor.setDate(cursor.getDate() + 1);
      const dia = cursor.getDay();
      if (dia !== 0 && dia !== 6) diasHabiles++;
    }
    if (diasHabiles > 7) return respuesta(409, { error: "El plazo de 7 días hábiles ya terminó" });

    const { data: transaccion } = await admin
      .from("transaccion_pago")
      .select("token_transbank, monto, tipo")
      .eq("suscripcion_id", mejora.id)
      .eq("estado", "autorizada")
      .eq("tipo", "mejora")
      .order("creada_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (transaccion?.token_transbank) {
      const refund = await fetch(`${TRANSBANK_API_URL}/${encodeURIComponent(transaccion.token_transbank)}/refunds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tbk-api-key-id": TRANSBANK_COMMERCE_CODE,
          "Tbk-api-key-secret": TRANSBANK_API_KEY,
        },
        body: JSON.stringify({ amount: transaccion.monto }),
      });
      if (!refund.ok) return respuesta(502, { error: "Transbank no pudo procesar la reversión" });
    }

    await admin.from("suscripcion").update({
      estado: "cancelada",
      cancelada_en: new Date().toISOString(),
      actualizada_en: new Date().toISOString(),
    }).eq("id", mejora.id);

    const { error: mensualError } = await admin.from("suscripcion").upsert({
      usuario_id: mejora.usuario_id,
      plan_codigo: "mensual",
      estado: "activa",
      inicia_en: mejora.plan_anterior_inicia_en,
      vence_en: mejora.plan_anterior_vence_en,
      plan_anterior_codigo: null,
      mejora_en: null,
      actualizada_en: new Date().toISOString(),
    }, { onConflict: "usuario_id,plan_codigo" });
    if (mensualError) return respuesta(500, { error: "No se pudo restaurar el plan mensual" });

    return respuesta(200, { ok: true });
  }

  return respuesta(400, { error: "Acción inválida" });
});

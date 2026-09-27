import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enviarPushFirebase, canalDe, esTokenNoRegistrado, DatosPush } from "../_shared/fcm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface PushRequest {
  token: string;
  titulo: string;
  cuerpo: string;
  data?: DatosPush;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// La RLS no permite que el adulto mayor borre filas de push_tokens ajenas,
// así que el token caducado se limpia aquí, con la service role.
async function descartarTokenCaducado(token: string): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );

    if (!res.ok) {
      console.error("No se pudo descartar el token caducado:", res.status, await res.text());
    } else {
      console.log("Token caducado descartado de push_tokens");
    }
  } catch (e) {
    console.error("No se pudo descartar el token caducado:", e?.message || e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const body: PushRequest = await req.json();
    const { token, titulo, cuerpo, data } = body;

    console.log("=== PUSH REQUEST ===");
    console.log("Token:", token?.substring(0, 20) + "...");
    console.log("Titulo:", titulo);
    console.log("Canal:", canalDe(data));

    if (!token || !titulo || !cuerpo) {
      return jsonResponse(400, { error: "Faltan campos: token, titulo, cuerpo" });
    }

    const r = await enviarPushFirebase(token, titulo, cuerpo, data);
    if (!r.ok) {
      if (esTokenNoRegistrado(r.error)) {
        await descartarTokenCaducado(token);
      }
      return jsonResponse(500, { error: "Error enviando push", details: r.error });
    }

    return jsonResponse(200, { success: true });
  } catch (e) {
    console.error("Error:", e?.message || e);
    return jsonResponse(500, { error: "Internal server error", details: e?.message || String(e) });
  }
});

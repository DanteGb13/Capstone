import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enviarPushFirebase, esTokenNoRegistrado } from "../_shared/fcm.ts";

// Reenvía los avisos SOS que siguen sin confirmar. Lo llama pg_cron cada
// minuto, así el aviso no depende de que el adulto mayor tenga la app
// abierta: mientras haya una fila sin confirmada_por, se sigue avisando.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SECRETO = Deno.env.get("SOS_CRON_SECRET") || "";

/** Minutos que dura el aviso antes de dejar de reenviar. */
const DURACION_MINUTOS = 30;

interface Alerta {
  id: string;
  id_adulto: string;
  creada_en: string;
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

async function rest<T>(
  metodo: string,
  path: string,
  cuerpo?: unknown,
): Promise<{ data: T | null; error: string | null }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: metodo,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* respuesta sin JSON */
  }

  if (!res.ok) {
    return { data: null, error: json?.message || texto || res.statusText };
  }
  return { data: json as T, error: null };
}

async function descartarTokenCaducado(token: string): Promise<void> {
  try {
    await rest("DELETE", `push_tokens?token=eq.${encodeURIComponent(token)}`);
  } catch {
    /* el próximo ciclo lo reintenta */
  }
}

function autorizado(req: Request): boolean {
  if (!SECRETO) return false;
  const cabecera = req.headers.get("Authorization") || "";
  return cabecera.replace(/^Bearer\s+/i, "") === SECRETO;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!autorizado(req)) {
    return jsonResponse(401, { error: "No autorizado" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse(500, { error: "Faltan credenciales de Supabase" });
  }

  const desde = new Date(Date.now() - DURACION_MINUTOS * 60000).toISOString();

  const { data: alertas, error: errorAlertas } = await rest<Alerta[]>(
    "GET",
    "sos_alerta?select=id,id_adulto,creada_en" +
      "&confirmada_por=is.null&confirmada_en=is.null" +
      `&creada_en=gt.${encodeURIComponent(desde)}&order=creada_en.asc`,
  );

  if (errorAlertas) {
    return jsonResponse(500, { error: errorAlertas });
  }

  const resultado = {
    revisadas: alertas?.length || 0,
    avisos: 0,
    enviados: 0,
    fallidos: 0,
    errores: [] as string[],
  };

  for (const alerta of alertas || []) {
    try {
      const minutos = Math.floor((Date.now() - Date.parse(alerta.creada_en)) / 60000) + 1;
      const titulo = `SOS - Alerta de Emergencia (aviso ${minutos})`;

      const { data: vinculos } = await rest<{ cuidador: { id_usuario: string } | null }[]>(
        "GET",
        `cuidador_usuario?select=cuidador(id_usuario)&id_usuario=eq.${alerta.id_adulto}`,
      );

      const idsCuidadores = [
        ...new Set(
          (vinculos || []).map((v) => v.cuidador?.id_usuario).filter((id): id is string => !!id),
        ),
      ];

      if (idsCuidadores.length === 0) continue;

      const enCuidadores = idsCuidadores.join(",");

      const [{ data: tokens }, { data: adulto }, { data: ubicacion }] = await Promise.all([
        rest<{ token: string }[]>("GET", `push_tokens?select=token&id_usuario=in.(${enCuidadores})`),
        rest<{ nombre: string; apellidopa: string }[]>(
          "GET",
          `usuario?select=nombre,apellidopa&id=eq.${alerta.id_adulto}`,
        ),
        rest<{ latitud: string; longitud: string }[]>(
          "GET",
          `ubicacion?select=latitud,longitud&id_usuario=eq.${alerta.id_adulto}&order=fecha.desc&limit=1`,
        ),
      ]);

      if (!tokens || tokens.length === 0) continue;

      const nombre = adulto?.[0]
        ? `${adulto[0].nombre} ${adulto[0].apellidopa || ""}`.trim()
        : "Alguien";

      const ubi = ubicacion?.[0];

      // La dirección no va en el texto: al tocar el aviso se abre Google Maps
      // con las coordenadas que viajan en `data`.
      const cuerpo = ubi?.latitud && ubi?.longitud
        ? `${nombre} necesita ayuda. Toca para ver su ubicación en Google Maps.`
        : `${nombre} necesita ayuda. Ubicación no disponible.`;
      const datos: { [clave: string]: string } = {
        tipo: "sos",
        canal: "sos-alertas",
        id_sos: alerta.id,
        latitud: ubi?.latitud || "",
        longitud: ubi?.longitud || "",
      };

      resultado.avisos++;

      for (const fila of tokens) {
        const r = await enviarPushFirebase(fila.token, titulo, cuerpo, datos, "sos-alertas");
        if (r.ok) {
          resultado.enviados++;
        } else {
          resultado.fallidos++;
          if (esTokenNoRegistrado(r.error)) {
            await descartarTokenCaducado(fila.token);
          }
          if (resultado.errores.length < 5) {
            resultado.errores.push(r.error || "error desconocido");
          }
        }
      }
    } catch (e) {
      if (resultado.errores.length < 5) {
        resultado.errores.push(e?.message || String(e));
      }
    }
  }

  console.log("Reenvío SOS:", JSON.stringify(resultado));
  return jsonResponse(200, resultado);
});

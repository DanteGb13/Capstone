import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enviarPushFirebase, DatosPush } from "../_shared/fcm.ts";

// Evalúa si el adulto está fuera de sus zonas seguras y, de ser así,
// avisa a los cuidadores. Se llama:
//   - desde la app con la app abierta (TypeScript)
//   - desde el servicio nativo con la app cerrada (Java)
// El cooldown vive en la tabla zona_alerta (función atómica
// zona_evaluar_alerta), así nunca se duplican los avisos.
//
// Acciones devueltas:
//   'primera'      -> salió de zona: alerta intensa (canal zona-alertas)
//   'actualizacion'-> sigue fuera: estado cada 10 min (canal zona-estado)
//   'volvio'       -> volvió a la zona: aviso de estado (canal zona-estado)
//   'ninguna'      -> no toca avisar

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface Zona {
  nombre: string;
  direccion_texto: string;
  latitud_centro: number;
  longitud_centro: number;
  radio_metros: number;
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
  extraHeaders: Record<string, string> = {},
): Promise<{ data: T | null; error: string | null }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: metodo,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...extraHeaders,
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

function usuarioDelToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const partes = token.split(".");
  if (partes.length < 2) return null;
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const relleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(relleno));
    return payload?.sub || null;
  } catch {
    return null;
  }
}

function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (g: number) => (g * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function nombreDe(idUsuario: string): Promise<string> {
  const { data } = await rest<{ nombre: string; apellidopa: string; apellidoma: string }>(
    "GET",
    `usuario?select=nombre,apellidopa,apellidoma&id=eq.${idUsuario}&limit=1`,
  );
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) return "";
  return `${fila.nombre || ""} ${fila.apellidopa || ""} ${fila.apellidoma || ""}`.trim();
}

async function cuidadoresDe(idAdulto: string): Promise<string[]> {
  const { data } = await rest<any[]>(
    "GET",
    `cuidador_usuario?select=cuidador(id_usuario)&id_usuario=eq.${idAdulto}`,
  );
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((f: any) => f?.cuidador?.id_usuario)
    .filter((id: any) => typeof id === "string" && id.length > 0);
  return [...new Set(ids)] as string[];
}

async function tokensDe(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await rest<{ token: string }[]>(
    "GET",
    `push_tokens?select=token&id_usuario=in.(${ids.join(",")})`,
  );
  if (!Array.isArray(data)) return [];
  return [...new Set(data.map((t) => t.token).filter((t) => typeof t === "string" && t))];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse(500, { error: "SUPABASE_URL / SERVICE_ROLE no configurados" });
    }

    const solicitante = usuarioDelToken(req);
    if (!solicitante) {
      return jsonResponse(401, { error: "JWT inválido" });
    }

    const body = await req.json();
    const latitud = Number(body?.latitud);
    const longitud = Number(body?.longitud);
    if (!isFinite(latitud) || !isFinite(longitud)) {
      return jsonResponse(400, { error: "Faltan latitud/longitud" });
    }

    const objetivo: string =
      typeof body?.id_usuario === "string" && body.id_usuario ? body.id_usuario : solicitante;

    // Un cuidador solo puede evaluar a un adulto vinculado
    if (objetivo !== solicitante) {
      const { data: vinculos, error: errVinc } = await rest<any[]>(
        "GET",
        `cuidador_usuario?select=cuidador(id_usuario)&id_usuario=eq.${objetivo}`,
      );
      const vinculado =
        !errVinc &&
        Array.isArray(vinculos) &&
        vinculos.some((v: any) => v?.cuidador?.id_usuario === solicitante);
      if (!vinculado) {
        return jsonResponse(403, { error: "No estás vinculado a ese adulto" });
      }
    }

    // Zonas del adulto
    const { data: zonas, error: errZonas } = await rest<Zona[]>(
      "GET",
      `zona_segura?select=nombre,direccion_texto,latitud_centro,longitud_centro,radio_metros&id_usuario=eq.${objetivo}&activa=eq.true`,
    );
    if (errZonas || !zonas || !zonas.length) {
      return jsonResponse(200, { sin_zonas: true, dentro: false, accion: "ninguna" });
    }

    // Evaluación
    let dentro = false;
    let zonaCercana: Zona | null = null;
    let menor = Number.POSITIVE_INFINITY;

    for (const zona of zonas) {
      const d = distanciaMetros(latitud, longitud, zona.latitud_centro, zona.longitud_centro);
      if (d < menor) {
        menor = d;
        zonaCercana = zona;
      }
      if (d <= zona.radio_metros) {
        dentro = true;
      }
    }

    const distancia = isFinite(menor) ? menor : 0;

    // Decisión atómica en la BD (cooldown compartido con la app abierta)
    const { data: accion, error: errAccion } = await rest<string>(
      "POST",
      "rpc/zona_evaluar_alerta",
      { p_id_usuario: objetivo, p_fuera: !dentro },
    );
    if (errAccion) {
      console.error("Error en zona_evaluar_alerta:", errAccion);
      return jsonResponse(500, { error: errAccion });
    }

    const tipo = String(accion || "ninguna");
    if (tipo === "ninguna") {
      return jsonResponse(200, { dentro, accion: tipo, enviados: 0 });
    }

    // Aviso a los cuidadores
    const nombre = (await nombreDe(objetivo)) || "El adulto mayor";
    const nombreZona =
      (zonaCercana?.nombre || zonaCercana?.direccion_texto || "").trim() || "Zona segura";
    const mapa = `https://maps.google.com/?q=${latitud},${longitud}`;

    let canal = "zona-estado";
    let titulo = "";
    let cuerpo = "";

    if (tipo === "primera") {
      canal = "zona-alertas";
      titulo = "Fuera de zona segura";
      cuerpo = dentro
        ? `${nombre} está fuera de la zona segura "${nombreZona}".`
        : zonaCercana
        ? `${nombre} salió de la zona segura "${nombreZona}" (a ${Math.round(distancia)} m del centro).`
        : `${nombre} está fuera de todas las zonas seguras.`;
      cuerpo += ` Ubicación: ${mapa}`;
    } else if (tipo === "actualizacion") {
      canal = "zona-estado";
      titulo = "Zona segura - actualización";
      cuerpo = `${nombre} sigue fuera de "${nombreZona}" (a ${Math.round(distancia)} m). Ubicación: ${mapa}`;
    } else {
      canal = "zona-estado";
      titulo = "Volvió a zona segura";
      cuerpo = `${nombre} volvió a estar dentro de su zona segura "${nombreZona}".`;
    }

    const idsCuidadores = await cuidadoresDe(objetivo);
    const tokens = await tokensDe(idsCuidadores);

    const datos: DatosPush = {
      tipo: "zona_segura",
      canal,
      accion: tipo,
      latitud: String(latitud),
      longitud: String(longitud),
      zona: nombreZona,
    };

    let enviados = 0;
    await Promise.all(
      tokens.map(async (token) => {
        const r = await enviarPushFirebase(token, titulo, cuerpo, datos, canal);
        if (r.ok) enviados++;
      }),
    );

    return jsonResponse(200, { dentro, accion: tipo, enviados, canal });
  } catch (e) {
    console.error("Error en evaluar-zona:", e?.message || e);
    return jsonResponse(500, { error: e?.message || String(e) });
  }
});

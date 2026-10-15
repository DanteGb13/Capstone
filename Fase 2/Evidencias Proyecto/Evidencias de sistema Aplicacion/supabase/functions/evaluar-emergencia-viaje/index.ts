import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enviarPushFirebase, DatosPush } from "../_shared/fcm.ts";
import {
  crearRest,
  cuidadoresDe,
  distanciaMetros,
  nombreDe,
  tokensDe,
} from "../_shared/zona.ts";

// ALERTAS DE EMERGENCIA DURANTE EL MODO VIAJE
//
// Lo corre pg_cron cada 5 minutos. Revisa a los adultos con el modo
// viaje activo y avisa a los cuidadores si algo anda mal:
//   1) sin señal  -> no reporta ubicación desde hace más de 2 horas
//                    (y la última vez estaba fuera de sus zonas)
//   2) batería    -> teléfono con 15 % o menos y todavía reportando
//   3) parada     -> lleva 30+ min parado, fuera de zona, a +1 km
//
// Se manda COMO MÁXIMO un aviso por corrida (el más urgente) y cada
// regla tiene su propio cooldown de 6 horas para no spamear.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SECRETO = Deno.env.get("SOS_CRON_SECRET") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

const SIN_SENAL_MS = 2 * 60 * 60 * 1000;       // 2 h sin reportar
const PARADA_MS = 30 * 60 * 1000;              // 30 min parado
const LECTURA_FRESCA_MS = 10 * 60 * 1000;      // ping reciente
const BATERIA_MINIMA = 15;                     // %
const COOLDOWN_MS = 6 * 60 * 60 * 1000;        // 6 h entre avisos iguales
const DISTANCIA_MINIMA_M = 1000;               // lejos de toda zona

interface Pausa {
  id_usuario: string;
  termina_en: string | null;
  creada_en: string;
}

interface Estado {
  id_usuario: string;
  lat: number | null;
  lng: number | null;
  dentro: boolean | null;
  bateria: number | null;
  fecha: string | null;
  lat_fija: number | null;
  lng_fija: number | null;
  desde_fija: string | null;
  ult_senal: string | null;
  ult_parada: string | null;
  ult_bateria: string | null;
}

interface Zona {
  nombre: string;
  direccion_texto: string;
  latitud_centro: number;
  longitud_centro: number;
  radio_metros: number;
}

const rest = crearRest(SUPABASE_URL, SERVICE_KEY);

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function autorizado(req: Request): boolean {
  if (!SECRETO) return false;
  const cabecera = req.headers.get("Authorization") || "";
  return cabecera.replace(/^Bearer\s+/i, "") === SECRETO;
}

/** El cooldown de esa regla ya venció (o nunca se usó). */
function listo(ultima: string | null): boolean {
  if (!ultima) return true;
  return Date.now() - Date.parse(ultima) > COOLDOWN_MS;
}

/** Deja marcado el cooldown para no repetir el mismo aviso. */
async function marcar(
  idUsuario: string,
  columna: "ult_senal" | "ult_parada" | "ult_bateria",
): Promise<void> {
  await rest("PATCH", `zona_viaje_estado?id_usuario=eq.${idUsuario}`, {
    [columna]: new Date().toISOString(),
  });
}

async function enviarACuidadores(
  idAdulto: string,
  titulo: string,
  cuerpo: string,
  datos: DatosPush,
  canal: string,
): Promise<{ enviados: number; error?: string }> {
  const ids = await cuidadoresDe(rest, idAdulto);
  const tokens = await tokensDe(rest, ids);
  if (!tokens.length) return { enviados: 0, error: "sin tokens de cuidadores" };

  let enviados = 0;
  let error: string | undefined;
  await Promise.all(
    tokens.map(async (token) => {
      const r = await enviarPushFirebase(token, titulo, cuerpo, datos, canal);
      if (r.ok) enviados++;
      else if (!error) error = r.error || "error desconocido";
    }),
  );
  return { enviados, error };
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

  try {
    const { data: pausas, error: errPausas } = await rest<Pausa[]>(
      "GET",
      "zona_viaje?select=id_usuario,termina_en,creada_en&order=creada_en.asc",
    );
    if (errPausas) {
      return jsonResponse(500, { error: errPausas });
    }

    const ahora = Date.now();
    const activas = (pausas || []).filter(
      (p) => !p.termina_en || Date.parse(p.termina_en) > ahora,
    );

    const resultado = {
      revisadas: activas.length,
      senal: 0,
      bateria: 0,
      parada: 0,
      enviados: 0,
      errores: [] as string[],
    };

    for (const pausa of activas) {
      try {
        const { data: estados } = await rest<Estado[]>(
          "GET",
          `zona_viaje_estado?select=*&id_usuario=eq.${pausa.id_usuario}&limit=1`,
        );
        const estado = Array.isArray(estados) ? estados[0] : null;

        // Todavía no reportó nada durante el viaje: no hay de qué alertar
        if (!estado?.fecha) continue;

        const fecha = Date.parse(estado.fecha);
        const reportando = ahora - fecha <= LECTURA_FRESCA_MS;
        const nombre = (await nombreDe(rest, pausa.id_usuario)) || "El adulto mayor";

        let aviso: {
          columna: "ult_senal" | "ult_parada" | "ult_bateria";
          titulo: string;
          cuerpo: string;
        } | null = null;

        // 1) SIN SEÑAL: dejó de reportar y la última vez estaba fuera
        if (
          estado.dentro === false &&
          ahora - fecha > SIN_SENAL_MS &&
          listo(estado.ult_senal)
        ) {
          aviso = {
            columna: "ult_senal",
            titulo: "Sin ubicación en modo viaje",
            cuerpo:
              `${nombre} no reporta su ubicación desde hace más de 2 horas. ` +
              `Toca para ver su última ubicación en Google Maps.`,
          };
        }

        // 2) BATERÍA BAJA: reportando normal pero el teléfono está por morir
        if (
          !aviso &&
          estado.bateria != null &&
          estado.bateria <= BATERIA_MINIMA &&
          reportando &&
          listo(estado.ult_bateria)
        ) {
          aviso = {
            columna: "ult_bateria",
            titulo: "Batería baja en modo viaje",
            cuerpo:
              `La batería del teléfono de ${nombre} está en ${estado.bateria} %. ` +
              `Toca para ver su ubicación en Google Maps.`,
          };
        }

        // 3) PARADA PROLONGADA: quieto 30+ min fuera de todas sus zonas
        if (!aviso && estado.desde_fija && estado.lat_fija != null && reportando) {
          const paradoMs = ahora - Date.parse(estado.desde_fija);
          const fuera =
            estado.dentro === false && (await estaFueraDeZonas(pausa.id_usuario, estado));

          if (paradoMs >= PARADA_MS && fuera && listo(estado.ult_parada)) {
            const minutos = Math.round(paradoMs / 60000);
            aviso = {
              columna: "ult_parada",
              titulo: "Parada prolongada en modo viaje",
              cuerpo:
                `${nombre} lleva ${minutos} min parado fuera de sus zonas seguras. ` +
                `Toca para ver su ubicación en Google Maps.`,
            };
          }
        }

        if (!aviso) continue;

        const lat = estado.lat ?? estado.lat_fija;
        const lng = estado.lng ?? estado.lng_fija;

        const datos: DatosPush = {
          tipo: "zona_segura",
          canal: "zona-alertas",
          accion: `emergencia_${aviso.columna}`,
          latitud: lat != null ? String(lat) : "",
          longitud: lng != null ? String(lng) : "",
        };

        const r = await enviarACuidadores(
          pausa.id_usuario,
          aviso.titulo,
          aviso.cuerpo,
          datos,
          "zona-alertas",
        );

        if (r.enviados > 0) {
          await marcar(pausa.id_usuario, aviso.columna);
          if (aviso.columna === "ult_senal") resultado.senal++;
          else if (aviso.columna === "ult_bateria") resultado.bateria++;
          else resultado.parada++;
          resultado.enviados += r.enviados;
        } else if (r.error && resultado.errores.length < 5) {
          resultado.errores.push(r.error);
        }
      } catch (e) {
        if (resultado.errores.length < 5) {
          resultado.errores.push(String((e as any)?.message || e));
        }
      }
    }

    return jsonResponse(200, resultado);
  } catch (e) {
    console.error("Error en evaluar-emergencia-viaje:", e?.message || e);
    return jsonResponse(500, { error: e?.message || String(e) });
  }
});

/** ¿El punto donde está parado queda a más de 1 km de toda su zona? */
async function estaFueraDeZonas(idAdulto: string, estado: Estado): Promise<boolean> {
  const { data: zonas } = await rest<Zona[]>(
    "GET",
    `zona_segura?select=nombre,direccion_texto,latitud_centro,longitud_centro,radio_metros&id_usuario=eq.${idAdulto}&activa=eq.true`,
  );
  if (!Array.isArray(zonas) || !zonas.length) return false;

  const centro = zonas.find((z) => {
    const d = distanciaMetros(
      estado.lat_fija as number,
      estado.lng_fija as number,
      z.latitud_centro,
      z.longitud_centro,
    );
    return d <= z.radio_metros;
  });
  if (centro) return false; // está dentro de una zona: parada normal

  const masCercana = Math.min(
    ...zonas.map((z) =>
      distanciaMetros(
        estado.lat_fija as number,
        estado.lng_fija as number,
        z.latitud_centro,
        z.longitud_centro,
      ),
    ),
  );
  return masCercana > DISTANCIA_MINIMA_M;
}

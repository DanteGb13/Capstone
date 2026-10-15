// Utilidades compartidas por las Edge Functions de zona segura:
//  evaluar-zona            (evaluación normal y modo viaje)
//  evaluar-emergencia-viaje(alertas durante el modo viaje)
//
// Todo usa el service role: las políticas RLS no aplican aquí.

export interface RespuestaRest<T> {
  data: T | null;
  error: string | null;
}

export type RestClient = <T>(
  metodo: string,
  path: string,
  cuerpo?: unknown,
  extraHeaders?: Record<string, string>,
) => Promise<RespuestaRest<T>>;

/** Cliente REST contra /rest/v1 con la service key. */
export function crearRest(supabaseUrl: string, serviceKey: string): RestClient {
  return async function rest<T>(
    metodo: string,
    path: string,
    cuerpo?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<RespuestaRest<T>> {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: metodo,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
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
  };
}

/** Distancia en metros entre dos puntos (Haversine). */
export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (g: number) => (g * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nombre completo del usuario ("Juan Pérez") o cadena vacía. */
export async function nombreDe(rest: RestClient, idUsuario: string): Promise<string> {
  const { data } = await rest<{ nombre: string; apellidopa: string; apellidoma: string }>(
    "GET",
    `usuario?select=nombre,apellidopa,apellidoma&id=eq.${idUsuario}&limit=1`,
  );
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) return "";
  return `${fila.nombre || ""} ${fila.apellidopa || ""} ${fila.apellidoma || ""}`.trim();
}

/** Ids de usuario de los cuidadores vinculados a un adulto. */
export async function cuidadoresDe(rest: RestClient, idAdulto: string): Promise<string[]> {
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

/** Tokens FCM activos de un grupo de usuarios. */
export async function tokensDe(rest: RestClient, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await rest<{ token: string }[]>(
    "GET",
    `push_tokens?select=token&id_usuario=in.(${ids.join(",")})`,
  );
  if (!Array.isArray(data)) return [];
  return [...new Set(data.map((t) => t.token).filter((t) => typeof t === "string" && t))];
}

/** Pausa de modo viaje vigente para un adulto, o null. */
export async function viajeActivo(
  rest: RestClient,
  idAdulto: string,
): Promise<{ termina_en: string | null } | null> {
  const { data } = await rest<{ termina_en: string | null }[]>(
    "GET",
    `zona_viaje?select=termina_en&id_usuario=eq.${idAdulto}&order=creada_en.desc&limit=10`,
  );
  if (!Array.isArray(data)) return null;

  const ahora = Date.now();
  // Se filtra en el cliente: evita trampas con filtros PostgREST de fecha.
  return data.find((f) => !f.termina_en || Date.parse(f.termina_en) > ahora) || null;
}

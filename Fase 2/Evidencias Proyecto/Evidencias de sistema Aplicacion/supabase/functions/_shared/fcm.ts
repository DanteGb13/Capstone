// Utilidades FCM compartidas por las Edge Functions de push.

export interface DatosPush {
  [clave: string]: string;
}

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") || "siemprecerca-ad020";

export function canalDe(datos: DatosPush | undefined, porDefecto = "sos-alertas"): string {
  const canal = datos?.canal;
  return typeof canal === "string" && canal.trim() ? canal.trim() : porDefecto;
}

/** FCM ya no conoce ese token (app desinstalada o token rotado). */
export function esTokenNoRegistrado(error: string | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return e.includes("unregistered") || e.includes("notregistered");
}

export async function enviarPushFirebase(
  token: string,
  titulo: string,
  cuerpo: string,
  datos: DatosPush | undefined,
  canal?: string,
): Promise<{ ok: boolean; error?: string }> {
  const canalFinal = canal || canalDe(datos);

  const payload = {
    message: {
      token: token,
      notification: {
        title: titulo,
        body: cuerpo,
      },
      data: datos || {},
      android: {
        priority: "high",
        notification: {
          channel_id: canalFinal,
        },
      },
    },
  };

  try {
    const accessToken = await getAccessToken();
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const result = await response.json();
    if (!response.ok) {
      console.error("Firebase error:", JSON.stringify(result));
      return { ok: false, error: JSON.stringify(result) };
    }

    return { ok: true };
  } catch (e) {
    console.error("Error enviando push:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

async function getAccessToken(): Promise<string> {
  const rawKey = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY") || "";

  if (!rawKey || rawKey.length < 100) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY no configurado o muy corto (length: " + rawKey.length + ")");
  }

  let sa;
  try {
    sa = JSON.parse(rawKey);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY no es JSON válido");
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account falta client_email/private_key");
  }

  const now = Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const pemBody = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const dataToSign = `${header}.${payload}`;
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    encoder.encode(dataToSign),
  );

  const jwt = `${dataToSign}.${base64UrlEncode(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("No se obtuvo access_token: " + (data.error_description || data.error || JSON.stringify(data)));
  }

  return data.access_token;
}

function base64UrlEncode(input: string | Uint8Array): string {
  let b64: string;
  if (typeof input === "string") {
    b64 = btoa(input);
  } else {
    b64 = btoa(String.fromCharCode(...input));
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

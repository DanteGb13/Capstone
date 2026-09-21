import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface PushRequest {
  token: string;
  titulo: string;
  cuerpo: string;
  data?: Record<string, any>;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

function jsonResponse(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
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

    console.log("=== SOS PUSH REQUEST ===");
    console.log("Token:", token?.substring(0, 20) + "...");
    console.log("Titulo:", titulo);

    if (!token || !titulo || !cuerpo) {
      return jsonResponse(400, { error: "Faltan campos: token, titulo, cuerpo" });
    }

    const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID") || "siemprecerca-ad020";
    const firebaseUrl = `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`;

    const payload = {
      message: {
        token: token,
        notification: {
          title: titulo,
          body: cuerpo,
        },
        data: data || {},
        android: {
          priority: "high",
          notification: {
            channel_id: "sos-alertas",
          },
        },
      },
    };

    console.log("Obteniendo access token de Firebase...");
    const accessToken = await getAccessToken();
    console.log("Access token OK, length:", accessToken?.length);

    console.log("Enviando push a Firebase...");
    const response = await fetch(firebaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    console.log("Firebase response:", response.status, JSON.stringify(result));

    if (!response.ok) {
      console.error("Firebase error:", result);
      return jsonResponse(500, { error: "Error enviando push", details: result });
    }

    return jsonResponse(200, { success: true, messageId: result.name });
  } catch (e) {
    console.error("Error:", e?.message || e);
    return jsonResponse(500, { error: "Internal server error", details: e?.message || String(e) });
  }
});

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
    throw new Error("Service account falta client_email o private_key");
  }

  console.log("Service account email:", sa.client_email);
  console.log("Private key length:", sa.private_key.length);

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
    ["sign"]
  );

  const dataToSign = `${header}.${payload}`;
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(dataToSign)
  );

  const jwt = `${dataToSign}.${base64UrlEncode(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json();

  if (!data.access_token) {
    console.error("OAuth error:", data);
    throw new Error("No se obtuvo access_token: " + (data.error_description || data.error || JSON.stringify(data)));
  }

  return data.access_token;
}

function base64UrlEncode(input: string | Uint8Array): string {
  let base64: string;
  if (typeof input === "string") {
    base64 = btoa(input);
  } else {
    base64 = btoa(String.fromCharCode(...input));
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

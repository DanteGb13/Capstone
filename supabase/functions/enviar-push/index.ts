import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREBASE_SERVER_KEY = Deno.env.get("FIREBASE_SERVER_KEY")!;

interface PushRequest {
  token: string;
  titulo: string;
  cuerpo: string;
  data?: Record<string, any>;
}

serve(async (req) => {
  try {
    // CORS
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body: PushRequest = await req.json();
    const { token, titulo, cuerpo, data } = body;

    if (!token || !titulo || !cuerpo) {
      return new Response(
        JSON.stringify({ error: "Faltan campos: token, titulo, cuerpo" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Enviar push via Firebase HTTP v1
    const firebaseUrl = `https://fcm.googleapis.com/v1/projects/${SUPABASE_URL.split("//")[1].split(".")[0]}/messages:send`;

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
            priority: "max",
            default_vibrate_timings: true,
            default_sound: true,
          },
        },
      },
    };

    // Obtener access token de Firebase
    const accessToken = await getAccessToken();

    const response = await fetch(firebaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Firebase error:", result);
      return new Response(
        JSON.stringify({ error: "Error enviando push", details: result }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, messageId: result.name }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// =====================================================
// OBTENER ACCESS TOKEN DE FIREBASE
// =====================================================

async function getAccessToken(): Promise<string> {
  // Usar service account key de Firebase
  const serviceAccountKey = JSON.parse(
    Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY") || "{}"
  );

  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  // JWT header
  const header = btoa(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).replace(/=/g, "");

  // JWT payload
  const payload = btoa(
    JSON.stringify({
      iss: serviceAccountKey.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: expiry,
    })
  ).replace(/=/g, "");

  // Firmar con RSA-SHA256
  const encoder = new TextEncoder();
  const keyData = encoder.encode(serviceAccountKey.private_key);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(`${header}.${payload}`)
  );

  const jwt = `${header}.${payload}.${btoa(
    String.fromCharCode(...new Uint8Array(signature))
  ).replace(/=/g, "")}`;

  // Intercambiar JWT por access token
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json();
  return data.access_token;
}

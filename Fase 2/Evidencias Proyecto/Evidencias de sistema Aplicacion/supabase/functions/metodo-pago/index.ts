import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CARD_ENCRYPTION_KEY = Deno.env.get("CARD_ENCRYPTION_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function soloDigitos(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

function esLuhn(numero: string): boolean {
  let suma = 0;
  let duplicar = false;
  for (let i = numero.length - 1; i >= 0; i--) {
    let digito = Number(numero[i]);
    if (duplicar) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    suma += digito;
    duplicar = !duplicar;
  }
  return suma > 0 && suma % 10 === 0;
}

function marcaTarjeta(numero: string): string {
  if (/^4/.test(numero)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(numero)) return "Mastercard";
  if (/^3[47]/.test(numero)) return "American Express";
  return "Tarjeta";
}

function bytesABase64(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

function base64ABytes(valor: string): Uint8Array {
  const binario = atob(valor);
  return Uint8Array.from(binario, (caracter) => caracter.charCodeAt(0));
}

async function derivarClave(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(CARD_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function cifrar(valor: string): Promise<{ cifra: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clave = await derivarClave();
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    clave,
    new TextEncoder().encode(valor),
  );
  return { cifra: bytesABase64(new Uint8Array(cifrado)), iv: bytesABase64(iv) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return respuesta(200, {});
  if (request.method !== "POST") return respuesta(405, { error: "Método no permitido" });

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respuesta(401, { error: "Se requiere una sesión iniciada" });
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !CARD_ENCRYPTION_KEY) {
    return respuesta(500, { error: "Falta configurar el cifrado de tarjetas en el servidor" });
  }

  let datos: Record<string, unknown>;
  try {
    datos = await request.json();
  } catch {
    return respuesta(400, { error: "Datos inválidos" });
  }

  const clienteUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const autenticacion = await clienteUsuario.auth.getUser();
  if (autenticacion.error || !autenticacion.data.user) {
    return respuesta(401, { error: "La sesión no es válida" });
  }

  const usuarioId = autenticacion.data.user.id;
  const clienteAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (datos.accion === "guardar") {
      const numero = soloDigitos(datos.numero);
      const titular = String(datos.titular ?? "").trim();
      const mes = Number(datos.mes_expiracion);
      const ano = Number(datos.ano_expiracion);
      const cvv = soloDigitos(datos.cvv);
      if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/.test(titular)) {
        return respuesta(400, { error: "El nombre del titular solo puede contener letras" });
      }

      if (!numero && datos.editar === true) {
        if (!titular || titular.length > 80) {
          return respuesta(400, { error: "Ingresa el nombre del titular" });
        }
        if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
          return respuesta(400, { error: "El mes de expiración no es válido" });
        }
        const hoy = new Date();
        if (!Number.isInteger(ano) || ano < hoy.getFullYear() || ano > 2100 ||
            (ano === hoy.getFullYear() && mes < hoy.getMonth() + 1)) {
          return respuesta(400, { error: "La tarjeta está vencida" });
        }

        const { data, error } = await clienteAdmin.from("metodo_pago").update({
          mes_expiracion: mes,
          ano_expiracion: ano,
          titular,
          es_predeterminado: datos.predeterminado !== false,
          actualizada_en: new Date().toISOString(),
        }).eq("usuario_id", usuarioId).select(
          "id, marca, ultimos_cuatro, mes_expiracion, ano_expiracion, titular, es_predeterminado",
        ).single();
        if (error) return respuesta(500, { error: "No se pudo editar el método de pago" });
        return respuesta(200, { ok: true, metodo: data });
      }

      if (numero.length < 13 || numero.length > 19 || !esLuhn(numero)) {
        return respuesta(400, { error: "El número de tarjeta no es válido" });
      }
      if (!titular || titular.length > 80) {
        return respuesta(400, { error: "Ingresa el nombre del titular" });
      }
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
        return respuesta(400, { error: "El mes de expiración no es válido" });
      }
      const hoy = new Date();
      if (!Number.isInteger(ano) || ano < hoy.getFullYear() || ano > 2100 ||
          (ano === hoy.getFullYear() && mes < hoy.getMonth() + 1)) {
        return respuesta(400, { error: "La tarjeta está vencida" });
      }
      if (cvv.length < 3 || cvv.length > 4) {
        return respuesta(400, { error: "El código de seguridad no es válido" });
      }

      const cifrado = await cifrar(numero);
      const { data, error } = await clienteAdmin.from("metodo_pago").upsert({
        usuario_id: usuarioId,
        tipo: "tarjeta",
        marca: marcaTarjeta(numero),
        ultimos_cuatro: numero.slice(-4),
        mes_expiracion: mes,
        ano_expiracion: ano,
        titular,
        numero_encriptado: cifrado.cifra,
        iv_encriptacion: cifrado.iv,
        es_predeterminado: datos.predeterminado !== false,
        actualizada_en: new Date().toISOString(),
      }, { onConflict: "usuario_id" }).select(
        "id, marca, ultimos_cuatro, mes_expiracion, ano_expiracion, titular, es_predeterminado",
      ).single();

      if (error) {
        console.error("No se pudo guardar el método de pago", error.message);
        return respuesta(500, { error: "No se pudo guardar el método de pago" });
        }
      return respuesta(200, { ok: true, metodo: data });
    }

    if (datos.accion === "consultar") {
      const { data, error } = await clienteAdmin.from("metodo_pago")
        .select("id, marca, ultimos_cuatro, mes_expiracion, ano_expiracion, titular, es_predeterminado")
        .eq("usuario_id", usuarioId)
        .maybeSingle();
      if (error) return respuesta(500, { error: "No se pudo consultar el método de pago" });
      return respuesta(200, { metodo: data });
    }

    if (datos.accion === "eliminar") {
      const { error } = await clienteAdmin.from("metodo_pago").delete().eq("usuario_id", usuarioId);
      if (error) return respuesta(500, { error: "No se pudo eliminar el método de pago" });
      return respuesta(200, { ok: true });
    }

    return respuesta(400, { error: "Acción inválida" });
  } catch (error) {
    console.error("Error en método de pago", error instanceof Error ? error.message : "Error inesperado");
    return respuesta(500, { error: "Ocurrió un error al procesar el método de pago" });
  }
});

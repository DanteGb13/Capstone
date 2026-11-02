import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TRANSBANK_COMMERCE_CODE = Deno.env.get("TRANSBANK_COMMERCE_CODE") ?? "";
const TRANSBANK_API_KEY = Deno.env.get("TRANSBANK_API_KEY") ?? "";
const TRANSBANK_API_URL = Deno.env.get("TRANSBANK_API_URL") ??
  "https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions";

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return respuesta(200, {});
  if (request.method !== "POST") return respuesta(405, { error: "Método no permitido" });

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return respuesta(401, { error: "Se requiere una sesión iniciada" });
  }
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !TRANSBANK_COMMERCE_CODE || !TRANSBANK_API_KEY) {
    return respuesta(500, { error: "Faltan credenciales de pago en el servidor" });
  }

  let datos: Record<string, unknown>;
  try {
    datos = await request.json();
  } catch {
    return respuesta(400, { error: "Datos inválidos" });
  }

  const accion = datos.accion;
  const clienteConToken = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: autenticacion, error: errorAuth } = await clienteConToken.auth.getUser();
  if (errorAuth || !autenticacion.user) {
    return respuesta(401, { error: "La sesión no es válida" });
  }
  const usuarioId = autenticacion.user.id;
  const clienteAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const transbankHeaders = {
    "Content-Type": "application/json",
    "Tbk-api-key-id": TRANSBANK_COMMERCE_CODE,
    "Tbk-api-key-secret": TRANSBANK_API_KEY,
  };

  function calcularPrecioMejora(
    suscripcionMensual: { inicia_en: string; vence_en: string } | null,
    precioAnual: number,
    precioMensual: number,
  ): { monto: number; credito: number } {
    if (!suscripcionMensual) return { monto: precioAnual, credito: 0 };
    const ahora = Date.now();
    const inicio = new Date(suscripcionMensual.inicia_en).getTime();
    const termino = new Date(suscripcionMensual.vence_en).getTime();
    if (!Number.isFinite(inicio) || !Number.isFinite(termino) || termino <= ahora) {
      return { monto: precioAnual, credito: 0 };
    }
    const diasTotales = Math.max(1, (termino - inicio) / 86_400_000);
    const diasRestantes = Math.max(0, (termino - ahora) / 86_400_000);
    const creditoExacto = Math.min(
      precioMensual,
      Math.round(precioMensual * diasRestantes / diasTotales),
    );
    const credito = Math.min(
      precioMensual,
      Math.round(creditoExacto / 1000) * 1000,
    );
    return {
      monto: Math.max(1, precioAnual - credito),
      credito,
    };
  }

  try {
    if (accion === "crear") {
      const planCodigo = String(datos.plan ?? "");
      const returnUrl = String(datos.return_url ?? "");
      if (!["mensual", "anual"].includes(planCodigo)) {
        return respuesta(400, { error: "Plan inválido" });
      }
      const retornoPermitido = (() => {
        try {
          const url = new URL(returnUrl);
          return url.protocol === "https:" ||
            (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
        } catch {
          return false;
        }
      })();
      if (!retornoPermitido) {
        return respuesta(400, { error: "La URL de retorno debe usar HTTPS" });
      }

      const { data: plan, error: errorPlan } = await clienteAdmin
        .from("plan_suscripcion")
        .select("codigo, precio_clp, duracion_dias, activo")
        .eq("codigo", planCodigo)
        .eq("activo", true)
        .single();
      if (errorPlan || !plan) return respuesta(400, { error: "El plan no está disponible" });

      let montoCobrar = Number(plan.precio_clp);
      let creditoProrrateado = 0;
      let tipoTransaccion = "nueva";
      const { data: mensualActual } = await clienteAdmin
        .from("suscripcion")
        .select("id, inicia_en, vence_en")
        .eq("usuario_id", usuarioId)
        .eq("plan_codigo", "mensual")
        .eq("estado", "activa")
        .gt("vence_en", new Date().toISOString())
        .order("vence_en", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (planCodigo === "anual" && mensualActual) {
        const { data: planMensual } = await clienteAdmin
          .from("plan_suscripcion")
          .select("precio_clp")
          .eq("codigo", "mensual")
          .single();
        if (planMensual) {
          const mejora = calcularPrecioMejora(
            mensualActual,
            Number(plan.precio_clp),
            Number(planMensual.precio_clp),
          );
          montoCobrar = mejora.monto;
          creditoProrrateado = mejora.credito;
          tipoTransaccion = "mejora";
        }
      }

      const { data: suscripcion } = await clienteAdmin
        .from("suscripcion")
        .upsert({ usuario_id: usuarioId, plan_codigo: planCodigo, estado: "pendiente" }, {
          onConflict: "usuario_id,plan_codigo",
        })
        .select("id")
        .single();

      const buyOrder = `SC-${usuarioId.slice(0, 8)}-${Date.now()}`;
      const webpay = await fetch(TRANSBANK_API_URL, {
        method: "POST",
        headers: transbankHeaders,
        body: JSON.stringify({
          buy_order: buyOrder,
          session_id: usuarioId,
          amount: montoCobrar,
          return_url: returnUrl,
        }),
      });
      const contenido = await webpay.json();
      if (!webpay.ok) {
        console.error("Transbank create error", contenido);
        return respuesta(502, { error: "No se pudo iniciar el pago" });
      }

      const token = String(contenido.token);
      const url = String(contenido.url);
      const { error: errorTransaccion } = await clienteAdmin
        .from("transaccion_pago")
        .insert({
          usuario_id: usuarioId,
          suscripcion_id: suscripcion?.id ?? null,
          plan_codigo: planCodigo,
          buy_order: buyOrder,
          token_transbank: token,
          monto: montoCobrar,
          monto_original_clp: plan.precio_clp,
          credito_prorrateado_clp: creditoProrrateado,
          tipo: tipoTransaccion,
          estado: "creada",
        });
      if (errorTransaccion) {
        console.error("Transacción local no creada", errorTransaccion);
        return respuesta(500, { error: "No se pudo registrar el pago" });
      }

      return respuesta(200, { ok: true, token, url });
    }

    if (accion === "consultar_mejora") {
      const [{ data: mensualActual }, { data: planAnual }, { data: planMensual }] = await Promise.all([
        clienteAdmin
          .from("suscripcion")
          .select("inicia_en, vence_en")
          .eq("usuario_id", usuarioId)
          .eq("plan_codigo", "mensual")
          .eq("estado", "activa")
          .gt("vence_en", new Date().toISOString())
          .order("vence_en", { ascending: false })
          .limit(1)
          .maybeSingle(),
        clienteAdmin
          .from("plan_suscripcion")
          .select("precio_clp")
          .eq("codigo", "anual")
          .eq("activo", true)
          .single(),
        clienteAdmin
          .from("plan_suscripcion")
          .select("precio_clp")
          .eq("codigo", "mensual")
          .eq("activo", true)
          .single(),
      ]);
      if (!mensualActual || !planAnual || !planMensual) {
        return respuesta(200, {
          disponible: false,
          monto: Number(planAnual?.precio_clp ?? 70000),
          precio_completo: Number(planAnual?.precio_clp ?? 70000),
          credito: 0,
        });
      }
      const mejora = calcularPrecioMejora(
        mensualActual,
        Number(planAnual.precio_clp),
        Number(planMensual.precio_clp),
      );
      return respuesta(200, {
        disponible: true,
        monto: mejora.monto,
        precio_completo: Number(planAnual.precio_clp),
        credito: mejora.credito,
      });
    }

    if (accion === "confirmar") {
      const token = String(datos.token ?? "");
      if (!token) return respuesta(400, { error: "Falta el token de pago" });

      const { data: transaccion, error: errorTransaccion } = await clienteAdmin
        .from("transaccion_pago")
        .select("id, usuario_id, suscripcion_id, plan_codigo, monto, estado, token_transbank")
        .eq("token_transbank", token)
        .eq("usuario_id", usuarioId)
        .maybeSingle();
      if (errorTransaccion || !transaccion) {
        return respuesta(404, { error: "La transacción no existe" });
      }
      if (transaccion.estado === "autorizada") {
        return respuesta(200, { ok: true, estado: "autorizada" });
      }
      if (transaccion.estado === "rechazada" || transaccion.estado === "anulada") {
        return respuesta(200, { ok: false, estado: transaccion.estado });
      }

      const webpay = await fetch(`${TRANSBANK_API_URL}/${encodeURIComponent(token)}`, {
        method: "PUT",
        headers: transbankHeaders,
      });
      const resultado = await webpay.json();
      if (!webpay.ok) {
        console.error("Transbank commit error", resultado);
        return respuesta(502, { error: "No se pudo confirmar el pago" });
      }

      const autorizada = resultado.response_code === 0 && resultado.status === "AUTHORIZED";
      if (!autorizada) {
        await clienteAdmin
          .from("transaccion_pago")
          .update({
            estado: "rechazada",
            respuesta_transbank: resultado,
            actualizada_en: new Date().toISOString(),
          })
          .eq("id", transaccion.id);
        return respuesta(200, { ok: false, estado: "rechazada", transbank: resultado });
      }

      const { data: plan } = await clienteAdmin
        .from("plan_suscripcion")
        .select("duracion_dias, precio_clp")
        .eq("codigo", transaccion.plan_codigo)
        .single();
      let montoEsperado = Number(plan?.precio_clp ?? 0);
      let mensualAnteriorId: string | null = null;
      let creditoProrrateado = 0;

      if (transaccion.plan_codigo === "anual") {
        const { data: mensualActual } = await clienteAdmin
          .from("suscripcion")
          .select("id, inicia_en, vence_en")
          .eq("usuario_id", usuarioId)
          .eq("plan_codigo", "mensual")
          .eq("estado", "activa")
          .gt("vence_en", new Date().toISOString())
          .order("vence_en", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mensualActual) {
          const { data: planMensual } = await clienteAdmin
            .from("plan_suscripcion")
            .select("precio_clp")
            .eq("codigo", "mensual")
            .single();
          if (planMensual && plan) {
            const mejora = calcularPrecioMejora(
              mensualActual,
              Number(plan.precio_clp),
              Number(planMensual.precio_clp),
            );
            montoEsperado = mejora.monto;
            creditoProrrateado = mejora.credito;
            mensualAnteriorId = mensualActual.id;
          }
        }
      }

      if (!plan || Number(resultado.amount) !== Number(transaccion.monto) ||
        Number(resultado.amount) !== montoEsperado) {
        return respuesta(409, { error: "El monto confirmado no coincide con el plan" });
      }

      await clienteAdmin
        .from("transaccion_pago")
        .update({
          estado: "autorizada",
          respuesta_transbank: resultado,
          monto_original_clp: plan.precio_clp,
          credito_prorrateado_clp: creditoProrrateado,
          tipo: mensualAnteriorId ? "mejora" : "nueva",
          actualizada_en: new Date().toISOString(),
        })
        .eq("id", transaccion.id);

      const inicia = new Date();
      const vence = new Date(inicia);
      vence.setDate(vence.getDate() + plan.duracion_dias);
      await clienteAdmin
        .from("suscripcion")
        .update({
          estado: "activa",
          inicia_en: inicia.toISOString(),
          vence_en: vence.toISOString(),
          credito_prorrateado_clp: creditoProrrateado,
          actualizada_en: new Date().toISOString(),
        })
        .eq("id", transaccion.suscripcion_id);
      if (mensualAnteriorId) {
        await clienteAdmin
          .from("suscripcion")
          .update({
            estado: "cancelada",
            cancelada_en: new Date().toISOString(),
            actualizada_en: new Date().toISOString(),
          })
          .eq("id", mensualAnteriorId);
      }

      return respuesta(200, { ok: true, estado: "autorizada", vence_en: vence.toISOString() });
    }

    if (accion === "cancelar") {
      const { data: suscripcion, error: errorSuscripcion } = await clienteAdmin
        .from("suscripcion")
        .select("id, inicia_en, vence_en, cancelacion_programada_en")
        .eq("usuario_id", usuarioId)
        .eq("estado", "activa")
        .order("inicia_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (errorSuscripcion || !suscripcion?.inicia_en) {
        return respuesta(404, { error: "No tienes una suscripción activa" });
      }

      function diasHabilesDesde(fechaInicio: string): number {
        let cursor = new Date(fechaInicio);
        const ahora = new Date();
        let habiles = 0;
        while (cursor <= ahora && habiles <= 8) {
          cursor.setDate(cursor.getDate() + 1);
          const dia = cursor.getDay();
          if (dia !== 0 && dia !== 6) habiles++;
        }
        return habiles;
      }

      if (diasHabilesDesde(suscripcion.inicia_en) <= 7) {
        const { data: transaccion } = await clienteAdmin
          .from("transaccion_pago")
          .select("token_transbank, monto")
          .eq("suscripcion_id", suscripcion.id)
          .eq("estado", "autorizada")
          .order("creada_en", { ascending: false })
          .limit(1)
          .maybeSingle();

        let devolucionEstado = "programada";
        if (transaccion?.token_transbank && transaccion.monto) {
          const refund = await fetch(`${TRANSBANK_API_URL}/${encodeURIComponent(transaccion.token_transbank)}/refunds`, {
            method: "POST",
            headers: transbankHeaders,
            body: JSON.stringify({ amount: transaccion.monto }),
          });
          if (!refund.ok) {
            console.error("Transbank refund error", await refund.text());
            devolucionEstado = "pendiente";
          }
        }

        const { error } = await clienteAdmin
          .from("suscripcion")
          .update({
            estado: "cancelada",
            cancelada_en: new Date().toISOString(),
            devolucion_solicitada_en: new Date().toISOString(),
            devolucion_estado: devolucionEstado,
            cancelacion_programada_en: null,
            actualizada_en: new Date().toISOString(),
          })
          .eq("id", suscripcion.id);
        if (error) return respuesta(500, { error: "No se pudo anular la suscripción" });
        return respuesta(200, {
          ok: true,
          modo: "inmediata",
          estado: "cancelada",
          devolucion: "La devolución será procesada dentro de 48 horas hábiles.",
        });
      }

      const { error } = await clienteAdmin
        .from("suscripcion")
        .update({
          cancelacion_programada_en: suscripcion.vence_en,
          actualizada_en: new Date().toISOString(),
        })
        .eq("id", suscripcion.id);
      if (error) return respuesta(500, { error: "No se pudo programar la cancelación" });
      return respuesta(200, {
        ok: true,
        modo: "al_finalizar",
        estado: "activa",
        termina_en: suscripcion.vence_en,
        devolucion: "Sin devolución por haber cancelado después del período de reembolso.",
      });
    }

    if (accion === "consultar_cancelacion") {
      const { data: suscripcion, error } = await clienteAdmin
        .from("suscripcion")
        .select("inicia_en")
        .eq("usuario_id", usuarioId)
        .eq("estado", "activa")
        .order("inicia_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !suscripcion?.inicia_en) {
        return respuesta(404, { error: "No tienes una suscripción activa" });
      }

      let cursor = new Date(suscripcion.inicia_en);
      const ahora = new Date();
      let habiles = 0;
      while (cursor <= ahora && habiles <= 8) {
        cursor.setDate(cursor.getDate() + 1);
        const dia = cursor.getDay();
        if (dia !== 0 && dia !== 6) habiles++;
      }
      return respuesta(200, { reembolso: habiles <= 7 });
    }

    return respuesta(400, { error: "Acción inválida" });
  } catch (error) {
    console.error(error);
    return respuesta(500, { error: "Error interno del servidor" });
  }
});

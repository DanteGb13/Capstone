import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TRANSBANK_API_URL = Deno.env.get("TRANSBANK_API_URL") ?? "";
const TRANSBANK_COMMERCE_CODE = Deno.env.get("TRANSBANK_COMMERCE_CODE") ?? "";
const TRANSBANK_API_KEY = Deno.env.get("TRANSBANK_API_KEY") ?? "";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

/** Qué suscripción representa mejor a un cuidador cuando tiene más de una. */
function prioridadSuscripcion(estado: unknown): number {
  if (estado === "activa") return 3;
  return 1; // cancelada o vencida
}

function esMejorSuscripcion(candidata: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  const prioridadCandidata = prioridadSuscripcion(candidata.estado);
  const prioridadActual = prioridadSuscripcion(actual.estado);
  if (prioridadCandidata !== prioridadActual) return prioridadCandidata > prioridadActual;
  // Mismo estado: manda la que se actualizó más tarde.
  return String(candidata.actualizada_en ?? "") > String(actual.actualizada_en ?? "");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return respuesta(200, {});
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respuesta(401, { error: "Se requiere sesión iniciada" });

  let datos: Record<string, unknown>;
  try { datos = await request.json(); } catch { return respuesta(400, { error: "Datos inválidos" }); }

  const clienteUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: usuario, error } = await clienteUsuario.auth.getUser();
  if (error || !usuario.user) return respuesta(401, { error: "Sesión inválida" });
  const { data: administrador } = await clienteUsuario.rpc("es_administrador");
  if (!administrador) return respuesta(403, { error: "Solo administradores pueden gestionar suscripciones" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const accion = String(datos.accion ?? "");

  if (accion === "listar") {
    // La lista parte de los CUIDADORES (rol "Familiar"), no de las
    // suscripciones: son ellos quienes compran las licencias, así que el
    // panel debe mostrar a todos —tengan o no suscripción— para ver quién
    // falta por comprar y poder activarle una a mano cuando corresponda.
    const { data: rolCuidador, error: errorRol } = await admin
      .from("rol")
      .select("id")
      .eq("nombre", "Familiar")
      .maybeSingle();
    if (errorRol) {
      console.error("admin-suscripciones listar rol:", errorRol);
      return respuesta(500, { error: "No se pudieron cargar los cuidadores", detalle: errorRol.message });
    }
    if (!rolCuidador) return respuesta(200, { suscripciones: [] });

    const { data: perfiles, error: errorPerfiles } = await admin
      .from("usuario")
      .select("id, nombre, apellidopa")
      .eq("id_rol", rolCuidador.id)
      .order("nombre", { ascending: true });
    if (errorPerfiles) {
      console.error("admin-suscripciones listar perfiles:", errorPerfiles);
      return respuesta(500, { error: "No se pudieron cargar los cuidadores", detalle: errorPerfiles.message });
    }

    const nombres = new Map<string, string>();
    const correos = new Map<string, string>();
    // Una suscripción por cuidador: si quedaron dos filas (mensual y anual
    // durante una mejora) gana la activa, luego la pendiente y finalmente la
    // cancelada/vencida más reciente.
    const mejorSuscripcion = new Map<string, Record<string, unknown>>();
    const ids = (perfiles ?? []).map((perfil) => perfil.id);

    for (const perfil of perfiles ?? []) {
      nombres.set(perfil.id, [perfil.nombre, perfil.apellidopa].filter(Boolean).join(" ").trim());
    }

    if (ids.length) {
      const { data: suscripciones, error: errorSuscripciones } = await admin
        .from("suscripcion")
        .select("id, usuario_id, plan_codigo, estado, inicia_en, vence_en, mejora_en, plan_anterior_codigo, actualizada_en")
        .in("usuario_id", ids);
      if (errorSuscripciones) {
        console.error("admin-suscripciones listar suscripcion:", errorSuscripciones);
        return respuesta(500, { error: "No se pudieron cargar las suscripciones", detalle: errorSuscripciones.message });
      }

      for (const fila of suscripciones ?? []) {
        // 'pendiente' es una compra a medias (la fila se crea al iniciar el
        // pago en Transbank): no cuenta como suscripción, el cuidador sigue
        // apareciendo como "sin plan" hasta que el pago se confirma.
        if (fila.estado === "pendiente") continue;
        const actual = mejorSuscripcion.get(fila.usuario_id);
        if (!actual || esMejorSuscripcion(fila, actual)) mejorSuscripcion.set(fila.usuario_id, fila);
      }

      const listado = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!listado.error) {
        for (const cuenta of listado.data?.users ?? []) {
          if (ids.includes(cuenta.id)) correos.set(cuenta.id, cuenta.email ?? "");
        }
      }
    }

    return respuesta(200, {
      suscripciones: (perfiles ?? []).map(perfil => {
        const suscripcion = mejorSuscripcion.get(perfil.id);
        return {
          id: suscripcion?.id ?? null,
          usuario_id: perfil.id,
          nombre: nombres.get(perfil.id) ?? "",
          correo: correos.get(perfil.id) ?? "",
          plan_codigo: suscripcion?.plan_codigo ?? null,
          estado: suscripcion?.estado ?? "sin_suscripcion",
          inicia_en: suscripcion?.inicia_en ?? null,
          vence_en: suscripcion?.vence_en ?? null,
          mejora_en: suscripcion?.mejora_en ?? null,
          plan_anterior_codigo: suscripcion?.plan_anterior_codigo ?? null,
        };
      }),
    });
  }

  if (accion === "revertir_mejora") {
    const suscripcionId = String(datos.suscripcion_id ?? "");
    const { data: mejora, error: errorMejora } = await admin
      .from("suscripcion")
      .select("id, usuario_id, plan_codigo, mejora_en, plan_anterior_codigo, plan_anterior_inicia_en, plan_anterior_vence_en")
      .eq("id", suscripcionId)
      .eq("plan_codigo", "anual")
      .eq("estado", "activa")
      .maybeSingle();
    if (errorMejora || !mejora?.mejora_en || mejora.plan_anterior_codigo !== "mensual") {
      return respuesta(404, { error: "No hay una mejora anual elegible para revertir" });
    }

    const inicioMejora = new Date(mejora.mejora_en);
    let cursor = new Date(inicioMejora);
    const ahora = new Date();
    let diasHabiles = 0;
    while (cursor <= ahora && diasHabiles <= 7) {
      cursor.setDate(cursor.getDate() + 1);
      const dia = cursor.getDay();
      if (dia !== 0 && dia !== 6) diasHabiles++;
    }
    if (diasHabiles > 7) return respuesta(409, { error: "El plazo de 7 días hábiles ya terminó" });

    const { data: transaccion } = await admin
      .from("transaccion_pago")
      .select("token_transbank, monto, tipo")
      .eq("suscripcion_id", mejora.id)
      .eq("estado", "autorizada")
      .eq("tipo", "mejora")
      .order("creada_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (transaccion?.token_transbank) {
      const refund = await fetch(`${TRANSBANK_API_URL}/${encodeURIComponent(transaccion.token_transbank)}/refunds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tbk-api-key-id": TRANSBANK_COMMERCE_CODE,
          "Tbk-api-key-secret": TRANSBANK_API_KEY,
        },
        body: JSON.stringify({ amount: transaccion.monto }),
      });
      if (!refund.ok) return respuesta(502, { error: "Transbank no pudo procesar la reversión" });
    }

    await admin.from("suscripcion").update({
      estado: "cancelada",
      cancelada_en: new Date().toISOString(),
      actualizada_en: new Date().toISOString(),
    }).eq("id", mejora.id);

    const { error: mensualError } = await admin.from("suscripcion").upsert({
      usuario_id: mejora.usuario_id,
      plan_codigo: "mensual",
      estado: "activa",
      inicia_en: mejora.plan_anterior_inicia_en,
      vence_en: mejora.plan_anterior_vence_en,
      plan_anterior_codigo: null,
      mejora_en: null,
      actualizada_en: new Date().toISOString(),
    }, { onConflict: "usuario_id,plan_codigo" });
    if (mensualError) return respuesta(500, { error: "No se pudo restaurar el plan mensual" });

    return respuesta(200, { ok: true });
  }

  if (accion === "activar" || accion === "cancelar") {
    const suscripcionId = String(datos.suscripcion_id ?? "");
    const usuarioId = String(datos.usuario_id ?? "");
    const planSolicitado = String(datos.plan_codigo ?? "mensual");
    // Lista blanca corta: sólo existen estos dos planes (ver migración
    // 20261102000000_pagos_suscripciones.sql).
    const planCodigo = planSolicitado === "anual" ? "anual" : "mensual";

    let suscripcion: { id: string; usuario_id: string; plan_codigo: string } | null = null;

    if (suscripcionId) {
      const { data } = await admin
        .from("suscripcion")
        .select("id, usuario_id, plan_codigo")
        .eq("id", suscripcionId)
        .maybeSingle();
      suscripcion = data ?? null;
    } else if (accion === "activar" && usuarioId) {
      // Cuidador sin licencia todavía: se busca la fila del plan elegido y,
      // si no existe, se crea antes de activarla. Sólo se le puede activar a
      // un cuidador (rol "Familiar"), que es quien compra las licencias.
      const { data: cuidador } = await admin
        .from("usuario")
        .select("id, rol(nombre)")
        .eq("id", usuarioId)
        .maybeSingle();
      const rolCuidador = Array.isArray(cuidador?.rol)
        ? cuidador?.rol[0]?.nombre
        : cuidador?.rol?.nombre;
      if (!cuidador || rolCuidador !== "Familiar") {
        return respuesta(404, { error: "Ese cuidador no existe" });
      }

      const { data: existente } = await admin
        .from("suscripcion")
        .select("id, usuario_id, plan_codigo")
        .eq("usuario_id", usuarioId)
        .eq("plan_codigo", planCodigo)
        .maybeSingle();

      if (existente) {
        suscripcion = existente;
      } else {
        const { data: creada, error: errorCrear } = await admin
          .from("suscripcion")
          .insert({ usuario_id: usuarioId, plan_codigo: planCodigo, estado: "pendiente" })
          .select("id, usuario_id, plan_codigo")
          .single();
        if (errorCrear || !creada) {
          console.error("admin-suscripciones crear suscripcion:", errorCrear);
          return respuesta(500, { error: "No se pudo crear la suscripción", detalle: errorCrear?.message });
        }
        suscripcion = creada;
      }
    }

    if (!suscripcion) return respuesta(404, { error: "Suscripción no encontrada" });

    if (accion === "activar") {
      const ahora = new Date();
      const vence = new Date(ahora);
      vence.setMonth(vence.getMonth() + (suscripcion.plan_codigo === "anual" ? 12 : 1));
      const { error: errorActivar } = await admin.from("suscripcion").update({
        estado: "activa",
        inicia_en: ahora.toISOString(),
        vence_en: vence.toISOString(),
        cancelada_en: null,
        cancelacion_programada_en: null,
        actualizada_en: ahora.toISOString(),
      }).eq("id", suscripcion.id);
      if (errorActivar) return respuesta(500, { error: "No se pudo activar la suscripción" });
      return respuesta(200, { ok: true });
    }

    const { error: errorCancelar } = await admin.from("suscripcion").update({
      estado: "cancelada",
      cancelada_en: new Date().toISOString(),
      actualizada_en: new Date().toISOString(),
    }).eq("id", suscripcion.id);
    if (errorCancelar) return respuesta(500, { error: "No se pudo cancelar la suscripción" });
    return respuesta(200, { ok: true });
  }

  if (accion === "mejorar") {
    // Mejora manual desde el panel: la mensual activa queda cancelada y la
    // anual se activa (o se crea), guardando el plan anterior y la fecha de
    // la mejora para que el flujo de "revertir_mejora" siga teniendo los
    // datos que necesita.
    const suscripcionId = String(datos.suscripcion_id ?? "");
    const { data: mensual } = await admin
      .from("suscripcion")
      .select("id, usuario_id, plan_codigo, estado")
      .eq("id", suscripcionId)
      .maybeSingle();
    if (!mensual || mensual.plan_codigo !== "mensual") {
      return respuesta(404, { error: "Sólo se puede mejorar una suscripción mensual" });
    }

    const ahora = new Date();
    const vence = new Date(ahora);
    vence.setMonth(vence.getMonth() + 12);

    if (mensual.estado === "activa") {
      const { error: errorCancelar } = await admin.from("suscripcion").update({
        estado: "cancelada",
        cancelada_en: ahora.toISOString(),
        actualizada_en: ahora.toISOString(),
      }).eq("id", mensual.id);
      if (errorCancelar) return respuesta(500, { error: "No se pudo mejorar el plan" });
    }

    const { error: errorAnual } = await admin.from("suscripcion").upsert({
      usuario_id: mensual.usuario_id,
      plan_codigo: "anual",
      estado: "activa",
      inicia_en: ahora.toISOString(),
      vence_en: vence.toISOString(),
      plan_anterior_codigo: "mensual",
      mejora_en: ahora.toISOString(),
      cancelada_en: null,
      actualizada_en: ahora.toISOString(),
    }, { onConflict: "usuario_id,plan_codigo" });
    if (errorAnual) return respuesta(500, { error: "No se pudo activar el plan anual" });

    return respuesta(200, { ok: true });
  }

  if (accion === "degradar") {
    // Degradar es la mejora al revés: la anual activa queda cancelada y la
    // mensual se activa (o se crea), anotando de qué plan se bajó.
    const suscripcionId = String(datos.suscripcion_id ?? "");
    const { data: anual } = await admin
      .from("suscripcion")
      .select("id, usuario_id, plan_codigo, estado")
      .eq("id", suscripcionId)
      .maybeSingle();
    if (!anual || anual.plan_codigo !== "anual") {
      return respuesta(404, { error: "Sólo se puede degradar una suscripción anual" });
    }

    const ahora = new Date();
    const vence = new Date(ahora);
    vence.setMonth(vence.getMonth() + 1);

    if (anual.estado === "activa") {
      const { error: errorCancelar } = await admin.from("suscripcion").update({
        estado: "cancelada",
        cancelada_en: ahora.toISOString(),
        actualizada_en: ahora.toISOString(),
      }).eq("id", anual.id);
      if (errorCancelar) return respuesta(500, { error: "No se pudo degradar el plan" });
    }

    const { error: errorMensual } = await admin.from("suscripcion").upsert({
      usuario_id: anual.usuario_id,
      plan_codigo: "mensual",
      estado: "activa",
      inicia_en: ahora.toISOString(),
      vence_en: vence.toISOString(),
      plan_anterior_codigo: "anual",
      mejora_en: null,
      cancelada_en: null,
      actualizada_en: ahora.toISOString(),
    }, { onConflict: "usuario_id,plan_codigo" });
    if (errorMensual) return respuesta(500, { error: "No se pudo activar el plan mensual" });

    return respuesta(200, { ok: true });
  }

  if (accion === "pagos") {
    // Historial de pagos.
    //
    // · Con `usuario_id`: los de un cuidador (lo abre el ojito).
    // · Con `usuario_ids`: los de esos cuidadores, que son los que pasan los
    //   filtros de la ventana de descarga (los arma la página con los mismos
    //   filtros que usa la tabla).
    //
    // Corre con service role a propósito: la política de `transaccion_pago`
    // sólo deja ver las filas propias, y el panel necesita verlas todas.
    const usuarioId = String(datos.usuario_id ?? "");
    const ids = Array.isArray(datos.usuario_ids)
      ? [...new Set((datos.usuario_ids as unknown[]).map(valor => String(valor)).filter(Boolean))]
      : [];
    const plan = String(datos.plan_codigo ?? "");

    // Sin a quién buscar no se devuelve nada: mejor eso que confundirse y
    // soltar los pagos de todos.
    if (!usuarioId && !ids.length) return respuesta(200, { pagos: [], sinPagos: [] });

    let consulta = admin
      .from("transaccion_pago")
      .select("usuario_id, plan_codigo, monto, monto_original_clp, credito_prorrateado_clp, tipo, estado, buy_order, creada_en, respuesta_transbank")
      // 'creada' es un checkout que se abandonó antes de pagar: no es un
      // pago, no se muestra en el historial ni en la descarga general.
      .neq("estado", "creada")
      .order("creada_en", { ascending: false });
    if (usuarioId) consulta = consulta.eq("usuario_id", usuarioId);
    else consulta = consulta.in("usuario_id", ids);
    if (plan) consulta = consulta.eq("plan_codigo", plan);

    const { data: pagos, error: errorPagos } = await consulta;
    if (errorPagos) {
      console.error("admin-suscripciones listar pagos:", errorPagos);
      return respuesta(500, { error: "No se pudieron cargar los pagos", detalle: errorPagos.message });
    }

    // Nombre y correo de quien pagó: el nombre está en `usuario` y el correo
    // solamente en `auth.users`.
    const buscados = usuarioId ? [usuarioId] : ids;
    const nombres = new Map<string, string>();
    const correos = new Map<string, string>();

    if (buscados.length) {
      const { data: perfiles } = await admin
        .from("usuario")
        .select("id, nombre, apellidopa")
        .in("id", buscados);
      for (const perfil of perfiles ?? []) {
        nombres.set(perfil.id, [perfil.nombre, perfil.apellidopa].filter(Boolean).join(" ").trim());
      }

      const listado = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!listado.error) {
        for (const cuenta of listado.data?.users ?? []) {
          if (buscados.includes(cuenta.id)) correos.set(cuenta.id, cuenta.email ?? "");
        }
      }
    }

    const conPagos = new Set((pagos ?? []).map((fila) => fila.usuario_id));

    return respuesta(200, {
      pagos: (pagos ?? []).map(fila => ({
        usuario_id: fila.usuario_id,
        nombre: nombres.get(fila.usuario_id) ?? "",
        correo: correos.get(fila.usuario_id) ?? "",
        plan_codigo: fila.plan_codigo,
        monto: fila.monto,
        monto_original_clp: fila.monto_original_clp,
        credito_prorrateado_clp: fila.credito_prorrateado_clp,
        tipo: fila.tipo,
        estado: fila.estado,
        buy_order: fila.buy_order,
        creada_en: fila.creada_en,
        respuesta_transbank: fila.respuesta_transbank ?? null,
      })),
      // Cuidadores sin ningún pago: la descarga general los incluye igual.
      sinPagos: ids
        .filter(id => !conPagos.has(id))
        .map(id => ({
          usuario_id: id,
          nombre: nombres.get(id) ?? "",
          correo: correos.get(id) ?? "",
        })),
    });
  }

  return respuesta(400, { error: "Acción inválida" });
});

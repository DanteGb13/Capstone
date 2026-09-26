package io.ionic.starter;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Evalúa las zonas seguras CON LA APP CERRADA.
 *
 * El servicio de ubicación llama a este código en cada fix de posición.
 * No se calcula nada localmente: se llama a la Edge Function "evaluar-zona"
 * con el JWT del adulto, y esa función es la que decide (con su cooldown en
 * la base de datos) si corresponde la alerta intensa o una actualización,
 * y avisa a los cuidadores.
 */
public class EvaluacionZonaBackground {

    private static final String TAG = "ZonaBackground";
    private static final String PREFS = "sc_prefs";
    private static final long INTERVALO_MINIMO_MS = 30000;

    private static long ultimaLlamada = 0;

    public static void evaluar(final Context contexto, final double latitud, final double longitud) {
        final SharedPreferences prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        if (prefs.getString("sb_url", "").isEmpty()
            || prefs.getString("sb_access", "").isEmpty()) {
            return; // todavía no hay sesión guardada desde la app
        }

        long ahora = System.currentTimeMillis();
        if (ahora - ultimaLlamada < INTERVALO_MINIMO_MS) return;
        ultimaLlamada = ahora;

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    ejecutar(prefs, latitud, longitud);
                } catch (Exception e) {
                    Log.w(TAG, "No se pudo evaluar zona: " + e.getMessage());
                }
            }
        }).start();
    }

    private static void ejecutar(SharedPreferences prefs, double latitud, double longitud) throws Exception {
        String url = prefs.getString("sb_url", "");
        String anon = prefs.getString("sb_anon", "");
        String access = prefs.getString("sb_access", "");
        String refresh = prefs.getString("sb_refresh", "");
        long expira = prefs.getLong("sb_expires", 0);

        // Con la app cerrada la sesión envejece: refrescamos el token nosotros mismos
        if (!refresh.isEmpty() && System.currentTimeMillis() > expira - 60000L) {
            String[] nuevos = refrescarToken(url, anon, refresh);
            if (nuevos != null) {
                access = nuevos[0];
                prefs.edit()
                    .putString("sb_access", access)
                    .putString("sb_refresh", nuevos[1])
                    .putLong("sb_expires", Long.parseLong(nuevos[2]))
                    .apply();
            }
        }

        JSONObject cuerpo = new JSONObject();
        cuerpo.put("latitud", latitud);
        cuerpo.put("longitud", longitud);

        int estado = llamar(url, access, anon, cuerpo.toString());

        // 401 -> el token ya estaba vencido: refrescar y reintentar una vez
        if (estado == 401 && !refresh.isEmpty()) {
            String[] nuevos = refrescarToken(url, anon, refresh);
            if (nuevos != null) {
                access = nuevos[0];
                prefs.edit()
                    .putString("sb_access", access)
                    .putString("sb_refresh", nuevos[1])
                    .putLong("sb_expires", Long.parseLong(nuevos[2]))
                    .apply();
                llamar(url, access, anon, cuerpo.toString());
            }
        }
    }

    private static int llamar(String url, String access, String anon, String cuerpo) throws Exception {
        HttpURLConnection conn = (HttpURLConnection)
            new URL(url + "/functions/v1/evaluar-zona").openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + access);
            conn.setRequestProperty("apikey", anon);

            OutputStream salida = conn.getOutputStream();
            salida.write(cuerpo.getBytes(StandardCharsets.UTF_8));
            salida.close();

            int estado = conn.getResponseCode();
            leer(conn, estado >= 400);
            return estado;
        } finally {
            conn.disconnect();
        }
    }

    private static String[] refrescarToken(String url, String anon, String refresh) throws Exception {
        HttpURLConnection conn = (HttpURLConnection)
            new URL(url + "/auth/v1/token?grant_type=refresh_token").openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", anon);

            JSONObject cuerpo = new JSONObject();
            cuerpo.put("refresh_token", refresh);

            OutputStream salida = conn.getOutputStream();
            salida.write(cuerpo.toString().getBytes(StandardCharsets.UTF_8));
            salida.close();

            if (conn.getResponseCode() != 200) {
                leer(conn, true);
                return null;
            }

            String texto = leer(conn, false);
            JSONObject datos = new JSONObject(texto);

            String access = datos.getString("access_token");
            String refreshNuevo = datos.optString("refresh_token", refresh);
            long expira = System.currentTimeMillis() + datos.optLong("expires_in", 3600) * 1000L;

            return new String[] { access, refreshNuevo, String.valueOf(expira) };
        } finally {
            conn.disconnect();
        }
    }

    private static String leer(HttpURLConnection conn, boolean error) {
        try {
            InputStream entrada = error ? conn.getErrorStream() : conn.getInputStream();
            if (entrada == null) return "";
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] datos = new byte[2048];
            int leidos;
            while ((leidos = entrada.read(datos)) != -1) {
                buffer.write(datos, 0, leidos);
            }
            entrada.close();
            return buffer.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}

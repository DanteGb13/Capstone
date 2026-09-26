package io.ionic.starter;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SiempreCerca")
public class SiempreCercaPlugin extends Plugin {

    public static final String CANAL_ALARMA_ID = "recordatorios-alarma";
    public static final String CANAL_SOS_ID = "sos-alertas";
    public static final String CANAL_ZONA_ALERTA_ID = "zona-alertas";
    public static final String CANAL_ZONA_ESTADO_ID = "zona-estado";

    private static final String PREFS = "sc_prefs";
    // Cambiar este valor obliga a recrear los canales con los nuevos ajustes
    // (sin él, Android conserva la versión vieja del canal y no cambia nada).
    private static final String VERSION_CANALES = "v5";

    // =====================================================
    // CANALES DE NOTIFICACIÓN
    // =====================================================

    /**
     * Crea (o recrea una sola vez, al actualizar la app) los canales de alerta.
     * Se llama desde MainActivity y desde los paneles de la app.
     *
     *  - sos-alertas:      SOS, vibración larga e intensa + alarma + no molestar.
     *  - zona-alertas:     primera salida de zona, alerta intensa.
     *  - zona-estado:      actualizaciones de estado (cada 10 min), aviso normal.
     */
    public static void crearCanales(Context contexto) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        SharedPreferences prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (VERSION_CANALES.equals(prefs.getString("version_canales", ""))) return;

        NotificationManager nm = contexto.getSystemService(NotificationManager.class);
        if (nm == null) return;

        eliminar(nm, CANAL_SOS_ID);
        eliminar(nm, CANAL_ZONA_ALERTA_ID);
        eliminar(nm, CANAL_ZONA_ESTADO_ID);

        // --- SOS: máxima intensidad (se repite hasta que el cuidador conteste) ---
        NotificationChannel sos = new NotificationChannel(
            CANAL_SOS_ID,
            "Alertas SOS",
            NotificationManager.IMPORTANCE_HIGH
        );
        sos.setDescription("Alertas de emergencia del adulto mayor");
        sos.enableVibration(true);
        // 5 pulsos de 2,5 s con pausas de 0,5 s -> ~14,5 s de vibración
        sos.setVibrationPattern(new long[] { 0, 2500, 500, 2500, 500, 2500, 500, 2500, 500, 2500 });
        sos.enableLights(true);
        sos.setLightColor(Color.RED);
        sos.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        sos.setBypassDnd(true);
        Uri alarma = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM);
        sos.setSound(alarma, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        nm.createNotificationChannel(sos);

        // --- Zona segura: primera salida (alerta intensa) ---
        NotificationChannel zonaAlerta = new NotificationChannel(
            CANAL_ZONA_ALERTA_ID,
            "Fuera de zona segura",
            NotificationManager.IMPORTANCE_HIGH
        );
        zonaAlerta.setDescription("Primera alerta cuando el adulto sale de la zona segura");
        zonaAlerta.enableVibration(true);
        // 4 pulsos de 1,5 s -> ~7,5 s de vibración
        zonaAlerta.setVibrationPattern(new long[] { 0, 1500, 500, 1500, 500, 1500, 500, 1500 });
        zonaAlerta.enableLights(true);
        zonaAlerta.setLightColor(Color.RED);
        zonaAlerta.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        zonaAlerta.setSound(alarma, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        nm.createNotificationChannel(zonaAlerta);

        // --- Zona segura: actualizaciones de estado (cada 10 min) ---
        NotificationChannel zonaEstado = new NotificationChannel(
            CANAL_ZONA_ESTADO_ID,
            "Estado de zona segura",
            NotificationManager.IMPORTANCE_HIGH
        );
        zonaEstado.setDescription("Actualizaciones del estado fuera/dentro de zona segura");
        zonaEstado.enableVibration(true);
        zonaEstado.setVibrationPattern(new long[] { 0, 400, 300, 400 });
        zonaEstado.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        zonaEstado.setSound(
            android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        nm.createNotificationChannel(zonaEstado);

        prefs.edit().putString("version_canales", VERSION_CANALES).apply();
    }

    private static void eliminar(NotificationManager nm, String id) {
        if (nm.getNotificationChannel(id) != null) {
            nm.deleteNotificationChannel(id);
        }
    }

    @PluginMethod
    public void crearCanalSOS(PluginCall call) {
        crearCanales(getContext());
        call.resolve();
    }

    // =====================================================
    // VIBRACIÓN CON AMPLITUD MÁXIMA (para recibir SOS en la app)
    // =====================================================

    @PluginMethod
    public void vibrar(PluginCall call) {
        int duracion = call.getInt("duracionMs", 1000);
        int veces = call.getInt("veces", 1);
        int descanso = call.getInt("descansoMs", 400);
        int amplitud = call.getInt("amplitud", 255);

        if (duracion < 1) duracion = 1;
        if (veces < 1) veces = 1;
        if (descanso < 0) descanso = 0;
        if (amplitud < 1) amplitud = 1;
        if (amplitud > 255) amplitud = 255;

        Vibrator vibrador = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrador == null || !vibrador.hasVibrator()) {
            call.resolve();
            return;
        }

        int total = veces * 2;
        long[] tiempos = new long[total];
        int[] amplitudes = new int[total];
        for (int i = 0; i < veces; i++) {
            tiempos[i * 2] = duracion;
            amplitudes[i * 2] = amplitud;
            tiempos[i * 2 + 1] = descanso;
            amplitudes[i * 2 + 1] = 0;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrador.vibrate(VibrationEffect.createWaveform(tiempos, amplitudes, -1));
        } else {
            vibrador.vibrate((long) (veces * duracion + (veces - 1) * descanso));
        }

        call.resolve();
    }

    // =====================================================
    // SESIÓN DE SUPABASE PARA EL SERVICIO EN SEGUNDO PLANO
    // (Java evalúa las zonas con la app cerrada y necesita el JWT)
    // =====================================================

    @PluginMethod
    public void guardarSesionBackend(PluginCall call) {
        String url = call.getString("url", "");
        String anon = call.getString("anonKey", "");
        String access = call.getString("accessToken", "");
        String refresh = call.getString("refreshToken", "");
        String usuario = call.getString("userId", "");
        long expira = call.getLong("expiresAt", 0L);

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();

        if (url != null) editor.putString("sb_url", url);
        if (anon != null) editor.putString("sb_anon", anon);

        if (access == null || access.isEmpty()) {
            editor.remove("sb_access");
            editor.remove("sb_refresh");
            editor.remove("sb_expires");
            editor.remove("sb_user");
        } else {
            editor.putString("sb_access", access);
            editor.putString("sb_refresh", refresh == null ? "" : refresh);
            editor.putLong("sb_expires", expira);
            editor.putString("sb_user", usuario == null ? "" : usuario);
        }

        editor.apply();
        call.resolve();
    }

    @PluginMethod
    public void obtenerSesionBackend(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        ret.put("url", prefs.getString("sb_url", ""));
        ret.put("anonKey", prefs.getString("sb_anon", ""));
        ret.put("accessToken", prefs.getString("sb_access", ""));
        ret.put("refreshToken", prefs.getString("sb_refresh", ""));
        ret.put("userId", prefs.getString("sb_user", ""));
        ret.put("expiresAt", prefs.getLong("sb_expires", 0L));
        call.resolve(ret);
    }

    // =====================================================
    // RESTO DE MÉTODOS (sin cambios)
    // =====================================================

    @PluginMethod
    public void crearCanalAlarma(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            NotificationChannel canal = nm.getNotificationChannel(CANAL_ALARMA_ID);
            boolean migrado = Boolean.parseBoolean(
                getContext().getSharedPreferences("sc_prefs", Context.MODE_PRIVATE)
                    .getString("canal_alarma_v3", "")
            );
            if (canal == null || !migrado) {
                if (canal != null) {
                    nm.deleteNotificationChannel(CANAL_ALARMA_ID);
                }
                crearCanal(nm);
                getContext().getSharedPreferences("sc_prefs", Context.MODE_PRIVATE)
                    .edit()
                    .putString("canal_alarma_v3", "1")
                    .apply();
            }
        }
        call.resolve();
    }

    private void crearCanal(NotificationManager nm) {
        NotificationChannel canal = new NotificationChannel(
            CANAL_ALARMA_ID,
            "Recordatorios",
            NotificationManager.IMPORTANCE_MAX
        );
        canal.setDescription("Recordatorios de medicinas y actividades");
        canal.enableVibration(true);
        canal.setVibrationPattern(new long[] { 400, 500, 300, 500, 300, 500 });
        canal.enableLights(true);
        canal.setLightColor(Color.parseColor("#7715c7"));
        canal.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

        int resId = getContext().getResources().getIdentifier(
            "alarmmelodia", "raw", getContext().getPackageName());
        if (resId != 0) {
            Uri sonido = Uri.parse("android.resource://" + getContext().getPackageName() + "/" + resId);
            AudioAttributes atributos = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            canal.setSound(sonido, atributos);
        }

        nm.createNotificationChannel(canal);
    }

    @PluginMethod
    public void pedirIgnorarOptimizacion(PluginCall call) {
        Context contexto = getContext();
        PowerManager pm = (PowerManager) contexto.getSystemService(Context.POWER_SERVICE);
        String paquete = contexto.getPackageName();

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(paquete)) {
            call.resolve();
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + paquete));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            contexto.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir el ajuste de batería", e);
        }
    }

    @PluginMethod
    public void ignorandoBateria(PluginCall call) {
        Context contexto = getContext();
        PowerManager pm = (PowerManager) contexto.getSystemService(Context.POWER_SERVICE);
        boolean si = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            pm.isIgnoringBatteryOptimizations(contexto.getPackageName());
        JSObject ret = new JSObject();
        ret.put("si", si);
        call.resolve(ret);
    }
}

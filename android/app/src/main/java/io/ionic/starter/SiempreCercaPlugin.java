package io.ionic.starter;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.HashSet;

@CapacitorPlugin(name = "SiempreCerca")
public class SiempreCercaPlugin extends Plugin {

    public static final String CANAL_ALARMA_ID = "recordatorios-alarma";
    public static final String CANAL_SOS_ID = "sos-alertas";
    public static final String CANAL_ZONA_ALERTA_ID = "zona-alertas";
    public static final String CANAL_ZONA_ESTADO_ID = "zona-estado";

    // Acción de la notificación que abrió la app cuando ya estaba viva.
    private String accionPendiente = null;
    private String notificacionPendiente = null;

    // Se comparte con AlarmaNativaReceiver, que guarda ahi las alarmas apagadas
    // desde la barra de notificaciones.
    static final String PREFS = "sc_prefs";
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
    // ESTADO REAL DE LAS NOTIFICACIONES
    // =====================================================

    /**
     * Dice si las notificaciones están de verdad activas, canal por canal.
     *
     * Hace falta porque el permiso POST_NOTIFICATIONS y los canales son cosas
     * distintas: el usuario puede dejar el permiso concedido y aun así apagar
     * a mano el canal "Alertas SOS" en Ajustes. Con solo mirar
     * checkPermissions() la app creed que tiene notificaciones y el SOS suena
     * en silencio. Esto es exactamente el caso "creo que está todo bien pero no
     * me avisa nada".
     */
    @PluginMethod
    public void verificarNotificaciones(PluginCall call) {
        Context contexto = getContext();

        boolean habilitadas;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            NotificationManager nm = contexto.getSystemService(NotificationManager.class);
            habilitadas = nm != null && nm.areNotificationsEnabled();
        } else {
            NotificationManagerCompat compat = NotificationManagerCompat.from(contexto);
            habilitadas = compat.areNotificationsEnabled();
        }

        JSObject canales = new JSObject();
        canales.put(CANAL_SOS_ID, canalActivo(contexto, CANAL_SOS_ID));
        canales.put(CANAL_ZONA_ALERTA_ID, canalActivo(contexto, CANAL_ZONA_ALERTA_ID));
        canales.put(CANAL_ZONA_ESTADO_ID, canalActivo(contexto, CANAL_ZONA_ESTADO_ID));
        canales.put(CANAL_ALARMA_ID, canalActivo(contexto, CANAL_ALARMA_ID));

        JSObject ret = new JSObject();
        ret.put("habilitadas", habilitadas);
        // Un canal todavía no creado se considera activo: se crea al primer uso
        // y no debe reportarse como "apagado" (generaría una alerta falsa).
        ret.put("sosActivo", canalActivo(contexto, CANAL_SOS_ID));
        ret.put("zonaAlertaActivo", canalActivo(contexto, CANAL_ZONA_ALERTA_ID));
        ret.put("zonaEstadoActivo", canalActivo(contexto, CANAL_ZONA_ESTADO_ID));
        ret.put("alarmaActivo", canalActivo(contexto, CANAL_ALARMA_ID));
        ret.put("canales", canales);
        // Sin POST_NOTIFICATIONS no suena nada, aunque los canales estén bien.
        ret.put("alertaFunciona", habilitadas && canalActivo(contexto, CANAL_SOS_ID));
        call.resolve(ret);
    }

    /**
     * Importancia real de un canal. null / IMPORTANCE_NONE = apagado.
     * En Android < O no existen canales, así que se informa true.
     */
    private boolean canalActivo(Context contexto, String id) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager nm = contexto.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        NotificationChannel canal = nm.getNotificationChannel(id);
        if (canal == null) return true; // aún no creado: se creará al primer uso
        return canal.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    /** Abre los ajustes de notificaciones DE ESTA app, no los generales. */
    /**
     * Estado real de un permiso de Android, incluido si quedó bloqueado para
     * siempre.
     *
     * Hace falta porque `checkPermissions()` de los plugins de Capacitor sólo
     * dicen concedido / denegado. No dicen cuándo el usuario ya eligió "no
     * volver a preguntar", y en ese caso pedir el permiso NO muestra nada: la
     * app cree que el alta funcionó, falla en silencio y el usuario ve un
     * interruptor que ya no se enciende nunca más.
     *
     * Se resuelve con `shouldShowRequestPermissionRationale`, que devuelve
     * false tanto si nunca se pidió como si quedó bloqueado; por eso se
     * combina con un registro de "ya lo pedimos".
     */
    @PluginMethod
    public void estadoPermiso(PluginCall call) {
        String permiso = call.getString("permiso", "");
        if (permiso.isEmpty()) {
            call.reject("Falta el permiso a consultar");
            return;
        }

        Context contexto = getContext();
        SharedPreferences prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        boolean concedido = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || contexto.checkSelfPermission(permiso) == PackageManager.PERMISSION_GRANTED;

        boolean muestraDialogo = ActivityCompat.shouldShowRequestPermissionRationale(
                getActivity(), permiso);

        boolean yaPreguntado = prefs.getBoolean("preguntado_" + permiso, false);

        JSObject ret = new JSObject();
        ret.put("concedido", concedido);
        ret.put("muestraDialogo", muestraDialogo);
        ret.put("yaPreguntado", yaPreguntado);
        // Sin diálogo Y ya preguntado = el usuario lo bloqueó para siempre.
        ret.put("bloqueado", !concedido && !muestraDialogo && yaPreguntado);
        // Un permiso que nunca se preguntó siempre se puede pedir.
        ret.put("puedePedir", !concedido && (muestraDialogo || !yaPreguntado));
        call.resolve(ret);
    }

    /** Deja constancia de que se mostró el diálogo de este permiso. */
    @PluginMethod
    public void marcarPermisoPreguntado(PluginCall call) {
        String permiso = call.getString("permiso", "");
        if (permiso.isEmpty()) {
            call.reject("Falta el permiso");
            return;
        }

        getContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("preguntado_" + permiso, true)
                .apply();

        call.resolve();
    }

    @PluginMethod
    public void abrirAjustesNotificaciones(PluginCall call) {
        try {
            Intent intent = new Intent();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudieron abrir los ajustes de notificaciones", e);
        }
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

    // =====================================================
    // ACCIÓN DE LA NOTIFICACIÓN (botón "Apagar alarma")
    // =====================================================

    /**
     * Entrega la acción con la que se abrió la app, por si vino del botón
     * "Apagar alarma" de la notificación.
     *
     * El plugin de notificaciones solo publica su evento desde onNewIntent, o
     * sea únicamente si la app ya estaba viva. Si Android la había cerrado, el
     * botón no hacía nada y la alarma seguía sonando. Este método lee el intent
     * de arranque, que en ese caso es el único lugar donde quedó la acción.
     *
     * El intent se limpia antes de responder para que la misma acción no se
     * procese otra vez en los siguientes arranques de la app.
     */
    @PluginMethod
    public void accionNotificacion(PluginCall call) {
        String accion = null;
        String notificacion = null;

        // Camino 1: la app ya estaba viva y la notificación la abrió con un
        // intent nuevo. getIntent() no se actualiza solo en ese caso, así que el
        // intent se guarda al recibirlo.
        if (accionPendiente != null) {
            accion = accionPendiente;
            notificacion = notificacionPendiente;
            accionPendiente = null;
            notificacionPendiente = null;
        }

        // Camino 2: la app se abrió en frío con esa notificación. Entonces sí
        // queda en el intent de arranque, que se limpia para no repetirla.
        if (accion == null && getActivity() != null) {
            Intent intent = getActivity().getIntent();
            if (intent != null) {
                String pendiente = intent.getStringExtra("LocalNotificationUserAction");
                // "tap" es el toque normal sobre la notificación, no el botón.
                if (pendiente != null && !"tap".equals(pendiente)) {
                    accion = pendiente;
                    notificacion = intent.getStringExtra("LocalNotficationObject");
                    intent.removeExtra("LocalNotificationUserAction");
                    intent.removeExtra("LocalNotficationObject");
                    intent.removeExtra("LocalNotificationId");
                }
            }
        }

        JSObject ret = new JSObject();
        ret.put("accion", accion);
        ret.put("notificacion", notificacion);
        call.resolve(ret);
    }

    @Override
    public void handleOnNewIntent(Intent data) {
        super.handleOnNewIntent(data);
        if (data == null) {
            return;
        }
        String accion = data.getStringExtra("LocalNotificationUserAction");
        if (accion == null) {
            return;
        }
        this.accionPendiente = accion;
        this.notificacionPendiente = data.getStringExtra("LocalNotficationObject");
    }

    // =====================================================
    // ALARMAS PUBLICADAS POR EL SISTEMA
    // =====================================================

    /**
     * Programa las ocurrencias de una alarma con AlarmManager, para que suenen
     * aunque la app este cerrada. El que las publica es AlarmaNativaReceiver.
     */
    @PluginMethod
    public void programarAlarmas(PluginCall call) {
        JSArray lista = call.getArray("alarmas", new JSArray());
        boolean exacta = Boolean.TRUE.equals(call.getBoolean("exacta", false));
        int programadas = 0;
        HashSet<String> yaLimpias = new HashSet<>();

        for (int i = 0; i < lista.length(); i++) {
            // JSArray entrega JSONObject plano, no el wrapper de Capacitor.
            JSONObject item = lista.optJSONObject(i);
            if (item == null) {
                continue;
            }
            String idAlarma = item.optString("idAlarma", null);
            String clave = item.optString("clave", null);
            if (idAlarma == null || clave == null || !item.has("fecha")) {
                continue;
            }
            long fecha = item.optLong("fecha", 0L);
            int idNotificacion = item.optInt("idNotificacion", 0);
            if (idNotificacion == 0) {
                continue;
            }
            // Programar es reemplazar: si la ventana cambio, lo que quedo antes
            // en AlarmManager seguia armed y podia sonar de mas.
            if (yaLimpias.add(idAlarma)) {
                AlarmaNativaReceiver.limpiarProgramadasDe(getContext(), idAlarma);
            }

            AlarmaNativaReceiver.programarAlarma(
                getContext(), idAlarma, clave,
                item.optString("titulo", ""), item.optString("cuerpo", ""),
                fecha, idNotificacion, exacta
            );
            programadas++;
        }

        JSObject ret = new JSObject();
        ret.put("programadas", programadas);
        call.resolve(ret);
    }

    /** Corta una ocurrencia ya publicada por AlarmaNativaReceiver. */
    @PluginMethod
    public void detenerAlarma(PluginCall call) {
        AlarmaNativaReceiver.detenerAlarma(
            getContext(),
            call.getString("idAlarma"),
            call.getString("clave"),
            call.getLong("fecha", 0L),
            call.getInt("idNotificacion", 0),
            call.getBoolean("marcar", true)
        );
        call.resolve();
    }

    /**
     * Alarmas apagadas desde la barra que la app todavia no tiene anotadas. Se
     * devuelve el arreglo como texto porque JSObject solo acepta tipos simples.
     */
    @PluginMethod
    public void leerAlarmasApagadas(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("apagadas", AlarmaNativaReceiver.leerApagadas(getContext()).toString());
        call.resolve(ret);
    }

    /** Que alarmas tiene sonando el sistema ahora mismo. */
    @PluginMethod
    public void leerAlarmasSonando(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sonando", AlarmaNativaReceiver.leerSonando(getContext()).toString());
        call.resolve(ret);
    }
}

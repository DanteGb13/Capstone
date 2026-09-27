package io.ionic.starter;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Map;

/**
 * Alarma que publica Android y no la app: el sonido sigue aunque la app este
 * cerrada y el boton "Apagar" la calla sin abrirla.
 *
 * Por que el plugin de notificaciones no servia para esto:
 *  - Publica la alerta con un unico disparo del archivo (~20 s) y, como la app
 *    puede estar cerrada, nadie vuelve a emitirla: la alarma se quedaba muda.
 *  - Su evento del boton "Apagar" sale de onNewIntent, o sea solo si la app ya
 *    estaba viva. Con la app en segundo plano la accion se perdia y la alarma
 *    seguia sonando.
 *
 * Aqui la notificacion se arma con FLAG_INSISTENT, que ordena al sistema repetir
 * el sonido hasta que se cancele, y ademas se rearma cada 19 s como respaldo
 * para equipos que no respetan ese flag. El estado de apagada queda en las
 * preferencias de la app para que, al abrirla, la tarjeta de la alarma
 * desaparezca y el apagado se suba al servidor.
 */
public class AlarmaNativaReceiver extends BroadcastReceiver {

    private static final String TAG = "AlarmaNativa";

    public static final String ACCION_REFUERZO = "io.ionic.starter.ALARMA_REFUERZO";
    public static final String ACCION_APAGAR = "io.ionic.starter.ALARMA_APAGAR";

    public static final String EXTRA_ID_ALARMA = "idAlarma";
    public static final String EXTRA_CLAVE = "clave";
    public static final String EXTRA_TITULO = "titulo";
    public static final String EXTRA_CUERPO = "cuerpo";
    public static final String EXTRA_FECHA = "fecha";
    public static final String EXTRA_ID_NOTIF = "idNotificacion";

    private static final String PREFIJO_APAGADA = "alarma.apagada.";
    private static final String PREFIJO_PROGRAMADA = "alarma.programada.";
    /** Id de la notificacion que esta sonando de cada alarma, para poder callarla. */
    private static final String PREFIJO_SONANDO = "alarma.sonando.";
    private static final String CANAL_MUDO_ID = "sc-alarma-mudo";
    /**
     * Cada cuanto se vuelve a publicar. El archivo dura 20,0 s exactos, asi que a
     * 25 s se escuchaban 5 s de silencio entre ciclo y ciclo. A 19 s la nueva
     * publicacion llega antes de que termine el audio: el sonido no se corta.
     */
    private static final long INTERVALO_MS = 19000L;
    // Sin tope: la alarma sigue sonando hasta que el usuario la apague, desde la
    // barra o desde la app. Un corte automatico dejaria el aviso a medias.

    // =====================================================
    // ESTADO COMPARTIDO CON LA APP
    // =====================================================

    static String clavePreferencia(String idAlarma, String clave) {
        return PREFIJO_APAGADA + idAlarma + "." + clave;
    }

    /** Convierte una clave "2026-09-28T13:10" a milisegundos en hora local. */
    static long claveAFecha(String clave) throws java.text.ParseException {
        return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm")
            .parse(clave.substring(0, 16))
            .getTime();
    }

    public static boolean estaApagada(Context ctx, String idAlarma, String clave) {
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        return prefs.contains(clavePreferencia(idAlarma, clave));
    }

    public static void marcarApagada(Context ctx, String idAlarma, String clave) {
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        prefs.edit().putLong(clavePreferencia(idAlarma, clave), System.currentTimeMillis()).apply();
    }

    /** Cuanto se guardan los apagados antes de limpiar los viejos. */
    private static final long RETENCION_MS = 7L * 24L * 60L * 60L * 1000L;
    /**
     * Solo se devuelven los apagados recientes. La app necesita enterarse de los
     * que Happened con ella cerrada; de los de hace dias ya esta todo anotado en
     * el servidor y devolverlos provocaba decenas de llamadas al abrir.
     */
    private static final long INTERESTANTE_MS = 24L * 60L * 60L * 1000L;

    /** Las alarmas que se apagaron desde la barra y la app todavia no sabe. */
    public static JSONArray leerApagadas(Context ctx) {
        long ahora = System.currentTimeMillis();
        JSONArray salida = new JSONArray();
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            String clave = entrada.getKey();
            if (!clave.startsWith(PREFIJO_APAGADA)) {
                continue;
            }
            String resto = clave.substring(PREFIJO_APAGADA.length());
            int corte = resto.indexOf('.');
            if (corte <= 0) {
                continue;
            }
            try {
                JSONObject fila = new JSONObject();
                fila.put("idAlarma", resto.substring(0, corte));
                fila.put("clave", resto.substring(corte + 1));
                long marca = entrada.getValue() instanceof Long ? (Long) entrada.getValue() : 0L;
                if (marca > 0 && ahora - marca < INTERESTANTE_MS) {
                    fila.put("fecha", marca);
                    salida.put(fila);
                }
                if (marca > 0 && ahora - marca > RETENCION_MS) {
                    // La app ya lo sabe hace semanas: no hace falta guardarlo.
                    editor.remove(clave);
                }
            } catch (JSONException e) {
                // fila incompleta: se ignora
            }
        }
        editor.apply();
        return salida;
    }

    /**
     * Las alarmas que el sistema tiene sonando ahora mismo. La app lo usa como
     * fuente de la verdad: si pregunta "que suena" al nativo, una alarma puede
     * seguir sonando las horas que haga falta sin que la app la olvide.
     */
    public static JSONArray leerSonando(Context ctx) {
        JSONArray salida = new JSONArray();
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            String clave = entrada.getKey();
            if (!clave.startsWith(PREFIJO_SONANDO)) {
                continue;
            }
            int idNotif = entrada.getValue() instanceof Integer ? (Integer) entrada.getValue() : 0;
            if (idNotif == 0) {
                continue;
            }
            try {
                JSONObject fila = new JSONObject();
                fila.put("idAlarma", clave.substring(PREFIJO_SONANDO.length()));
                fila.put("idNotificacion", idNotif);
                salida.put(fila);
            } catch (JSONException e) {
                // fila incompleta: se ignora
            }
        }
        return salida;
    }

    /**
     * Una marca de apagado solo puede ser legitima si la ocurrencia ya ocurrio:
     * se pone cuando el usuario apaga una alarma que esta sonando. Si aparece
     * con fecha de manana es basura (una version vieja marcaba al desactivar y
     * quemaba los dias siguientes) y haria que esa alarma no sonara nunca.
     */
    public static void limpiarMarcasFuturas(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        int borradas = 0;
        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            String clave = entrada.getKey();
            if (!clave.startsWith(PREFIJO_APAGADA)) {
                continue;
            }
            String resto = clave.substring(PREFIJO_APAGADA.length());
            int corte = resto.indexOf('.');
            if (corte <= 0) {
                continue;
            }
            try {
                long fecha = claveAFecha(resto.substring(corte + 1));
                if (fecha > System.currentTimeMillis()) {
                    editor.remove(clave);
                    borradas++;
                }
            } catch (Exception e) {
                // clave ilegible: se deja como esta
            }
        }
        if (borradas > 0) {
            editor.apply();
            Log.i(TAG, "Marcas de apagado de dias futuros eliminadas: " + borradas);
        }
    }

    // =====================================================
    // API QUE USA LA APP
    // =====================================================

    /** Programa la alarma de una ocurrencia. Repetirla reescribe la anterior. */
    public static void programarAlarma(
        Context ctx, String idAlarma, String clave, String titulo, String cuerpo,
        long fecha, int idNotificacion, boolean exacta
    ) {
        guardarProgramada(ctx, idAlarma, clave, titulo, cuerpo, fecha, idNotificacion);
        Intent base = intentBase(ctx, ACCION_REFUERZO, idAlarma, clave, titulo, cuerpo, fecha, idNotificacion);
        programarEn(ctx, fecha, base, idNotificacion, exacta);
    }

    /**
     * Saca las ocurrencias que quedaron programadas de una alarma. Se usa al
     * reprogramarla: si la ventana de dias se acorto, o el horario cambio, las
     * que ya no se mandan seguian armed en AlarmManager y podian sonar.
     */
    public static void limpiarProgramadasDe(Context ctx, String idAlarma) {
        long ahora = System.currentTimeMillis();
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        boolean cambio = false;

        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            if (!entrada.getKey().startsWith(PREFIJO_PROGRAMADA) || !(entrada.getValue() instanceof String)) {
                continue;
            }
            try {
                JSONObject fila = new JSONObject((String) entrada.getValue());
                if (!idAlarma.equals(fila.optString(EXTRA_ID_ALARMA, ""))) {
                    continue;
                }
                long fecha = fila.getLong(EXTRA_FECHA);
                int idNotif = fila.getInt(EXTRA_ID_NOTIF);
                // La que esta sonando no se cancela, pero tampoco se borra su
                // fila: es la que dice con que id se esta sonando, y sin ella al
                // apagar desde la barra no habria que notificacion cancelar.
                if (fecha <= ahora) {
                    continue;
                }
                Intent base = intentBase(
                    ctx, ACCION_REFUERZO, idAlarma, fila.getString(EXTRA_CLAVE), null, null, fecha, idNotif);
                PendingIntent pi = pendiente(ctx, base, idNotif);
                AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
                if (pi != null && am != null) {
                    am.cancel(pi);
                }
                editor.remove(entrada.getKey());
                cambio = true;
            } catch (JSONException e) {
                editor.remove(entrada.getKey());
                cambio = true;
            }
        }

        if (cambio) {
            editor.apply();
        }
    }

    /**
     * Vuelve a programar lo que quedo guardado. Al reiniciar el telefono o al
     * actualizar la app, Android borra las alarmas de AlarmManager y la app
     * todavia no ha podido sincronizar con el servidor.
     */
    public static void rearmendar(Context ctx) {
        limpiarMarcasFuturas(ctx);
        long ahora = System.currentTimeMillis();
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();

        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            String nombre = entrada.getKey();
            if (!nombre.startsWith(PREFIJO_PROGRAMADA) || !(entrada.getValue() instanceof String)) {
                continue;
            }
            try {
                JSONObject fila = new JSONObject((String) entrada.getValue());
                String idAlarma = fila.getString(EXTRA_ID_ALARMA);
                String clave = fila.getString(EXTRA_CLAVE);
                long fecha = fila.getLong(EXTRA_FECHA);
                int idNotificacion = fila.getInt(EXTRA_ID_NOTIF);

                if (fecha <= ahora || estaApagada(ctx, idAlarma, clave)) {
                    // Ya paso o se apago: se limpia y no se vuelve a programar.
                    editor.remove(nombre);
                    continue;
                }
                Intent base = intentBase(
                    ctx, ACCION_REFUERZO, idAlarma, clave,
                    fila.optString(EXTRA_TITULO, ""), fila.optString(EXTRA_CUERPO, ""),
                    fecha, idNotificacion
                );
                programarEn(ctx, fecha, base, idNotificacion, true);
            } catch (JSONException e) {
                editor.remove(nombre);
            }
        }
        editor.apply();
    }

    private static void guardarProgramada(
        Context ctx, String idAlarma, String clave, String titulo, String cuerpo,
        long fecha, int idNotificacion
    ) {
        try {
            JSONObject fila = new JSONObject();
            fila.put(EXTRA_ID_ALARMA, idAlarma);
            fila.put(EXTRA_CLAVE, clave);
            fila.put(EXTRA_TITULO, titulo == null ? "" : titulo);
            fila.put(EXTRA_CUERPO, cuerpo == null ? "" : cuerpo);
            fila.put(EXTRA_FECHA, fecha);
            fila.put(EXTRA_ID_NOTIF, idNotificacion);
            ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PREFIJO_PROGRAMADA + idNotificacion, fila.toString())
                .apply();
        } catch (JSONException e) {
            // si no se puede guardar, la alarma igual queda programada en esta
            // sesion; solo se pierde la re-programacion tras reiniciar.
        }
    }

    /** Corta la alarma de una ocurrencia y deja de reemitirla. */
    public static void detenerAlarma(Context ctx, String idAlarma, String clave, long fecha, int idNotificacion) {
        detenerAlarma(ctx, idAlarma, clave, fecha, idNotificacion, true);
    }

    /**
     * @param marcar Si es false solo se saca del AlarmManager y de la barra, sin
     *   anotar "el usuario la apagó". Eso lo usa la app al desactivar o cambiar
     *   una alarma: si no, los próximos días quedaban marcados como apagados y
     *   al volver a activarla no sonaba nunca.
     */
    public static void detenerAlarma(
        Context ctx, String idAlarma, String clave, long fecha, int idNotificacion, boolean marcar
    ) {
        if (idAlarma == null) {
            Log.w(TAG, "detenerAlarma sin idAlarma: no hay nada que callar");
            return;
        }
        if (clave == null || clave.isEmpty()) {
            // No se sabe que ocurrencia es (notificaciones viejas que no
            // traian la hora): se para la de esa alarma que este sonando ahora.
            Log.w(TAG, "detenerAlarma sin clave, se busca la que este sonando: " + idAlarma);
            detenerLaQueEstaSonando(ctx, idAlarma);
            return;
        }
        Log.i(TAG, "Apagando " + idAlarma + " clave=" + clave + " idNotif=" + idNotificacion + " marcar=" + marcar);
        if (marcar) {
            marcarApagada(ctx, idAlarma, clave);
        }
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        // Id con el que se publico de verdad: si el del boton no coincide, el
        // sonido se sigue escuchando aunque se cancele la notificacion.
        int publicado = prefs.getInt(PREFIJO_SONANDO + idAlarma, 0);
        // Si queda guardada, el reinicio del telefono la volveria a programar.
        prefs.edit()
            .remove(PREFIJO_PROGRAMADA + idNotificacion)
            .remove(PREFIJO_SONANDO + idAlarma)
            .apply();

        Intent base = intentBase(ctx, ACCION_REFUERZO, idAlarma, clave, null, null, fecha, idNotificacion);
        PendingIntent pendiente = pendiente(ctx, base, idNotificacion);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null && pendiente != null) {
            am.cancel(pendiente);
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            callarNotificacion(ctx, nm, idNotificacion);
            if (publicado != 0 && publicado != idNotificacion) {
                Log.w(TAG, "El id del boton no era el que sonaba (" + idNotificacion
                    + " vs " + publicado + "): se calla tambien el bueno");
                callarNotificacion(ctx, nm, publicado);
            }
        }
    }

    /**
     * Cancela la notificacion y, si el equipo la deja pegada, la cambia por una
     * muda y recien despues la quita. Hay ROMs donde una notificacion con
     * FLAG_INSISTENT sigue sonando aunque se le haga cancel.
     */
    private static void callarNotificacion(Context ctx, NotificationManager nm, int idNotificacion) {
        if (idNotificacion == 0) {
            return;
        }
        nm.cancel(idNotificacion);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }
        for (StatusBarNotification activa : nm.getActiveNotifications()) {
            if (activa.getId() != idNotificacion) {
                continue;
            }
            Log.w(TAG, "La notificacion " + idNotificacion
                + " sigue viva tras el cancel: se cambia por una muda");
            try {
                Notification muda = new NotificationCompat.Builder(ctx, canalMudo(ctx, nm))
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("")
                    .setPriority(NotificationCompat.PRIORITY_MIN)
                    .build();
                nm.notify(idNotificacion, muda);
                nm.cancel(idNotificacion);
            } catch (Exception e) {
                Log.e(TAG, "No se pudo cambiar por la notificacion muda", e);
            }
            return;
        }
    }

    /** Canal sin sonido, para poder reemplazar una notificacion que sigue sonando. */
    private static String canalMudo(Context ctx, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return SiempreCercaPlugin.CANAL_ALARMA_ID;
        }
        if (nm.getNotificationChannel(CANAL_MUDO_ID) == null) {
            NotificationChannel canal = new NotificationChannel(
                CANAL_MUDO_ID, "Auxiliar", NotificationManager.IMPORTANCE_LOW);
            canal.setSound(null, null);
            canal.enableVibration(false);
            nm.createNotificationChannel(canal);
        }
        return CANAL_MUDO_ID;
    }

    /** Para la ocurrencia de esa alarma que este sonando en este momento. */
    private static void detenerLaQueEstaSonando(Context ctx, String idAlarma) {
        long ahora = System.currentTimeMillis();
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            if (!entrada.getKey().startsWith(PREFIJO_PROGRAMADA) || !(entrada.getValue() instanceof String)) {
                continue;
            }
            try {
                JSONObject fila = new JSONObject((String) entrada.getValue());
                if (!idAlarma.equals(fila.optString(EXTRA_ID_ALARMA, ""))) {
                    continue;
                }
                long fecha = fila.getLong(EXTRA_FECHA);
                if (fecha > ahora) {
                    continue;
                }
                detenerAlarma(
                    ctx, idAlarma, fila.getString(EXTRA_CLAVE), fecha, fila.getInt(EXTRA_ID_NOTIF));
            } catch (JSONException e) {
                // fila incompleta: se ignora
            }
        }
    }

    // =====================================================
    // RECEPCIÓN
    // =====================================================

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        Log.i(TAG, "onReceive " + intent.getAction()
            + " idAlarma=" + intent.getStringExtra(EXTRA_ID_ALARMA)
            + " clave=" + intent.getStringExtra(EXTRA_CLAVE)
            + " idNotif=" + intent.getIntExtra(EXTRA_ID_NOTIF, 0));
        if (ACCION_APAGAR.equals(intent.getAction())) {
            detenerAlarma(
                context,
                intent.getStringExtra(EXTRA_ID_ALARMA),
                intent.getStringExtra(EXTRA_CLAVE),
                intent.getLongExtra(EXTRA_FECHA, 0L),
                intent.getIntExtra(EXTRA_ID_NOTIF, 0)
            );
            return;
        }
        if (!ACCION_REFUERZO.equals(intent.getAction())) {
            return;
        }

        String idAlarma = intent.getStringExtra(EXTRA_ID_ALARMA);
        String clave = intent.getStringExtra(EXTRA_CLAVE);
        int idNotificacion = intent.getIntExtra(EXTRA_ID_NOTIF, 0);
        long fecha = intent.getLongExtra(EXTRA_FECHA, 0L);
        if (idAlarma == null || clave == null || idNotificacion == 0) {
            return;
        }

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }

        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            // El usuario apago las notificaciones: no hay nada que vigilar y
            // ademas Android ya limpio la barra, asi que no se rearma.
            nm.cancel(idNotificacion);
            return;
        }

        if (estaApagada(context, idAlarma, clave)) {
            // El usuario ya la apago: se limpia y no se rearma.
            nm.cancel(idNotificacion);
            return;
        }

        // Se vuelve a publicar siempre, aunque la notificacion siga en pantalla.
        // FLAG_INSISTENT no esta garantizado en todos los equipos: si el sistema
        // lo respeta el sonido ya va en loop, y si no, esta reemision es la que
        // lo sostiene. El intervalo va mas corto que el audio justamente para
        // que el relevo no deje ni un hueco de silencio.
        publicar(context, intent, nm, idAlarma, clave, fecha, idNotificacion);

        Intent base = intentBase(
            context, ACCION_REFUERZO, idAlarma, clave,
            intent.getStringExtra(EXTRA_TITULO), intent.getStringExtra(EXTRA_CUERPO),
            fecha, idNotificacion
        );
        programarEn(context, System.currentTimeMillis() + INTERVALO_MS, base, idNotificacion, true);
    }

    // =====================================================
    // PUBLICACIÓN
    // =====================================================

    private void publicar(
        Context context, Intent intent, NotificationManager nm,
        String idAlarma, String clave, long fecha, int idNotificacion
    ) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return;
        }
        asegurarCanal(context, nm);

        String titulo = intent.getStringExtra(EXTRA_TITULO);
        String cuerpo = intent.getStringExtra(EXTRA_CUERPO);

        Intent abrir = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (abrir == null) {
            abrir = new Intent(context, MainActivity.class);
        }
        abrir.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // Mismas claves que usa el plugin, para que la app sepa que se tocó.
        abrir.putExtra("LocalNotificationUserAction", "tap");
        abrir.putExtra("LocalNotificationId", idNotificacion);
        abrir.putExtra("LocalNotficationObject", objetoNotificacion(idAlarma, fecha, idNotificacion));

        Intent parar = intentBase(context, ACCION_APAGAR, idAlarma, clave, titulo, cuerpo, fecha, idNotificacion);

        NotificationCompat.Builder b =
            new NotificationCompat.Builder(context, SiempreCercaPlugin.CANAL_ALARMA_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(titulo)
                .setContentText(cuerpo)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setWhen(fecha)
                .setShowWhen(true)
                // Sin esto el mensaje se puede deslizar y borrar sin apagar nada.
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(PendingIntent.getActivity(context, idNotificacion, abrir, flags()))
                .addAction(android.R.drawable.ic_lock_idle_alarm, "Apagar alarma",
                    PendingIntent.getBroadcast(context, idNotificacion, parar, flags()));

        Notification notificacion = b.build();
        // El sistema repite el canal hasta que se cancele la notificacion.
        notificacion.flags = notificacion.flags | Notification.FLAG_INSISTENT;

        nm.notify(idNotificacion, notificacion);
        // Con que id quedo sonando de verdad. El boton "Apagar" lo usa como
        // respaldo, para el caso de que el del intent no sea el mismo.
        context.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE)
            .edit().putInt(PREFIJO_SONANDO + idAlarma, idNotificacion).apply();
        Log.i(TAG, "Publicada " + idAlarma + " clave=" + clave + " idNotif=" + idNotificacion);
    }

    private static void asegurarCanal(Context context, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        if (nm.getNotificationChannel(SiempreCercaPlugin.CANAL_ALARMA_ID) != null) {
            return;
        }
        // El canal lo crea SiempreCercaPlugin al abrir la app, pero si la alarma
        // salta antes de que la app se haya abierto nunca, se crea aqui. Con el
        // mismo sonido, o la alarma saldría muda.
        NotificationChannel canal = new NotificationChannel(
            SiempreCercaPlugin.CANAL_ALARMA_ID,
            "Recordatorios",
            NotificationManager.IMPORTANCE_MAX);
        canal.setVibrationPattern(new long[] { 400, 500, 300, 500, 300, 500 });
        canal.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        int resId = context.getResources()
            .getIdentifier("alarmmelodia", "raw", context.getPackageName());
        if (resId != 0) {
            canal.setSound(
                Uri.parse("android.resource://" + context.getPackageName() + "/" + resId),
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        }
        nm.createNotificationChannel(canal);
    }

    // =====================================================
    // UTILIDADES
    // =====================================================

    private static Intent intentBase(
        Context ctx, String accion, String idAlarma, String clave,
        String titulo, String cuerpo, long fecha, int idNotificacion
    ) {
        Intent intent = new Intent(ctx, AlarmaNativaReceiver.class);
        intent.setAction(accion);
        intent.putExtra(EXTRA_ID_ALARMA, idAlarma);
        intent.putExtra(EXTRA_CLAVE, clave);
        intent.putExtra(EXTRA_TITULO, titulo);
        intent.putExtra(EXTRA_CUERPO, cuerpo);
        intent.putExtra(EXTRA_FECHA, fecha);
        intent.putExtra(EXTRA_ID_NOTIF, idNotificacion);
        return intent;
    }

    private static PendingIntent pendiente(Context ctx, Intent intent, int idNotificacion) {
        return PendingIntent.getBroadcast(ctx, idNotificacion, intent, flags());
    }

    private static int flags() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            f = f | PendingIntent.FLAG_IMMUTABLE;
        }
        return f;
    }

    private static void programarEn(Context ctx, long cuando, Intent intent, int idNotificacion, boolean exacta) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        PendingIntent pi = pendiente(ctx, intent, idNotificacion);
        try {
            if (exacta && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
            }
        } catch (SecurityException e) {
            // Sin permiso de alarma exacta: se usa la ventana laxa.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
        }
    }

    /** Mismo formato que guarda el plugin en el intent, para no cambiar el JS. */
    private static String objetoNotificacion(String idAlarma, long fecha, int idNotificacion) {
        try {
            JSONObject extra = new JSONObject();
            extra.put("tipo", "recordatorio");
            extra.put("idAlarma", idAlarma);
            extra.put("fecha", fecha);
            JSONObject notificacion = new JSONObject();
            notificacion.put("id", idNotificacion);
            notificacion.put("extra", extra);
            return notificacion.toString();
        } catch (JSONException e) {
            return "{}";
        }
    }
}

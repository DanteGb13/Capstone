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
import android.os.Bundle;
import android.util.Log;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
    public static final String EXTRA_EXACTA = "exacta";

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

    /**
     * Separa el id de la alarma de la clave de la ocurrencia.
     *
     * Antes era un punto, y el id se recuperaba con indexOf('.'). Como los ids
     * hoy son UUID o "local-<ts>-<rand>", nunca tenian punto y salia bien... por
     * convencion, no por construccion: cualquier id futuro con punto partia la
     * clave en dos y la marca de apagado se guardaba con un id imposible de
     * recuperar, o sea la alarma se volvia a quedar muda. El pipe no aparece en
     * ningun id, asi que el corte ya no depende del formato.
     */
    private static final String SEPARADOR = "|";

    static String clavePreferencia(String idAlarma, String clave) {
        return PREFIJO_APAGADA + idAlarma + SEPARADOR + clave;
    }

    /**
     * Convierte una clave "2026-09-28T13:10" a milisegundos en hora local.
     *
     * Locale.ROOT y setLenient(false) no son cosmeticos: con un locale no
     * occidental los simbolos del patron cambian y el parseo falla, y con el
     * modo leniente un "13:10" invalido se corrige solo en vez de fallar. En la
     * hora repetida del cambio de horario de otono, el modo leniente elegia el
     * primer offset y la fecha caia una hora, con lo que se borraba una marca de
     * apagado que si era legitima.
     */
    static long claveAFecha(String clave) throws java.text.ParseException {
        java.text.SimpleDateFormat formato =
            new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm", java.util.Locale.ROOT);
        formato.setLenient(false);
        return formato.parse(clave.substring(0, 16)).getTime();
    }

    public static boolean estaApagada(Context ctx, String idAlarma, String clave) {
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        return prefs.contains(clavePreferencia(idAlarma, clave));
    }

    public static void marcarApagada(Context ctx, String idAlarma, String clave) {
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        prefs.edit().putLong(clavePreferencia(idAlarma, clave), System.currentTimeMillis()).apply();
    }

    /**
     * Olvida que una alarma esta sonando.
     *
     * Importa que se llame en TODOS los caminos donde la notificacion deja de
     * estar en pantalla. La unica fuente de verdad de "esta sonando" es que haya
     * notificacion; si la marca sobrevive, la app se queda pidiendo "Apagar
     * alarma" por un aviso que ya no existe y no hay forma de quitarlo.
     */
    private static void forgetSonando(Context ctx, String idAlarma) {
        if (idAlarma == null) {
            return;
        }
        ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(PREFIJO_SONANDO + idAlarma)
            .apply();
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
        boolean cambio = false;
        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            String clave = entrada.getKey();
            if (!clave.startsWith(PREFIJO_APAGADA)) {
                continue;
            }
            String resto = clave.substring(PREFIJO_APAGADA.length());
            int corte = resto.indexOf(SEPARADOR);
            if (corte <= 0) {
                // Marca de una version vieja, con punto como separador. Ya no se
                // puede interpretar, asi que se borra: si se deja, ocupa sitio
                // para siempre y nunca la va a leer nadie.
                editor.remove(clave);
                cambio = true;
                continue;
            }
            try {
                long marca = entrada.getValue() instanceof Long ? (Long) entrada.getValue() : 0L;
                if (marca <= 0L) {
                    // Reloj en epoch o tipo raro. Con marca 0 la comprobacion
                    // estaApagada() da true para siempre y esa ocurrencia queda
                    // muda de forma permanente. No se puede fechar, asi que se
                    // descarta: es preferible que la alarma suene de mas una vez
                    // a que no suene nunca.
                    Log.w(TAG, "Marca de apagado sin fecha, se descarta: " + clave);
                    editor.remove(clave);
                    cambio = true;
                    continue;
                }
                JSONObject fila = new JSONObject();
                fila.put("idAlarma", resto.substring(0, corte));
                fila.put("clave", resto.substring(corte + 1));
                if (ahora - marca < INTERESTANTE_MS) {
                    fila.put("fecha", marca);
                    salida.put(fila);
                }
                if (ahora - marca > RETENCION_MS) {
                    // La app ya lo sabe hace semanas: no hace falta guardarlo.
                    editor.remove(clave);
                    cambio = true;
                }
            } catch (JSONException e) {
                // fila incompleta: se ignora
            }
        }
        // Este metodo lo llama la app cada 5 s. Antes hacia apply() siempre, y
        // eso reescribia el fichero de preferencias entero aunque no hubiera
        // borrado nada (y en el mismo fichero esta el token de Supabase).
        if (cambio) {
            editor.apply();
        }
        return salida;
    }

    /**
     * Las alarmas que el sistema tiene sonando ahora mismo. La app lo usa como
     * fuente de la verdad: si pregunta "que suena" al nativo, una alarma puede
     * seguir sonando las horas que haga falta sin que la app la olvide.
     *
     * "Sonando" se comprueba contra la barra de notificaciones, no contra la
     * preferencia. Antes se creia a la preferencia y se producia el peor
     * fallo posible: la marca sobrevivia a que la notificacion desapareciera
     * (reinicio del telefono, notificaciones desactivadas, canal silenciado) y
     * la app se quedaba horas -o dias, con recordatorios diarios- mostrando
     * "Apagar alarma" por algo que ya estaba callado, sin forma de pararlo.
     * Ahora, si la notificacion no esta en pantalla, la marca se borra.
     */
    public static JSONArray leerSonando(Context ctx) {
        JSONArray salida = new JSONArray();
        SharedPreferences prefs = ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        boolean cambio = false;

        Set<Integer> enPantalla = idsEnPantalla(ctx);

        for (Map.Entry<String, ?> entrada : prefs.getAll().entrySet()) {
            String clave = entrada.getKey();
            if (!clave.startsWith(PREFIJO_SONANDO)) {
                continue;
            }
            int idNotif = entrada.getValue() instanceof Integer ? (Integer) entrada.getValue() : 0;
            if (idNotif == 0 || (enPantalla != null && !enPantalla.contains(idNotif))) {
                // La notificacion ya no esta: la alarma no esta sonando.
                Log.i(TAG, "Se limpia el estado de sonando de " + clave + " (no hay notificacion)");
                editor.remove(clave);
                cambio = true;
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
        if (cambio) {
            editor.apply();
        }
        return salida;
    }

    /**
     * Ids de las notificaciones de la app que hay ahora mismo en la barra, o
     * null si no se puede saber (API menor a 23, o la lista no se pudo leer).
     * null significa "no info", y el llamador no descarta nada en ese caso.
     */
    private static Set<Integer> idsEnPantalla(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return null;
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return null;
        }
        try {
            Set<Integer> ids = new HashSet<>();
            for (StatusBarNotification activa : nm.getActiveNotifications()) {
                ids.add(activa.getId());
            }
            return ids;
        } catch (Exception e) {
            Log.w(TAG, "No se pudo leer la barra de notificaciones: " + e.getMessage());
            return null;
        }
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
            int corte = resto.indexOf(SEPARADOR);
            if (corte <= 0) {
                editor.remove(clave);
                borradas++;
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
    /** Programa un lote con una sola escritura de preferencias. */
    public static void programarAlarmas(
        Context ctx, List<Ocurrencia> ocurrencias, boolean exacta
    ) {
        guardarProgramadas(ctx, ocurrencias);
        for (Ocurrencia o : ocurrencias) {
            Intent base = intentBase(
                ctx, ACCION_REFUERZO, o.idAlarma, o.clave, o.titulo, o.cuerpo, o.fecha, o.idNotificacion);
            programarEn(ctx, o.fecha, base, o.idNotificacion, exacta);
        }
    }

    /** Una ocurrencia programada, tal como la describe la app. */
    public static final class Ocurrencia {
        public final String idAlarma;
        public final String clave;
        public final String titulo;
        public final String cuerpo;
        public final long fecha;
        public final int idNotificacion;
        public final boolean exacta;

        public Ocurrencia(String idAlarma, String clave, String titulo, String cuerpo,
                          long fecha, int idNotificacion, boolean exacta) {
            this.idAlarma = idAlarma;
            this.clave = clave;
            this.titulo = titulo;
            this.cuerpo = cuerpo;
            this.fecha = fecha;
            this.idNotificacion = idNotificacion;
            this.exacta = exacta;
        }
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
                    // Y su estado de "sonando" tambien se va. Si no, la fila
                    // desaparece pero la marca queda, y la app se queda
                    // mostrando "Apagar alarma" por algo que ya no existe.
                    editor.remove(PREFIJO_SONANDO + idAlarma);
                    continue;
                }
                Intent base = intentBase(
                    ctx, ACCION_REFUERZO, idAlarma, clave,
                    fila.optString(EXTRA_TITULO, ""), fila.optString(EXTRA_CUERPO, ""),
                    fecha, idNotificacion
                );
                // Se respeta lo que la app decidio al programar, en vez de
                // asumir alarma exacta. Aqui no hay forma de saber si el permiso
                // se concedio entremedio, y forzar "true" hacia que cada alarma
                // rearmada cayera al catch y se difiriera en Doze.
                boolean exacta = fila.optBoolean(EXTRA_EXACTA, true);
                programarEn(ctx, fecha, base, idNotificacion, exacta);
            } catch (JSONException e) {
                editor.remove(nombre);
            }
        }
        editor.apply();
    }

    private static void guardarProgramadas(Context ctx, List<Ocurrencia> ocurrencias) {
        SharedPreferences.Editor editor =
            ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE).edit();
        boolean alguna = false;
        for (Ocurrencia o : ocurrencias) {
            try {
                JSONObject fila = new JSONObject();
                fila.put(EXTRA_ID_ALARMA, o.idAlarma);
                fila.put(EXTRA_CLAVE, o.clave);
                fila.put(EXTRA_TITULO, o.titulo == null ? "" : o.titulo);
                fila.put(EXTRA_CUERPO, o.cuerpo == null ? "" : o.cuerpo);
                fila.put(EXTRA_FECHA, o.fecha);
                fila.put(EXTRA_ID_NOTIF, o.idNotificacion);
                // La exactitud queda guardada con la propia alarma. Antes solo la
                // sabia la app en el momento de programar, y al rearmar tras un
                // reinicio se asumia "exacta": cuando el permiso no estaba dado,
                // setExact reventaba con SecurityException y caia a la ventana
                // laxa sin dejar rastro, y el rearmado se diferia en Doze.
                fila.put(EXTRA_EXACTA, o.exacta);
                editor.putString(PREFIJO_PROGRAMADA + o.idNotificacion, fila.toString());
                alguna = true;
            } catch (JSONException e) {
                // si no se puede guardar, la alarma igual queda programada en esta
                // sesion; solo se pierde la re-programacion tras reiniciar.
            }
        }
        if (alguna) {
            editor.apply();
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
            detenerLaQueEstaSonando(ctx, idAlarma, marcar);
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
        // El remove de arriba ya limpio el estado de "sonando": va en el mismo
        // editor, asi que una sola escritura.
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
            // Android no deja borrar canales, así que este va a aparecer siempre
            // en los ajustes del sistema. Se crea solo cuando hace falta (hay
            // ROMs que no sueltan la notificación aunque se cancele) y se nombra
            // de forma que se entienda de qué va, en vez de "Auxiliar" a secas.
            NotificationChannel canal = new NotificationChannel(
                CANAL_MUDO_ID,
                "SiempreCerca (reajuste de avisos)",
                NotificationManager.IMPORTANCE_LOW);
            canal.setDescription("Canal interno para terminar un aviso de recordatorio");
            canal.setSound(null, null);
            canal.enableVibration(false);
            nm.createNotificationChannel(canal);
        }
        return CANAL_MUDO_ID;
    }

    /** Para la ocurrencia de esa alarma que este sonando en este momento. */
    private static void detenerLaQueEstaSonando(Context ctx, String idAlarma, boolean marcar) {
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
                // OJO: hay que pasar `marcar` hacia abajo. Antes se llamaba a la
                // sobrecarga de 5 argumentos, que es marcar=true, y se perdia la
                // intencion: desactivar un recordatorio dejaba marcas de apagado
                // para ocurrencias que todavia no habian ocurrido, que es justo
                // lo que este parametro existe para evitar.
                detenerAlarma(
                    ctx, idAlarma, fila.getString(EXTRA_CLAVE), fecha,
                    fila.getInt(EXTRA_ID_NOTIF), marcar);
            } catch (JSONException e) {
                // fila incompleta: se ignora
            }
        }
    }

    /**
     * Saca de AlarmManager y de la barra todo lo que quedara de una alarma que
     * ya no existe. Sin esto, un recordatorio borrado fuera de la app (otro
     * dispositivo, la base de datos) seguia sonando los 8 dias de su ventana.
     */
    public static void desprogramarAlarmas(Context ctx, String idAlarma) {
        if (idAlarma == null || idAlarma.isEmpty()) {
            return;
        }
        limpiarProgramadasDe(ctx, idAlarma);
        ctx.getSharedPreferences(SiempreCercaPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(PREFIJO_SONANDO + idAlarma)
            .apply();
        Log.i(TAG, "Alarma desprogramada por completo: " + idAlarma);
    }

    // =====================================================
    // RECEPCIÓN
    // =====================================================

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            recibir(context, intent);
        } catch (Exception e) {
            // Sin esto, una excepcion aqui (por ejemplo una RemoteServiceException
            // de nm.notify) tumba el proceso y la cadena de reemision se rompe
            // sin dejar rastro. El sonido se sostiene con FLAG_INSISTENT, asi que
            // no es fatal, pero hay que saberlo.
            Log.e(TAG, "Fallo procesando la alarma: " + intent.getAction(), e);
        }
    }

    private void recibir(Context context, Intent intent) {
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
            forgetSonando(context, idAlarma);
            return;
        }

        if (estaApagada(context, idAlarma, clave)) {
            // El usuario ya la apago: se limpia y no se rearma.
            nm.cancel(idNotificacion);
            forgetSonando(context, idAlarma);
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

        // Estos extras van en el BUNDLE de la notificacion, no solo en el
        // intent de apertura. Antes solo estaban en el contentIntent, y el
        // plugin de la app (getDeliveredNotifications) lee el bundle: sin esto
        // nunca encontraba estas notificaciones y la limpieza de notificaciones
        // vencidas era codigo muerto que no limpiaba nada.
        Bundle extras = new Bundle();
        extras.putString("tipo", "recordatorio");
        extras.putString(EXTRA_ID_ALARMA, idAlarma);
        extras.putLong(EXTRA_FECHA, fecha);

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
                .addExtras(extras)
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
        NotificationChannel existente = nm.getNotificationChannel(SiempreCercaPlugin.CANAL_ALARMA_ID);
        if (existente != null) {
            // Un canal apagado a proposito en Ajustes del sistema se respeta.
            // Uno encendido y mudo es un fallo, no una decision del usuario: se
            // borra y se rehace, o el recordatorio se limita a enseñar la
            // notificacion sin sonar. Borrarlo es ademas la unica forma de que
            // Android acepte un sonido nuevo en un canal ya creado.
            if (existente.getImportance() == NotificationManager.IMPORTANCE_NONE
                    || existente.getSound() != null) {
                return;
            }
            Log.w(TAG, "El canal de alarma estaba mudo: se borra y se recrea");
            nm.deleteNotificationChannel(SiempreCercaPlugin.CANAL_ALARMA_ID);
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

        Uri sonido = SiempreCercaPlugin.sonidoAlarma(context);
        if (sonido != null) {
            canal.setSound(
                sonido,
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        }
        nm.createNotificationChannel(canal);
        Log.i(TAG, "Canal de alarma creado. Sonido=" + (sonido != null ? sonido : "NINGUNO"));
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
            Log.w(TAG, "Sin AlarmManager: la alarma " + idNotificacion + " queda solo guardada, no armada");
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
            // Sin permiso de alarma exacta: se usa la ventana laxa. Sin este
            // registro no habia forma de saber por que una alarma rearmada
            // empezo a llegar tarde.
            Log.w(TAG, "Sin permiso de alarma exacta, se usa la ventana laxa para " + idNotificacion);
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

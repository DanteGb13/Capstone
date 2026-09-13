package io.ionic.starter;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SiempreCerca")
public class SiempreCercaPlugin extends Plugin {

    public static final String CANAL_ALARMA_ID = "recordatorios-alarma";

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
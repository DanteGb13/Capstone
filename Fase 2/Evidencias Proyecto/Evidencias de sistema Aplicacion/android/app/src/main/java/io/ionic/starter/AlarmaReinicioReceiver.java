package io.ionic.starter;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Vuelve a programar las alarmas de los recordatorios cuando el telefono se
 * reinicia, se actualiza la app o cambia la hora o la zona, porque Android
 * borra o desplaza las alarmas de AlarmManager en esos casos. La app todavia no
 * ha podido sincronizar con el servidor a esa hora, asi que se usan las que
 * quedaron guardadas.
 */
public class AlarmaReinicioReceiver extends BroadcastReceiver {

    private static final String TAG = "AlarmaReinicio";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null || intent.getAction() == null) {
            return;
        }
        try {
            AlarmaNativaReceiver.rearmendar(context);
        } catch (Exception e) {
            // Si falla, la proxima sincronizacion de la app vuelve a programarlas.
            // Antes este catch estaba mudo y un fallo tras el reinicio era
            // indiagnosticable: las alarmas simplemente no sonaban.
            Log.e(TAG, "No se pudieron rearmar las alarmas tras " + intent.getAction(), e);
        }
    }
}

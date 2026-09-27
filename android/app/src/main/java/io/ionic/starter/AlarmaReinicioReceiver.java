package io.ionic.starter;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Vuelve a programar las alarmas de los recordatorios cuando el telefono se
 * reinicia o se actualiza la app, porque Android borra las alarmas de
 * AlarmManager en ambos casos. La app todavia no ha podido sincronizar con el
 * servidor a esa hora, asi que se usan las que quedaron guardadas.
 */
public class AlarmaReinicioReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null || intent.getAction() == null) {
            return;
        }
        try {
            AlarmaNativaReceiver.rearmendar(context);
        } catch (Exception e) {
            // Si falla, la proxima sincronizacion de la app vuelve a programarlas.
        }
    }
}

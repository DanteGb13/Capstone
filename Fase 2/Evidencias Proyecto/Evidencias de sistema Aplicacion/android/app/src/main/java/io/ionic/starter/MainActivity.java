package io.ionic.starter;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SiempreCercaPlugin.class);
        registerPlugin(UbicacionForegroundPlugin.class);
        registerPlugin(PermisosExtraPlugin.class);
        registerPlugin(VozPlugin.class);
        registerPlugin(AbrirUrlPlugin.class);
        super.onCreate(savedInstanceState);

        // Canales de notificación listos desde el arranque:
        // si llega un SOS o una alerta de zona antes de abrir un panel,
        // Android ya sabe con qué vibración/sonido mostrarla.
        SiempreCercaPlugin.crearCanales(this);

        // Android borra las alarmas de AlarmManager al reiniciar o al
        // actualizar la app, y el broadcast de reinicio no siempre llega
        // (si la app quedó detenida, no lo recibe). Al abrirla se vuelven a
        // armar las que quedaron guardadas, así que ninguna se queda muda.
        AlarmaNativaReceiver.rearmendar(this);
    }
}
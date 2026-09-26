package io.ionic.starter;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SiempreCercaPlugin.class);
        registerPlugin(UbicacionForegroundPlugin.class);
        registerPlugin(PermisosExtraPlugin.class);
        super.onCreate(savedInstanceState);

        // Canales de notificación listos desde el arranque:
        // si llega un SOS o una alerta de zona antes de abrir un panel,
        // Android ya sabe con qué vibración/sonido mostrarla.
        SiempreCercaPlugin.crearCanales(this);
    }
}
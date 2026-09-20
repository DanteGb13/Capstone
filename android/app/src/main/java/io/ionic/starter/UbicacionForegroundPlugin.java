package io.ionic.starter;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "UbicacionForeground",
    permissions = {
        @Permission(
            alias = "UbicacionForeground",
            strings = {
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public class UbicacionForegroundPlugin extends Plugin {

    private PluginCall pendingCall;

    // =====================================================
    // INICIAR SERVICIO - SOLO PIDE PERMISO FOREGROUND
    // =====================================================

    @PluginMethod
    public void iniciar(PluginCall call) {
        long intervalo = call.getInt("intervaloMs", 30000);
        float distancia = (float) call.getDouble("distanciaMinimaM", 20.0).floatValue();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean tieneFine = getContext().checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            boolean tieneCoarse = getContext().checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;

            if (!tieneFine && !tieneCoarse) {
                pendingCall = call;
                requestPermissionForAlias("UbicacionForeground", call, "permisosUbicacion");
                return;
            }
        }

        iniciarServicio(intervalo, distancia, call);
    }

    // =====================================================
    // CALLBACK: PERMISO FOREGROUND CONCEDIDO O DENEGADO
    // =====================================================

    @PermissionCallback
    private void permisosUbicacion(PluginCall call) {
        boolean concedido = getContext().checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || getContext().checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;

        if (!concedido) {
            abrirAjustes(call);
            return;
        }

        long intervalo = call.getInt("intervaloMs", 30000);
        float distancia = (float) call.getDouble("distanciaMinimaM", 20.0).floatValue();
        iniciarServicio(intervalo, distancia, call);
    }

    // =====================================================
    // VERIFICAR PERMISOS
    // =====================================================

    @PluginMethod
    public void verificarPermisos(PluginCall call) {
        boolean tieneForeground = getContext().checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || getContext().checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;

        boolean tieneBackground = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            tieneBackground = getContext().checkSelfPermission("android.permission.ACCESS_BACKGROUND_LOCATION")
                    == PackageManager.PERMISSION_GRANTED;
        }

        JSObject ret = new JSObject();
        ret.put("ubicacionForeground", tieneForeground);
        ret.put("ubicacionBackground", tieneBackground);
        call.resolve(ret);
    }

    // =====================================================
    // ABRIR AJUSTES DE LA APP
    // =====================================================

    @PluginMethod
    public void abrirAjustes(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("ajustesAbiertos", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo abrir Ajustes", e);
        }
    }

    // =====================================================
    // INICIAR EL SERVICIO FOREGROUND
    // =====================================================

    private void iniciarServicio(long intervalo, float distancia, PluginCall call) {
        Intent intent = new Intent(getContext(), UbicacionForegroundService.class);
        intent.setAction(UbicacionForegroundService.ACTION_START);
        intent.putExtra(UbicacionForegroundService.EXTRA_INTERVAL_MS, intervalo);
        intent.putExtra(UbicacionForegroundService.EXTRA_MIN_DISTANCE_M, distancia);

        getContext().startForegroundService(intent);

        JSObject ret = new JSObject();
        ret.put("iniciado", true);
        call.resolve(ret);
    }

    // =====================================================
    // DETENER SERVICIO
    // =====================================================

    @PluginMethod
    public void detener(PluginCall call) {
        Intent intent = new Intent(getContext(), UbicacionForegroundService.class);
        intent.setAction(UbicacionForegroundService.ACTION_STOP);
        getContext().startService(intent);

        JSObject ret = new JSObject();
        ret.put("detenido", true);
        call.resolve(ret);
    }

    // =====================================================
    // VERIFICAR SI EL SERVICIO ESTÁ ACTIVO
    // =====================================================

    @PluginMethod
    public void estaActivo(PluginCall call) {
        boolean activo = UbicacionForegroundService.isRunning;
        JSObject ret = new JSObject();
        ret.put("activo", activo);
        call.resolve(ret);
    }
}

package io.ionic.starter;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;

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
        ),
        // El permiso de ubicación en segundo plano va aparte a propósito: desde
        // Android 11 el sistema NO lo concede si se pide en el mismo diálogo que
        // el de primer plano. Hay que conceder foreground primero y después
        // pedir background por separado (o abrir Ajustes).
        @Permission(
            alias = "UbicacionBackground",
            strings = {
                android.Manifest.permission.ACCESS_BACKGROUND_LOCATION
            }
        )
    }
)
public class UbicacionForegroundPlugin extends Plugin {

    private static final String PREFS = "sc_prefs";

    private PluginCall pendingCall;

    // =====================================================
    // INICIAR SERVICIO - SOLO PIDE PERMISO FOREGROUND
    // =====================================================

    @PluginMethod
    public void iniciar(PluginCall call) {
        long intervalo = call.getInt("intervaloMs", 30000);
        float distancia = (float) call.getDouble("distanciaMinimaM", 20.0).floatValue();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean tieneFine = concedido(android.Manifest.permission.ACCESS_FINE_LOCATION);
            boolean tieneCoarse = concedido(android.Manifest.permission.ACCESS_COARSE_LOCATION);

            if (!tieneFine && !tieneCoarse) {
                marcarPreguntadoUbicacion();
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
        boolean fine = concedido(android.Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = concedido(android.Manifest.permission.ACCESS_COARSE_LOCATION);

        if (!fine && !coarse) {
            // Denegado. Si el sistema ya no va a mostrar el diálogo, avisar para
            // que la app mande a Ajustes en vez de pedirlo una y otra vez.
            //
            // Se resuelve `iniciado: false` y no sólo las flags del permiso:
            // el llamador lee ese campo para saber si el servicio quedó
            // corriendo, y devolverlo ausente lo volvía `undefined`.
            JSObject ret = new JSObject();
            ret.put("iniciado", false);
            ret.put("concedido", false);
            ret.put("puedePedir", puedePedir(android.Manifest.permission.ACCESS_FINE_LOCATION));
            call.resolve(ret);
            return;
        }

        long intervalo = call.getInt("intervaloMs", 30000);
        float distancia = (float) call.getDouble("distanciaMinimaM", 20.0).floatValue();
        iniciarServicio(intervalo, distancia, call);
    }

    // =====================================================
    // PERMISO DE UBICACIÓN EN SEGUNDO PLANO (PASO SEPARADO)
    // =====================================================

    /**
     * Pide ACCESS_BACKGROUND_LOCATION por separado.
     *
     * En Android 11+ este permiso NO se puede pedir junto con el de primer plano:
     * el sistema lo ignora si van en el mismo diálogo. Por eso la app pide
     * primero el foreground y sólo después, con un toque del usuario, éste.
     * Antes de Android 11 el permiso venía incluido y no hay nada que pedir.
     */
    @PluginMethod
    public void solicitarBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject ret = new JSObject();
            ret.put("concedido", true);
            ret.put("aplica", false);
            call.resolve(ret);
            return;
        }

        if (concedido(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            JSObject ret = new JSObject();
            ret.put("concedido", true);
            ret.put("aplica", true);
            call.resolve(ret);
            return;
        }

        if (concedido(android.Manifest.permission.ACCESS_FINE_LOCATION)
                || concedido(android.Manifest.permission.ACCESS_COARSE_LOCATION)) {
            marcarPreguntadoUbicacion();
            requestPermissionForAlias("UbicacionBackground", call, "permisosBackground");
            return;
        }

        // Sin foreground no tiene sentido pedir background: primero hay que
        // conceder el de primer plano.
        JSObject ret = new JSObject();
        ret.put("concedido", false);
        ret.put("aplica", true);
        ret.put("requiereForeground", true);
        call.resolve(ret);
    }

    @PermissionCallback
    private void permisosBackground(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("aplica", true);
        ret.put("concedido", concedido(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        call.resolve(ret);
    }

    // =====================================================
    // VERIFICAR PERMISOS
    // =====================================================

    /**
     * Estado detallado de la ubicación.
     *
     * Antes esto devolvía un solo booleano y la app lo leía como "sí/no", así
     * que la ubicación aproximada (que el usuario elige a propósito por
     * privacidad) se reportaba igual que la precisa, y el permiso de segundo
     * plano se descartaba aunque el plugin ya lo devolvía. Con esa información
     * la app no podía distinguir "no lo has activado" de "lo activaste
     * aproximado", ni detectar que el segundo plano faltaba.
     */
    @PluginMethod
    public void verificarPermisos(PluginCall call) {
        boolean precisa = concedido(android.Manifest.permission.ACCESS_FINE_LOCATION);
        boolean aproximada = concedido(android.Manifest.permission.ACCESS_COARSE_LOCATION);

        boolean background = true;
        boolean aplicaBackground = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            aplicaBackground = true;
            background = concedido(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        }

        JSObject ret = new JSObject();
        // Se mantiene el par original para no romper el código existente.
        ret.put("ubicacionForeground", precisa || aproximada);
        ret.put("ubicacionBackground", background);
        // Lo nuevo, en detalle.
        ret.put("precisa", precisa);
        ret.put("aproximada", !precisa && aproximada);
        ret.put("backgroundAplica", aplicaBackground);
        ret.put("servicioActivo", UbicacionForegroundService.isRunning);
        ret.put("puedePedirForeground", puedePedir(android.Manifest.permission.ACCESS_FINE_LOCATION));
        ret.put("puedePedirBackground", aplicaBackground
                && puedePedir(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        call.resolve(ret);
    }

    // =====================================================
    // UTILIDADES DE PERMISOS
    // =====================================================

    private boolean concedido(String permiso) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return getContext().checkSelfPermission(permiso) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * ¿El sistema todavía va a mostrar el diálogo de este permiso?
     *
     * shouldShowRequestPermissionRationale devuelve false tanto si nunca se
     * pidió como si el usuario ya lo denegó de forma permanente ("no volver a
     * preguntar"). Por eso se combina con un registro de "ya lo pedimos": sólo
     * cuando sabemos que ya se preguntó y el sistema no muestra el diálogo se
     * concludes que está bloqueado para siempre.
     */
    private boolean puedePedir(String permiso) {
        if (concedido(permiso)) return false;

        Context contexto = getContext();
        SharedPreferences prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        String clave = "preguntado_" + permiso;
        boolean yaPreguntado = prefs.getBoolean(clave, false);

        boolean muestraDialogo = ActivityCompat.shouldShowRequestPermissionRationale(
                getActivity(), permiso);

        if (muestraDialogo) return true;

        // false + nunca preguntado -> el diálogo igual aparecerá.
        // false + ya preguntado  -> el usuario lo bloqueó de forma permanente.
        return !yaPreguntado;
    }

    /**
     * Deja constancia de que ya se mostró el diálogo de estos permisos, para
     * poder distinguir "nunca se pidió" de "el usuario lo bloqueó siempre".
     */
    private void marcarPreguntadoUbicacion() {
        getContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("preguntado_" + android.Manifest.permission.ACCESS_FINE_LOCATION, true)
                .putBoolean("preguntado_" + android.Manifest.permission.ACCESS_COARSE_LOCATION, true)
                .putBoolean("preguntado_" + android.Manifest.permission.ACCESS_BACKGROUND_LOCATION, true)
                .apply();
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

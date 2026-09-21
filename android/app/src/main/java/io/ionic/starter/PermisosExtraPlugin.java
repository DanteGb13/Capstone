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
    name = "PermisosExtra",
    permissions = {
        @Permission(
            alias = "Telefono",
            strings = {
                android.Manifest.permission.READ_PHONE_STATE,
                android.Manifest.permission.CALL_PHONE
            }
        ),
        @Permission(
            alias = "Contactos",
            strings = {
                android.Manifest.permission.READ_CONTACTS
            }
        )
    }
)
public class PermisosExtraPlugin extends Plugin {

    private PluginCall pendingCall;
    private String permisoPendiente;

    // =====================================================
    // REALIZAR LLAMADA TELEFÓNICA
    // =====================================================

    @PluginMethod
    public void realizarLlamada(PluginCall call) {
        String telefono = call.getString("telefono", "");
        if (telefono.isEmpty()) {
            call.reject("No se proporcionó número de teléfono");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_CALL);
            intent.setData(Uri.parse("tel:" + telefono));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("llamada", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo realizar la llamada", e);
        }
    }

    // =====================================================
    // ENVIAR SMS
    // =====================================================

    @PluginMethod
    public void enviarSMS(PluginCall call) {
        String telefono = call.getString("telefono", "");
        String mensaje = call.getString("mensaje", "");

        if (telefono.isEmpty()) {
            call.reject("No se proporcionó número de teléfono");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_SENDTO);
            intent.setData(Uri.parse("smsto:" + telefono));
            intent.putExtra("sms_body", mensaje);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("sms", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo enviar el SMS", e);
        }
    }

    // =====================================================
    // SOLICITAR PERMISO DE TELÉFONO
    // =====================================================

    @PluginMethod
    public void solicitarTelefono(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean tieneState = getContext().checkSelfPermission(android.Manifest.permission.READ_PHONE_STATE)
                    == PackageManager.PERMISSION_GRANTED;
            boolean tieneCall = getContext().checkSelfPermission(android.Manifest.permission.CALL_PHONE)
                    == PackageManager.PERMISSION_GRANTED;

            if (!tieneState && !tieneCall) {
                pendingCall = call;
                permisoPendiente = "Telefono";
                requestPermissionForAlias("Telefono", call, "callbackTelefono");
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("concedido", true);
        call.resolve(ret);
    }

    @PermissionCallback
    private void callbackTelefono(PluginCall call) {
        boolean concedido = getContext().checkSelfPermission(android.Manifest.permission.READ_PHONE_STATE)
                == PackageManager.PERMISSION_GRANTED
                || getContext().checkSelfPermission(android.Manifest.permission.CALL_PHONE)
                == PackageManager.PERMISSION_GRANTED;

        if (!concedido) {
            abrirAjustes(call);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("concedido", true);
        call.resolve(ret);
    }

    // =====================================================
    // SOLICITAR PERMISO DE CONTACTOS
    // =====================================================

    @PluginMethod
    public void solicitarContactos(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean tiene = getContext().checkSelfPermission(android.Manifest.permission.READ_CONTACTS)
                    == PackageManager.PERMISSION_GRANTED;

            if (!tiene) {
                pendingCall = call;
                permisoPendiente = "Contactos";
                requestPermissionForAlias("Contactos", call, "callbackContactos");
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("concedido", true);
        call.resolve(ret);
    }

    @PermissionCallback
    private void callbackContactos(PluginCall call) {
        boolean concedido = getContext().checkSelfPermission(android.Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;

        if (!concedido) {
            abrirAjustes(call);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("concedido", true);
        call.resolve(ret);
    }

    // =====================================================
    // VERIFICAR PERMISOS
    // =====================================================

    @PluginMethod
    public void verificarPermisos(PluginCall call) {
        boolean tieneTelefono = getContext().checkSelfPermission(android.Manifest.permission.READ_PHONE_STATE)
                == PackageManager.PERMISSION_GRANTED
                || getContext().checkSelfPermission(android.Manifest.permission.CALL_PHONE)
                == PackageManager.PERMISSION_GRANTED;

        boolean tieneContactos = getContext().checkSelfPermission(android.Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;

        JSObject ret = new JSObject();
        ret.put("telefono", tieneTelefono);
        ret.put("contactos", tieneContactos);
        call.resolve(ret);
    }

    // =====================================================
    // ABRIR AJUSTES
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
}

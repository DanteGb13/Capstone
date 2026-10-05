package io.ionic.starter;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
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
                android.Manifest.permission.READ_CONTACTS,
                android.Manifest.permission.WRITE_CONTACTS
            }
        ),
        @Permission(
            alias = "Actividad",
            strings = {
                android.Manifest.permission.ACTIVITY_RECOGNITION
            }
        )
    }
)
public class PermisosExtraPlugin extends Plugin {

    private PluginCall pendingCall;
    private String permisoPendiente;
    /** Guarda la llamada del selector por si Android entrega el resultado sin ella. */
    private PluginCall pendingPickCall;

    // =====================================================
    // PERMISO DE ACTIVIDAD (PASOS Y DISTANCIA)
    // =====================================================

    /**
     * Permiso de reconocimiento de actividad física.
     *
     * Es lo que habilita la lectura de PASOS y DISTANCIA desde Health Connect
     * en Android 10 y superior. El plugin de salud declara los permisos propios
     * de Health Connect (READ_STEPS y compañía) pero NO éste, que es un permiso
     * normal de Android: tiene que declararlo la app en el manifiesto y
     * pedirse en runtime.
     *
     * Antes de esto la app leía el sueño, el oxígeno y las calorías (que no
     * dependen del sensor de pasos) pero los pasos nunca llegaban, en silencio:
     * Health Connect devolvía vacío y la app no tenía forma de saber por qué.
     */
    @PluginMethod
    public void verificarActividad(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("concedido", tienePermisoActividad());
        call.resolve(ret);
    }

    @PluginMethod
    public void solicitarActividad(PluginCall call) {
        if (tienePermisoActividad()) {
            JSObject ret = new JSObject();
            ret.put("concedido", true);
            call.resolve(ret);
            return;
        }

        requestPermissionForAlias("Actividad", call, "callbackActividad");
    }

    @PermissionCallback
    private void callbackActividad(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("concedido", tienePermisoActividad());
        call.resolve(ret);
    }

    private boolean tienePermisoActividad() {
        // Antes de Android 10 este permiso no existe y el sensor de pasos es de
        // libre acceso, así que se da por concedido.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return true;
        }
        return getContext().checkSelfPermission(android.Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED;
    }

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
            if (!tienePermisoContactos()) {
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
        boolean concedido = tienePermisoContactos();

        if (!concedido) {
            // Se ofrece la pantalla de ajustes, pero la llamada se resuelve con
            // el estado real. Antes se resolvía con abrirAjustes(), que no
            // incluye "concedido" y por eso la app siempre decía que fallaba.
            // La pantalla de contacto pide "abrirAjustes: false" porque allí se
            // muestra su propio aviso con botón de ajustes.
            if (call.getBoolean("abrirAjustes", true)) {
                abrirPantallaAjustes();
            }
            JSObject ret = new JSObject();
            ret.put("concedido", false);
            call.resolve(ret);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("concedido", true);
        call.resolve(ret);
    }

    /** El selector de contactos exige lectura y escritura; ambas cuentan. */
    private boolean tienePermisoContactos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        return getContext().checkSelfPermission(android.Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED
                && getContext().checkSelfPermission(android.Manifest.permission.WRITE_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
    }

    // =====================================================
    // ELEGIR UN CONTACTO DE LA AGENDA
    // =====================================================

    /**
     * Abre la agenda del teléfono para elegir UN contacto.
     *
     * El plugin de la comunidad dispara ACTION_PICK sin tipo MIME, y Android
     * responde con un selector que incluye el explorador de archivos y otras
     * apps. Fijando el tipo de contactos el sistema va directo a la agenda, que
     * es lo que necesita entender alguien mayor.
     */
    @PluginMethod
    public void pickContacto(PluginCall call) {
        // Elegir un contacto sólo LEE la agenda: basta con READ_CONTACTS.
        if (!tieneLecturaContactos()) {
            call.reject("Falta el permiso de contactos", "PERMISO_CONTACTOS");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI);
            intent.setType(ContactsContract.Contacts.CONTENT_TYPE);
            pendingPickCall = call;
            startActivityForResult(call, intent, "callbackPickContacto");
        } catch (Exception e) {
            pendingPickCall = null;
            call.reject("No se pudo abrir la agenda de contactos", e);
        }
    }

    /** Sólo lectura: es lo que exige ACTION_PICK. */
    private boolean tieneLecturaContactos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        return getContext().checkSelfPermission(android.Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
    }

    @ActivityCallback
    private void callbackPickContacto(PluginCall call, ActivityResult resultado) {
        // A veces el resultado llega sin la llamada original (p. ej. tras
        // recrearse la actividad). Devolviendo sin resolver, la app se quedaba
        // esperando una promesa que nunca contestaba y el primer contacto
        // "no hacía nada": se usa la llamada guardada al abrir la agenda.
        PluginCall efectiva = call != null ? call : pendingPickCall;
        pendingPickCall = null;
        if (efectiva == null) return;

        Uri uri = resultado != null && resultado.getData() != null
                ? resultado.getData().getData()
                : null;

        if (resultado == null || resultado.getResultCode() != Activity.RESULT_OK || uri == null) {
            // Se cerró la agenda sin elegir a nadie: no es un error, pero se
            // marca para que la app sepa que no vino ningún contacto.
            JSObject ret = new JSObject();
            ret.put("cancelado", true);
            efectiva.resolve(ret);
            return;
        }

        try {
            efectiva.resolve(leerContacto(uri));
        } catch (Exception e) {
            efectiva.reject("No se pudo leer el contacto elegido", e);
        }
    }

    /** Nombre, apellido, teléfono y correo del contacto elegido. */
    private JSObject leerContacto(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        JSObject ret = new JSObject();

        String id = null;
        String nombre = "";
        String apellido = "";

        Cursor contacto = resolver.query(
                uri,
                new String[]{
                        ContactsContract.Contacts._ID,
                        ContactsContract.Contacts.DISPLAY_NAME
                },
                null, null, null);

        if (contacto != null) {
            try {
                if (contacto.moveToFirst()) {
                    id = contacto.getString(0);
                    String display = contacto.getString(1);
                    if (display != null) {
                        nombre = display.trim();
                    }
                }
            } finally {
                contacto.close();
            }
        }

        if (id == null) {
            ret.put("nombre", nombre);
            ret.put("apellido", "");
            ret.put("telefono", "");
            ret.put("correo", "");
            return ret;
        }

        // El nombre completo no siempre viene separado
        Cursor estructura = resolver.query(
                ContactsContract.Data.CONTENT_URI,
                new String[]{
                        ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME,
                        ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME
                },
                ContactsContract.CommonDataKinds.StructuredName.CONTACT_ID + " = ?",
                new String[]{id}, null);

        if (estructura != null) {
            try {
                if (estructura.moveToFirst()) {
                    String dado = estructura.getString(0);
                    String familia = estructura.getString(1);
                    if (dado != null && !dado.isEmpty()) {
                        nombre = dado.trim();
                    }
                    if (familia != null && !familia.isEmpty()) {
                        apellido = familia.trim();
                    }
                }
            } finally {
                estructura.close();
            }
        }

        ret.put("nombre", nombre);
        ret.put("apellido", apellido);
        ret.put("telefono", primerTelefono(resolver, id));
        ret.put("correo", primerCorreo(resolver, id));
        return ret;
    }

    private String primerTelefono(ContentResolver resolver, String idContacto) {
        String encontrado = "";

        Cursor c = resolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{
                        ContactsContract.CommonDataKinds.Phone.NUMBER,
                        ContactsContract.CommonDataKinds.Phone.IS_PRIMARY
                },
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " = ?",
                new String[]{idContacto}, null);

        if (c == null) return "";

        try {
            while (c.moveToNext()) {
                String numero = c.getString(0);
                if (numero == null || numero.trim().isEmpty()) continue;

                if (c.getInt(1) == 1) {
                    return numero.trim();
                }
                if (encontrado.isEmpty()) {
                    encontrado = numero.trim();
                }
            }
        } finally {
            c.close();
        }

        return encontrado;
    }

    private String primerCorreo(ContentResolver resolver, String idContacto) {
        String encontrado = "";

        Cursor c = resolver.query(
                ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                new String[]{
                        ContactsContract.CommonDataKinds.Email.ADDRESS,
                        ContactsContract.CommonDataKinds.Email.IS_PRIMARY
                },
                ContactsContract.CommonDataKinds.Email.CONTACT_ID + " = ?",
                new String[]{idContacto}, null);

        if (c == null) return "";

        try {
            while (c.moveToNext()) {
                String correo = c.getString(0);
                if (correo == null || correo.trim().isEmpty()) continue;

                if (c.getInt(1) == 1) {
                    return correo.trim();
                }
                if (encontrado.isEmpty()) {
                    encontrado = correo.trim();
                }
            }
        } finally {
            c.close();
        }

        return encontrado;
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

        boolean tieneContactos = tienePermisoContactos();

        JSObject ret = new JSObject();
        ret.put("telefono", tieneTelefono);
        ret.put("contactos", tieneContactos);
        call.resolve(ret);
    }

    // =====================================================
    // ABRIR AJUSTES
    // =====================================================

    private boolean abrirPantallaAjustes() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void abrirAjustes(PluginCall call) {
        boolean abierto = abrirPantallaAjustes();

        if (!abierto) {
            call.reject("No se pudo abrir Ajustes");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("ajustesAbiertos", true);
        call.resolve(ret);
    }
}

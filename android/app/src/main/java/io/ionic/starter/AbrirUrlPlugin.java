package io.ionic.starter;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Abre una URL fuera de la app.
 *
 * Con ventana: selector (chooser) para que la persona elija con qué aplicación
 * continuar (Google Maps, OpenStreetMap, Waze, el navegador, etc.). Con
 * geo: o una URL web, Android salta directo a la única app que encuentra y no
 * deja elegir.
 *
 * Waze es un caso especial: ignora el formato "geo:" (ese es de Google Maps) y
 * además no siempre resuelve bien la URL, así que el selector lo agrega como
 * opción aparte usando su deep link oficial "https://waze.com/ul?q=...". El resto
 * de apps de mapas reciben el "geo:". La dirección se manda siempre en texto,
 * nunca como punto, para que cada app la ubique con sus propios datos.
 */
@CapacitorPlugin(name = "AbrirUrl")
public class AbrirUrlPlugin extends Plugin {

    private static final String TAG = "AbrirUrl";
    private static final String PAQUETE_WAZE = "com.waze";


    /**
     * abrir({ url, titulo, selector, wazeUrl })
     *  - url: dirección a abrir.
     *  - titulo: texto del selector (por ejemplo "Elige una aplicación").
     *  - selector: true muestra el selector del sistema; false abre directo.
     *  - wazeUrl: deep link oficial de Waze (https://waze.com/ul?...) para
     *    mostrar a Waze en el selector.
     * Devuelve { abierto: true/false } según si el sistema pudo abrir algo.
     */
    @PluginMethod
    public void abrir(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Falta la URL");
            return;
        }

        String titulo = call.getString("titulo", "Elige una aplicación");
        boolean selector = Boolean.TRUE.equals(call.getBoolean("selector", Boolean.FALSE));
        String wazeUrl = call.getString("wazeUrl", null);

        Log.i(TAG, "abrir url=" + url + " | waze=" + wazeUrl + " | selector=" + selector);

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));

            Intent aLanzar = intent;

            if (selector) {
                aLanzar = construirSelector(intent, titulo, wazeUrl);
            }

            getBridge().getActivity().startActivity(aLanzar);

            JSObject ret = new JSObject();
            ret.put("abierto", true);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            // Ninguna aplicación del teléfono sabe abrir esta URL
            JSObject ret = new JSObject();
            ret.put("abierto", false);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo abrir la URL", e);
        }
    }

    /**
     * Arma el selector con la lista exacta de aplicaciones de mapas.
     *
     * Waze también está registrado como manejador de "geo:", pero ignora ese
     * formato, así que si se lo dejamos resolver por su cuenta aparecía con una
     * entrada inútil y la persona podía tocar esa. La base del selector es el
     * deep link oficial de Waze (que el sistema sí resuelve y abre bien) y el
     * resto de apps de mapas se agregan como intents adicionales con su geo:.
     *
     * La base del selector NO puede dejar de resolver: en Android de Xiaomi los
     * intents iniciales no se muestran si la base no apunta a ninguna app.
     */
    private Intent construirSelector(Intent geoIntent, String titulo, String wazeUrl) {
        PackageManager pm = getBridge().getContext().getPackageManager();

        List<Intent> mapaApps = new ArrayList<>();

        List<ResolveInfo> candidatas = pm.queryIntentActivities(
            geoIntent,
            PackageManager.MATCH_DEFAULT_ONLY
        );

        for (ResolveInfo info : candidatas) {
            String paquete = info.activityInfo != null ? info.activityInfo.packageName : null;
            String clase = info.activityInfo != null ? info.activityInfo.name : null;

            if (paquete == null || clase == null || PAQUETE_WAZE.equals(paquete)) {
                continue;
            }

            Intent explicita = new Intent(geoIntent);
            explicita.setClassName(paquete, clase);
            mapaApps.add(explicita);
        }

        Intent waze = crearIntentWaze(wazeUrl);

        // Sin Waze en el teléfono: selector normal con las apps de mapas.
        if (waze == null) {
            Log.i(TAG, "Selector normal con " + mapaApps.size() + " apps de mapas");
            return Intent.createChooser(geoIntent, titulo);
        }

        Intent chooser = Intent.createChooser(new Intent(waze), titulo);

        if (!mapaApps.isEmpty()) {
            chooser.putExtra(
                Intent.EXTRA_INITIAL_INTENTS,
                mapaApps.toArray(new Intent[0])
            );
        }

        Log.i(TAG, "Selector: Waze + " + mapaApps.size() + " apps de mapas");

        return chooser;
    }

    /**
     * Intent que abre Waze en la actividad que realmente entiende la URL.
     *
     * No basta con poner el paquete: con setPackage("com.waze") el sistema
     * resolvía a com.waze/.MainActivity, que ignora los parámetros, y Waze
     * abría sin mostrar la dirección. Hay que localizar la actividad de Waze que
     * declara el filtro de waze.com y apuntar ahí directamente.
     */
    private Intent crearIntentWaze(String wazeUrl) {
        if (wazeUrl == null || wazeUrl.trim().isEmpty()) {
            return null;
        }

        if (!wazeInstalado()) {
            return null;
        }

        String url = wazeUrl.trim();

        // 1) Deep link oficial documentado por Waze: https://waze.com/ul?...
        Intent oficial = this.fijarActividadWaze(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        if (oficial != null) {
            Log.i(TAG, "Waze recibira el deep link oficial en " + oficial.getComponent());
            return oficial;
        }

        // 2) Alternativa: el esquema propio de Waze.
        Intent esquema = this.fijarActividadWaze(
            new Intent(
                Intent.ACTION_VIEW,
                Uri.parse(url.replaceFirst("^https://waze[.]com/ul", "waze://"))
            )
        );
        if (esquema != null) {
            Log.i(TAG, "Waze recibira su esquema propio en " + esquema.getComponent());
            return esquema;
        }

        // 3) Sin actividad_localizada: se deja que el sistema decida.
        Intent simple = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        simple.setPackage(PAQUETE_WAZE);
        return simple;
    }

    /**
     * Busca la actividad de Waze que declara el filtro para esta URL y la fija
     * como componente exacto. Devuelve null si Waze no puede abrirla.
     */
    private Intent fijarActividadWaze(Intent intent) {
        PackageManager pm = getBridge().getContext().getPackageManager();

        List<ResolveInfo> coincidencias = pm.queryIntentActivities(
            intent,
            PackageManager.MATCH_DEFAULT_ONLY
        );

        for (ResolveInfo info : coincidencias) {
            if (info.activityInfo == null) {
                continue;
            }
            if (!PAQUETE_WAZE.equals(info.activityInfo.packageName)) {
                continue;
            }

            Intent exacta = new Intent(intent);
            exacta.setClassName(PAQUETE_WAZE, info.activityInfo.name);
            return exacta;
        }

        return null;
    }

    private boolean wazeInstalado() {
        try {
            getBridge()
                .getContext()
                .getPackageManager()
                .getPackageInfo(PAQUETE_WAZE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}

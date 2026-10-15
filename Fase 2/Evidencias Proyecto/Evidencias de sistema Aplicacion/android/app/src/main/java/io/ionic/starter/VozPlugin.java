package io.ionic.starter;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.accessibility.AccessibilityManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Lectura en voz alta con el motor de voz del propio Android.
 *
 * A diferencia del dictado, ESTO NO PIDE NINGÚN PERMISO: `TextToSpeech` sólo
 * reproduce sonidos con el sintetizador que el teléfono ya trae instalado. Por
 * eso esta ayuda no aparece en la pantalla de Permisos: no hay nada que
 * activar ahí.
 *
 * Lo que hace es lo mismo que TalkBack, pero dentro de la app y sin depender de
 * que el usuario lo haya activado en los ajustes del sistema. Por eso `info()`
 * informa si ya hay un lector de pantalla funcionando: si TalkBack está
 * encendido, las dos voces hablarían a la vez y la app avisa en vez de
 * activarse a ciegas.
 */
@CapacitorPlugin(name = "Voz")
public class VozPlugin extends Plugin {

    private static final String ID_LECTURA = "sc-lectura";

    private TextToSpeech tts;

    /** El motor terminó de inicializarse y se puede hablar. */
    private boolean listo = false;

    /**
     * Velocidad y tono actuales.
     *
     * Se llevan aquí a mano porque `getSpeechRate()` y `getPitch()` NO están en
     * la API pública de Android: son métodos ocultos (`@hide`) y no compilan
     * desde una app. Guardar el último valor puesto es la única forma de poder
     * devolverle el dato a la interfaz.
     */
    private float velocidadActual = 1.0f;
    private float tonoActual = 1.0f;

    /**
     * Lo que se pidió hablar mientras el motor todavía arrancaba.
     *
     * `TextToSpeech` tarda en inicializarse y `speak()` antes de eso no dice
     * nada, sin error: la app leería "Cargando" y el usuario no escucharía
     * nunca el mensaje.
     */
    private JSArray pendientes = new JSArray();

    @Override
    public void load() {
        crear();
    }

    private void crear() {
        if (tts != null) return;

        tts = new TextToSpeech(getContext(), status -> {
            listo = (status == TextToSpeech.SUCCESS);
            if (listo) {
                tts.setLanguage(Locale.getDefault());
                tts.setSpeechRate(velocidadActual);
                tts.setPitch(tonoActual);
                tts.setOnUtteranceProgressListener(new Progreso());
            }

            // Se vacía lo que se pidió antes de que estuviera listo.
            JSArray enEspera = pendientes;
            pendientes = new JSArray();
            for (int i = 0; i < enEspera.length(); i++) {
                JSONObject o = enEspera.optJSONObject(i);
                if (o == null) continue;
                hablar(o.optString("texto", ""), o.optBoolean("seguida", false));
            }
        });
    }

    // =====================================================
    // ESTADO
    // =====================================================

    @PluginMethod
    public void info(PluginCall call) {
        crear();

        AccessibilityManager am = (AccessibilityManager)
                getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);

        // isTouchExplorationEnabled() es true con TalkBack o cualquier lector de
        // pantalla. Es la forma correcta de detectar "ya hay alguien leyendo".
        boolean lectorExterno = am != null && am.isTouchExplorationEnabled();

        // Un motor instalado no garantiza que tenga la voz del idioma del
        // teléfono: puede faltar el paquete de datos y entonces speak() calla
        // sin error. Esto es lo que permite distinguirlo.
        boolean hayVoz = listo && hayDatosParaIdioma();

        Locale actual = Locale.getDefault();
        String nombre = actual.getDisplayName();
        if (nombre == null || nombre.isEmpty()) {
            nombre = actual.toLanguageTag();
        }

        JSObject ret = new JSObject();
        ret.put("listo", hayVoz);
        ret.put("motorListo", listo);
        ret.put("lectorExterno", lectorExterno);
        ret.put("velocidad", velocidadActual);
        ret.put("tono", tonoActual);
        ret.put("idioma", nombre);
        call.resolve(ret);
    }

    /** El teléfono tiene descargada la voz del idioma configurado. */
    private boolean hayDatosParaIdioma() {
        if (tts == null) return false;
        int estado = tts.isLanguageAvailable(Locale.getDefault());
        return estado == TextToSpeech.LANG_AVAILABLE
                || estado == TextToSpeech.LANG_COUNTRY_AVAILABLE
                || estado == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE;
    }

    // =====================================================
    // HABLAR
    // =====================================================

    /**
     * Dice UN texto, interrumpiendo lo que se estuviera diciendo.
     *
     * Interrumpir a propósito: si al tocar dos botones seguidos se encolaran los
     * mensajes, alguien con la pantalla de turno lento escucharía "Contactos"
     * tres segundos después de haber tocado "Volver", y ya no sabría dónde está.
     */
    @PluginMethod
    public void hablar(PluginCall call) {
        String texto = call.getString("texto", "");
        if (texto == null || texto.trim().isEmpty()) {
            call.resolve(new JSObject());
            return;
        }
        crear();
        encolarSiHaceFalta(texto, false);
        call.resolve(new JSObject());
    }

    /**
     * Lee varias frases SEGUIDAS, sin interrumpirse.
     *
     * Es lo que se usa para leer una pantalla entera: si cada línea fuera por
     * separado con interrupción, se pisarían entre ellas.
     */
    @PluginMethod
    public void leerLineas(PluginCall call) {
        JSArray lineas = call.getArray("lineas", new JSArray());
        crear();

        for (int i = 0; i < lineas.length(); i++) {
            String texto = lineas.optString(i, "");
            if (texto != null && !texto.trim().isEmpty()) {
                encolarSiHaceFalta(texto, i > 0);
            }
        }
        call.resolve(new JSObject());
    }

    private void encolarSiHaceFalta(String texto, boolean seguida) {
        if (!listo) {
            JSObject o = new JSObject();
            o.put("texto", texto);
            o.put("seguida", seguida);
            pendientes.put(o);
            return;
        }
        hablar(texto, seguida);
    }

    private void hablar(String texto, boolean seguida) {
        int modo = seguida ? TextToSpeech.QUEUE_ADD : TextToSpeech.QUEUE_FLUSH;
        tts.speak(texto, modo, (Bundle) null, ID_LECTURA);
    }

    /** Corta lo que se esté diciendo ahora mismo. */
    @PluginMethod
    public void detener(PluginCall call) {
        if (tts != null) {
            tts.stop();
        }
        pendientes = new JSArray();
        call.resolve(new JSObject());
    }

    // =====================================================
    // AJUSTES
    // =====================================================

    /**
     * Velocidad de habla.
     *
     * Se limita entre 0.5 y 2.0: por debajo de 0.5 Android corta palabras y por
     * encima de 2 no se entiende nada. Los valores sueltos de TTS fuera de ese
     * rango producen un sonido robotizado, no "más rápido".
     */
    @PluginMethod
    public void velocidad(PluginCall call) {
        Float v = call.getFloat("valor");
        crear();

        if (listo && v != null) {
            velocidadActual = Math.max(0.5f, Math.min(2.0f, v));
            tts.setSpeechRate(velocidadActual);
        }

        JSObject ret = new JSObject();
        ret.put("velocidad", velocidadActual);
        call.resolve(ret);
    }

    @PluginMethod
    public void tono(PluginCall call) {
        Float t = call.getFloat("valor");
        crear();

        if (listo && t != null) {
            tonoActual = Math.max(0.5f, Math.min(2.0f, t));
            tts.setPitch(tonoActual);
        }

        JSObject ret = new JSObject();
        ret.put("tono", tonoActual);
        call.resolve(ret);
    }

    /** Abre los ajustes de accesibilidad del sistema, donde vive TalkBack. */
    @PluginMethod
    public void abrirAccesibilidad(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject("No se pudieron abrir los ajustes de accesibilidad.", "SIN_AJUSTES");
        }
    }

    // =====================================================
    // CICLO DE VIDA
    // =====================================================

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        listo = false;
        super.handleOnDestroy();
    }

    /**
     * Avisa de que terminó de hablar.
     *
     * Se hace en el hilo principal porque `notifyListeners` actualiza la
     * interfaz y los eventos del motor llegan desde otro hilo.
     */
    private void notificar(String evento, JSObject datos) {
        getActivity().runOnUiThread(() -> notifyListeners(evento, datos));
    }

    private class Progreso extends UtteranceProgressListener {
        @Override public void onStart(String id) { }

        @Override public void onDone(String id) {
            notificar("fin", new JSObject());
        }

        /**
         * La abstracta de una firma. Se implementa porque
         * `UtteranceProgressListener` la declara abstracta y el hijo tiene que
         * cumplirla, o la clase no compila.
         */
        @Override
        public void onError(String id) {
            avisarFallo(0);
        }

        @Override
        public void onError(String id, int error) {
            avisarFallo(error);
        }

        /**
         * Se avisa para que la interfaz pueda dejar de mostrar "hablando…": si
         * el motor falla a mitad, sin esto la app queda anunciando algo que ya
         * no va a leer.
         */
        private void avisarFallo(int codigo) {
            JSObject o = new JSObject();
            o.put("error", codigo);
            notificar("fin", o);
        }
    }
}

package io.ionic.starter;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

public class UbicacionForegroundService extends Service implements LocationListener {

    private static final String CANAL_UBICACION_ID = "ubicacion-foreground";
    private static final int NOTIFICATION_ID = 9999;
    private static final long MIN_TIME_MS = 30000;
    private static final float MIN_DISTANCE_M = 20;

    public static boolean isRunning = false;

    private LocationManager locationManager;
    private boolean isTracking = false;

    // =====================================================
    // SINCRONIZACIÓN DE SALUD
    //
    // El adulto mayor no tiene que apretar nada para que su cuidador vea sus
    // signos vitales: este servicio ya está vivo por la ubicación, así que
    // aprovecha el mismo proceso para preguntar cada 15 minutos por los datos
    // de Health Connect y subirlos a Supabase.
    //
    // Se eligieron 15 minutos y no 30 porque es lo que tarda la app del
    // fabricante en volcar el reloj a Health Connect: pedirlo más seguido
    // devolvería los mismos números una y otra vez.
    // =====================================================

    private static final long INTERVALO_SALUD_MS = 15 * 60 * 1000;

    private final Handler handlerSalud = new Handler(Looper.getMainLooper());

    /**
     * Lo invoca el plugin para que la app JavaScript sepa que toca sincronizar.
     *
     * El servicio no lee Health Connect ni habla con Supabase: de eso se
     * encarga la capa web, que es la que tiene la sesión iniciada y los
     * permisos ya concedidos.
     */
    public interface SaludCallback {
        void onSyncSaludRequerido();
    }

    private static SaludCallback saludCallback;

    public static void setSaludCallback(SaludCallback cb) {
        saludCallback = cb;
    }

    private final Runnable tareaSyncSalud = new Runnable() {
        @Override
        public void run() {
            if (saludCallback != null) {
                try {
                    saludCallback.onSyncSaludRequerido();
                } catch (Exception e) {
                    android.util.Log.w("UbicacionForeground", "Falló la señal de sincronización de salud", e);
                }
            }
            // Se rearma aunque no haya callback todavía: el plugin puede
            // cargarse más tarde que el servicio y así no se pierde el ciclo.
            handlerSalud.postDelayed(this, INTERVALO_SALUD_MS);
        }
    };

    public static final String ACTION_START = "io.ionic.starter.START_LOCATION";
    public static final String ACTION_STOP = "io.ionic.starter.STOP_LOCATION";
    public static final String EXTRA_INTERVAL_MS = "interval_ms";
    public static final String EXTRA_MIN_DISTANCE_M = "min_distance_m";

    public interface LocationCallback {
        void onLocationChanged(double lat, double lng, float accuracy, long timestamp);
    }

    private static LocationCallback callback;

    public static void setCallback(LocationCallback cb) {
        callback = cb;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        crearCanalNotificacion();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTracking();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        long intervalo = intent != null ? intent.getLongExtra(EXTRA_INTERVAL_MS, MIN_TIME_MS) : MIN_TIME_MS;
        float distancia = intent != null ? intent.getFloatExtra(EXTRA_MIN_DISTANCE_M, MIN_DISTANCE_M) : MIN_DISTANCE_M;

        startTracking(intervalo, distancia);
        return START_STICKY;
    }

    private void startTracking(long intervalo, float distanciaMinima) {
        if (isTracking) return;

        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    stopSelf();
                    return;
                }
            }

            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                intervalo,
                distanciaMinima,
                this,
                Looper.getMainLooper()
            );

            locationManager.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER,
                intervalo,
                distanciaMinima,
                this,
                Looper.getMainLooper()
            );

            isTracking = true;
            isRunning = true;

            // La primera sincronización va a los 15 minutos, no de inmediato:
            // al arrancar la app ya se sube un resumen (ver el panel del
            // adulto mayor) y hacerlo dos veces seguidas sólo gasta batería.
            handlerSalud.removeCallbacks(tareaSyncSalud);
            handlerSalud.postDelayed(tareaSyncSalud, INTERVALO_SALUD_MS);
        } catch (SecurityException e) {
            stopSelf();
        }
    }

    private void stopTracking() {
        if (!isTracking) return;
        try {
            locationManager.removeUpdates(this);
        } catch (Exception ignored) {}
        isTracking = false;
        isRunning = false;
        handlerSalud.removeCallbacks(tareaSyncSalud);
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;

        // Evalúa las zonas seguras aunque la app esté cerrada:
        // llama a la Edge Function evaluar-zona y, si corresponde,
        // avisa a los cuidadores (primera alerta intensa / actualización).
        EvaluacionZonaBackground.evaluar(
            this,
            location.getLatitude(),
            location.getLongitude()
        );

        if (callback != null) {
            callback.onLocationChanged(
                location.getLatitude(),
                location.getLongitude(),
                location.getAccuracy(),
                location.getTime()
            );
        }
    }

    @Override
    public void onProviderDisabled(String provider) {}
    @Override
    public void onProviderEnabled(String provider) {}
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    private Notification buildNotification() {
        Intent notifIntent = new Intent(this, MainActivity.class);
        notifIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notifIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, UbicacionForegroundService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CANAL_UBICACION_ID)
            .setContentTitle("Siempre Cerca")
            .setContentText("Monitoreando ubicación en segundo plano")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", stopPending)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void crearCanalNotificacion() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel canal = new NotificationChannel(
                CANAL_UBICACION_ID,
                "Ubicación en segundo plano",
                NotificationManager.IMPORTANCE_LOW
            );
            canal.setDescription("Mantiene la ubicación activa mientras la app está en uso");
            canal.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(canal);
        }
    }

    @Override
    public void onDestroy() {
        stopTracking();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

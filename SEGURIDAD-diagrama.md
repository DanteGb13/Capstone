# Arquitectura de seguridad — SiempreCerca

Diagrama de las tres capas y dónde está el fallo.

```
   DISPOSITIVO ANDROID                    SERVIDOR                    DATOS
   ───────────────────                    ────────                    ─────

  ┌──────────────┐
  │ Usuario      │
  └──────┬───────┘
         │ navega
         ▼
 ┌───────────────────────────────────────┐
 │  CAPA 1 · GUARDS (Angular)            │   ◄── ¿protege? NO.
 │  ───────────────────────────────────  │       Es JavaScript: una app
 │  authGuard                            │       modificada se lo salta.
 │   · sin sesión      → /login          │       Sirve de UX, no de muro.
 │   · perfil incompl. → /elegir-tipo    │
 │   · rol incorrecto  → su panel        │
 │                                        │
 │  onboardingPermisosGuard              │   ◄── NO bloquea: solo avisa
 │  noAuthGuard (login/registro)         │
 └───────────────┬───────────────────────┘
                 │ el componente pide datos
                 ▼
 ┌───────────────────────────────────────┐
 │  CAPA 2 · SUPABASE AUTH               │   ◄── ¿protege? SÍ, a medias
 │  ───────────────────────────────────  │       Prueba la IDENTIDAD,
 │  getSession()  (local, no red)        │       no el PERMISO.
 │  Authorization: Bearer <JWT>          │
 │                                        │       ⚠ getUser() NO es local:
 │  firmados por Supabase, con expiración│         5 consultas al servidor.
 └───────────────┬───────────────────────┘
                 │ PostgREST valida la firma
                 ▼
 ╔═══════════════════════════════════════╗
 ║  CAPA 3 · RLS EN POSTGRESQL           ║   ◄── ¿protege? SÍ. LA CAPA
 ║  ─────────────────────────────────── ║       QUE MANDA.
 ║                                       ║       Corre en el servidor; no
 ║  Por fila y por operación:            ║       depende de nada del
 ║   SELECT → ¿es de este usuario?       ║       teléfono.
 ║   INSERT → ¿puede crearla?            ║
 ║   UPDATE → ¿es suya?                  ║
 ║   DELETE → ¿es suya?                  ║
 ║                                       ║       Sin sesión → devuelve []
 ║  ✅ 15/15 tablas bloqueadas sin sesión ║       (vacío, sin error)
 ║  ✅ Escritura bloqueada sin sesión    ║       ◄── ESTO ES LO QUE IMPIDE
 ╚═══════════════╤═══════════════════════╝       VER DATOS DE TERCEROS
                │
     ┌──────────┴──────────┐
     ▼                     ▼
 ┌──────────┐        ┌──────────┐
 │  ROL     │        │  ROL     │
 │ Familiar │        │ Usuario  │
 │ (cuida)  │        │ (mayor)  │
 └────┬─────┘        └────┬─────┘
      │  sólo ve           │  sólo ve
      │  sus vinculados   │  lo suyo
      ▼                   ▼
  ubicacion            recordatorios
  historial            mi-ubicacion
  sos_alerta            zonas seguras


 ╔═══════════════════════════════════════════════════════════════╗
 ║  FUERA DE ESTE FLUJO · EDGE FUNCTIONS  ◄── EL PUNTO DÉBIL   ║
 ║  ────────────────────────────────────────────────────────── ║
 ║                                                               ║
 ║  Las funciones usan la SERVICE ROLE, que IGNORA la RLS.      ║
 ║  Si una acepta una petición sin comprobar el remitente,       ║
 ║  puede saltarse la capa 3 por completo.                       ║
 ║                                                               ║
 ║   enviar-push ──────► SIN AUTENTICACIÓN      🔴 alto          ║
 ║        │               + borra push_tokens                    ║
 ║        │                 con service role                     ║
 ║        ▼                                                      ║
 ║   evaluar-zona ────► atob() del JWT         🔴 alto          ║
 ║        │               sin verificar firma                     ║
 ║        │               + acepta otro id_usuario              ║
 ║        ▼                                                      ║
 ║   sincronizar-token ► atob() del JWT         🟠 medio         ║
 ║        │               sin verificar firma                     ║
 ║        ▼                                                      ║
 ║   reenviar-sos ────► secreto SOS_CRON_SECRET 🟢 correcto      ║
 ║   evaluar-emerg. ──► secreto SOS_CRON_SECRET 🟢 correcto      ║
 ║        │                                                      ║
 ║        ▼                                                      ║
 ║      pg_cron (nadie externo las llama)                        ║
 ╚═══════════════════════════════════════════════════════════════╝
```

---

## El criterio en una frase

> **La RLS es la muralla.** El guard es la puerta cortina.

Si alguienLogged-out intenta algo:

| Intento | Dónde se frena | Resultado |
|---|---|---|
| Abre `/ubicacion` en la app | Capa 1 (guard) | Redirigido a login |
| **Edita la app y quita el guard** | Capa 3 (RLS) | **0 filas** |
| Llama a la API con la anon key | Capa 3 (RLS) | **0 filas** |
| Intenta escribir con la anon key | Capa 3 (RLS) | `42501` RLS violation |
| **Fabrica un JWT y llama a `evaluar-zona`** | **Ninguna** | 🔴 **Pasa** |
| **Llama a `enviar-push` con la anon key** | **Ninguna** | 🔴 **Pasa** |

Las dos últimas filas son las que hay que arreglar.

---

## Dónde no llega ninguna capa

```
   ┌─────────────────────────────────────────┐
   │  4 funciones que el cliente llama       │   ◄── NO ESTÁN EN EL REPO
   │  ─────────────────────────────────────  │       No se pueden revisar.
   │                                         │
   │  enviar-codigo-correo                   │       Controlan el cambio y la
   │  verificar-codigo-correo                │       recuperación de contraseña.
   │  enviar-codigo-recuperacion             │
   │  verificar-codigo-recuperacion          │       Hay que descargarlas del
   │                                         │       servidor para auditarlas.
   └─────────────────────────────────────────┘
```

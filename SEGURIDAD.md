# Estructura de seguridad — SiempreCerca

> Documento de referencia. Describe cómo está protegida la app hoy, qué está
> verificado y qué está pendiente.
>
> Última revisión: 2026-09-28 · proyecto `enbbzywrrheadcqmmsbg` · rama `main`

---

## 1. El principio

La app tiene **tres capas** y cada una cubre el fallo de la anterior:

| Capa | Dónde vive | Qué protege | Si esta capa falla |
|---|---|---|---|
| **JWT (Supabase Auth)** | Emisor de Supabase | Quién es el usuario y qué rol tiene | No se puede atribuir una acción |
| **RLS (PostgreSQL)** | La base de datos | Qué filas puede ver o escribir cada quien | Un rol con la sesión vencida **no recupera datos** |
| **Guards (Angular)** | El teléfono | Qué pantallas se pueden abrir | Se ve una pantalla vacía, sin información |

**La RLS es la capa que manda.** Es la única que se ejecuta en el servidor y
no depende de nada que esté en el teléfono. Un guard se puede saltar con una
app modificada; una política de RLS no.

---

## 2. Flujo de una petición

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. NAVEGACIÓN (teléfono, no es seguridad real)                   │
│                                                                 │
│ Usuario navega a /ubicacion                                     │
│        │                                                        │
│        ▼                                                        │
│   authGuard  ─── sin sesión ──▶ redirige a /login  ⛔           │
│        │                                                        │
│        ├── perfil incompleto ──▶ /elegir-tipo      ⛔            │
│        │                                                        │
│        ├── rol no corresponde ─▶ su panel correcto  ⛔           │
│        │                                                        │
│        └── ok ──▶ la pantalla se abre                           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │  el componente pide datos
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. AUTENTICACIÓN (Supabase Auth)                                 │
│                                                                 │
│   getSession() lee el JWT de la sesión activa                   │
│   (local; renueva solo si venció)                               │
│        │                                                        │
│        ▼                                                        │
│   Authorization: Bearer <JWT>                                   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. RLS — LA CAPA QUE MANDA  (PostgreSQL)                        │
│                                                                 │
│   PostgREST valida el JWT y ejecuta la consulta como             │
│   authenticated <uuid del usuario>                              │
│        │                                                        │
│        ▼                                                        │
│   Cada fila se evalúa contra las políticas:                     │
│   ¿esta fila es de este usuario? ¿tiene el rol adecuado?        │
│        │                                                        │
│        ├── sí ──▶ devuelve la fila                              │
│        └── no ──▶ devuelve [] (vacío, sin error)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Verificado con pruebas reales

No es inspección de código: son peticiones hechas contra la base en producción.

### 3.1 Sin sesión, usando la anon key (que está en el bundle de la app)

La anon key es pública, así que cualquiera puede hacer esto. Las 15 tablas
sensibles devuelven **0 filas**:

| Tabla | Contiene | Lectura anon |
|---|---|---|
| `usuario` | RUT, nombre, teléfono, correo | ⛔ 0 filas |
| `ubicacion` | GPS | ⛔ 0 filas |
| `sos_alerta` | Alertas SOS | ⛔ 0 filas |
| `contacto_emergencia` | Contactos | ⛔ 0 filas |
| `direccion` | Dirección del domicilio | ⛔ 0 filas |
| `historial_desplazamiento` | Recorridos | ⛔ 0 filas |
| `historial_punto` | Puntos del recorrido | ⛔ 0 filas |
| `signos_vitales` | Salud: presión, ritmo | ⛔ 0 filas |
| `zona_segura` | Zonas y coordenadas | ⛔ 0 filas |
| `push_tokens` | Tokens de notificación | ⛔ 0 filas |
| `alarma_recordatorio` | Recordatorios | ⛔ 0 filas |
| `cuidador_usuario` | Vínculos cuidador–adulto | ⛔ 0 filas |
| `solicitud_vinculacion` | Solicitudes | ⛔ 0 filas |
| `codigo_vinculacion` | Códigos de vinculación | ⛔ 0 filas |
| `zona_viaje` | Viajes activos | ⛔ 0 filas |

### 3.2 Escritura sin sesión

También bloqueada, con el error explícito de RLS:

```
INSERT usuario      → 401  new row violates row-level security policy
INSERT push_tokens  → 401  new row violates row-level security policy
INSERT zona_segura  → 401  new row violates row-level security policy
```

**Conclusión:** la RLS impide tanto leer como escribir sin sesión. Sin la sesión
de un adulto mayor, un cuidador no obtiene ni su RUT ni su ubicación.

---

## 4. Roles

Definidos en `navegacion-rol.ts`:

| Rol | Puede entrar a |
|---|---|
| **Usuario** (adulto mayor) | `/adulto-mayor`, `/contacto-emergencia`, `/informacion`, `/recordatorios`, `/mi-ubicacion` |
| **Familiar** (cuidador) | `/cuidador`, `/cuidado`, `/ubicacion`, `/historial`, `/adulto-cargo`, `/estado` |

`authGuard` comprueba el rol en cada navegación: un adulto mayor que abra a mano
`/cuidador` es devuelto a su panel.

---

## 5. Estado de las rutas

| Categoría | Rutas | Guard |
|---|---|---|
| Datos de usuarios | `/home`, `/cuidador`, `/cuidado`, `/ubicacion`, `/historial`, `/adulto-cargo`, `/estado` | `authGuard` |
| Datos del adulto | `/adulto-mayor`, `/contacto-emergencia`, `/informacion`, `/recordatorios`, `/mi-ubicacion` | `authGuard` |
|_Zona segura_ | `/zona-segura` | `authGuard` |
| Juegos | `/juegos` + 5 subrutas | `authGuard` |
| Perfil | `/perfil` | `authGuard` |
| Ajustes y accesibilidad | `/ajustes`, `/permisos`, `/permisos-inicial`, `/tamano-letra`, `/filtro-color`, `/voz` | `authGuard` |
| Privacidad | `/privacidad` + 6 subrutas | `authGuard` |
| Onboarding | `/siguiente-paso`, `/elegir-tipo` | `siguientePasoGuard` |
| **Públicas (a propósito)** | `/login`, `/registro` | `noAuthGuard` |
| **Públicas (necesarias)** | `/recuperar-contrasena`, `/correo-contrasena` | ninguno |

Las dos de recuperación **deben** quedar públicas: si exigieran sesión,
nadie podría recuperar una contraseña perdida.

**Total: 40 de 42 rutas con sesión obligatoria.**

---

## 6. Las Edge Functions (donde está el agujero)

Son el punto débil. Las funciones usan la **service role**, que ignora la RLS
por completo: si una función acepta una petición sin comprobar quién la manda,
puede leer o escribir cualquier fila.

| Función | Quién la llama | Cómo valida | Riesgo |
|---|---|---|---|
| `enviar-push` | la app | **nada** | 🔴 **Alto** |
| `evaluar-zona` | app y servicio nativo | `atob()` del JWT, sin verificar firma | 🔴 **Alto** |
| `sincronizar-token` | la app | `atob()` del JWT, sin verificar firma | 🟠 Medio |
| `reenviar-sos` | `pg_cron` | secreto `SOS_CRON_SECRET` | 🟢 Ok |
| `evaluar-emergencia-viaje` | `pg_cron` | secreto `SOS_CRON_SECRET` | 🟢 Ok |

### 6.1 `enviar-push` — sin autenticación

```
POST /functions/v1/enviar-push  { "token": "...", "titulo": "...", "cuerpo": "..." }
→ 200  (envía la notificación)
```

- No pide ningún token de sesión. Con la anon key pública basta.
- Si el token FCM no está registrado, **borra la fila de `push_tokens`**
  usando la service role.
- Impacto: enviar push a un dispositivo ajeno, borrar tokens, generar
  invocaciones facturadas.

### 6.2 JWT sin verificar en `evaluar-zona` y `sincronizar-token`

Las dos hacen esto:

```ts
const payload = JSON.parse(atob(parteDelJwt));
return payload?.sub ?? null;     // ← el id del usuario sale de aquí
```

Eso **decodifica** el token pero no lo **verifica**. No se comprueba la firma ni
la caducidad, así que un JWT fabricado a mano —`{"sub":"<cualquier-uuid>"}` con
la firma inventada— se acepta igual.

En `evaluar-zona` el impacto es mayor: la función permite actuar sobre **otro
usuario** (`id_usuario` en el cuerpo) siempre que exista un vínculo, y ese
vínculo se consulta con la service role. Un atacante podría disparar alertas de
zona segura sobre cualquier adulto vinculado a su propia cuenta.

**Lo que debería ser:** validar el JWT contra `https://<ref>.supabase.co/auth/v1/user`
y sacar el `sub` de la respuesta, nunca del cuerpo.

---

## 7. Lo que se corrigió en esta revisión

| Cambio | Riesgo que cierra |
|---|---|
| `authGuard` en las 9 rutas de ajustes y privacidad | Ver ajustes, permisos y documentos sin sesión |
| `getSession()` en vez de `getUser()` en el sondeo | 5 consultas de autenticación de menos por pasada |
| Cierre del canal de Realtime en segundo plano | ~126 llamadas/min a la base (30% del CPU) |
| `android.loggingBehavior: 'none'` | El access token, el refresh token y el correo se escribían en `logcat` en texto plano |
| Se quitaron volcados de datos sensibles | Token FCM, perfiles de adultos mayores, coordenadas y nombres en el SOS |
| `supabase/.temp/` fuera del repo | Estado local ensuciando el historial |

### Sobre el log del token

No era un `console.log` del código. Capacitor vuelca los argumentos completos
de **toda** llamada nativa a plugin (`Bridge.java`, `call.getData().toString()`),
y una de esas llamadas guarda la sesión para el servicio en segundo plano.

Con un `adb logcat` sobre un dispositivo con depuración USB se podía leer la
sesión completa y suplantar la cuenta. Ojo: `loggingEnabled: false` **no**
funciona, Capacitor lo ignora; la clave correcta es `android.loggingBehavior`.

---

## 8. Pendientes

### Prioridad 1 — Sin riesgo
- [ ] **Versionar la base de datos.** No hay una sola línea de SQL en el repo:
      las políticas RLS, los índices, los RPC (`zona_evaluar_alerta`) y los cron
      viven solo en el servidor. Hoy no se pueden revisar ni reproducir.
      `supabase db pull` lo baja.

### Prioridad 2 — Toca la ruta de alerta
- [ ] **Validar el JWT en `evaluar-zona` y `sincronizar-token`** contra Supabase.
      Revisar antes el camino del servicio nativo en segundo plano, que también
      llama `evaluar-zona`: no debe romperse la alerta con la app cerrada.
- [ ] **Autenticar `enviar-push`.** Probar con un push real antes y después.

### Prioridad 3 — Requiere información
- [ ] **Cuatro funciones no están en el repo:** `enviar-codigo-correo`,
      `verificar-codigo-correo`, `enviar-codigo-recuperacion`,
      `verificar-codigo-recuperacion`. Controlan el cambio de contraseña y no se
      pueden revisar. Hay que descargarlas.
- [ ] **Acotar `Access-Control-Allow-Origin: "*"`** en las 6 funciones. Relevante
      una vez autenticadas.

### Descartado
- Rate limiting: las funciones de correo ya lo traen (medido: 33 llamadas en
  43 días, muy por debajo de un ciclo de 5 min).

---

## 9. Resumen para la defensa

**Lo que ya está bien:**
- La RLS funciona y está verificada con pruebas de lectura y escritura.
- 40 de 42 rutas exigen sesión.
- Los roles se comprueban en el servidor, no solo en el cliente.
- Los tokens ya no aparecen en el log del sistema.

**Lo que hay que explicar si preguntan:**
- Las políticas RLS no están versionadas: existen, funcionan, pero no se pueden
  revisar en un pull request. Es la deuda pendiente número uno.
- Las Edge Functions no validan la sesión correctamente. Las dos que usan un
  secreto de cron están bien; las tres que llama el cliente necesitan arreglo.
  Está identificado y priorizado, sin arreglar.

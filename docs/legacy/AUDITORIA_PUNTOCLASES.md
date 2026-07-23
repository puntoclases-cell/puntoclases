> **DESACTUALIZADA (11/06)** — fuente: CLAUDE.md. Varios hallazgos ya fueron
> resueltos en las fases F1–F6 posteriores. Se conserva como registro histórico,
> no como estado actual del código.

# AUDITORÍA DE CÓDIGO — PUNTOCLASES
**Fecha:** 2026-06-11  
**Auditor:** Análisis estático exhaustivo del código fuente  
**Archivos auditados:** `src/db.js` (284 líneas) · `src/PuntoClasesApp.jsx` (5939 líneas)  
**Versión:** rama `main`, commit `0b946a1`

---

## HALLAZGOS

---

### ÁREA: SEGURIDAD

---

```
AUD-01 | Severidad: CRITICA | Área: seguridad
Archivo y línea: src/PuntoClasesApp.jsx:1015
Qué pasa: VITE_MP_ACCESS_TOKEN — el Access Token de Mercado Pago (que tiene permisos
de cobro y gestión de pagos) se expone directamente en el bundle del navegador.
Cualquier usuario puede extraerlo con DevTools → Sources o inspeccionando el JS
minificado. Con ese token se pueden crear preferencias de pago, hacer reembolsos
o consultar movimientos de la cuenta MP.

Código exacto:
  "Authorization": `Bearer ${import.meta.env.VITE_MP_ACCESS_TOKEN}`,

Cuándo se manifiesta: Siempre. Toda variable VITE_* se incrusta en el bundle en
tiempo de build y es visible para cualquier visitante.

Fix sugerido: Mover la creación de la preferencia MP a un endpoint serverless
(Vercel Edge Function, Supabase Edge Function o similar). El frontend solo recibe
la preferenceId/init_point; nunca toca el Access Token.
```

---

```
AUD-02 | Severidad: CRITICA | Área: seguridad
Archivo y línea: src/PuntoClasesApp.jsx:5933-5935
Qué pasa: La decisión de qué panel mostrar (alumno / profe / admin) se basa
exclusivamente en el campo `rol` de la tabla `profiles`, que se lee en el cliente.
Si un atacante logra modificar su propio perfil en Supabase (posible si las
políticas RLS de la tabla `profiles` permiten UPDATE para el propio usuario),
puede cambiarse el rol a "admin" y acceder al panel de administración.

Código exacto:
  if (user.rol==="alumno") return <AppAlumno ...
  if (user.rol==="profe")  return <AppProfeMain ...
  if (user.rol==="admin")  return <AppAdminMain ...

Cuándo se manifiesta: Si la política RLS permite al usuario actualizar su propia
fila en `profiles` (columna `rol`). Incluso sin eso, el panel admin del frontend
no tiene ninguna verificación secundaria: llega solo con el rol del perfil.

Fix sugerido: Nunca usar datos de tablas de usuario (modificables) para el routing
de roles. Usar Supabase Auth JWT custom claims, o verificar el rol en cada query
crítica del admin con políticas RLS estrictas que impidan que un alumno lea
`getAlumnos()`, `getTodasLasReservas()` o `getProfesAdmin()`.
```

---

```
AUD-03 | Severidad: CRITICA | Área: seguridad
Archivo y línea: src/PuntoClasesApp.jsx:5715-5721
Qué pasa: El array USUARIOS con contraseñas en texto plano está hardcodeado en el
bundle de producción. Incluye credenciales del admin ("admin123"), del profe
("profe123") y del profe nuevo ("nuevo123"). Este código @seed nunca fue eliminado.

Código exacto:
  const USUARIOS = [ // @seed — usuarios/login
    { mail:"lucia@gmail.com",       pass:"1234",      rol:"alumno", ... },
    { mail:"admin@puntoclases.com", pass:"admin123",  rol:"admin",  ... },
    ...
  ];

Cuándo se manifiesta: Siempre. El array está en el módulo raíz, se incluye en el
bundle. Las contraseñas son visibles en el JS minificado del sitio de producción.

Fix sugerido: Eliminar el bloque USUARIOS completo. No se usa en el flujo real
(el login usa `supabase.auth.signInWithPassword`), pero contamina el bundle con
credenciales reales o de staging que pueden estar en producción.
```

---

```
AUD-04 | Severidad: ALTA | Área: seguridad
Archivo y línea: src/PuntoClasesApp.jsx:5899-5916
Qué pasa: El flujo de registro de alumno nuevo (OnboardingRegistroAlumno) recorre
todos los pasos del formulario pero al presionar "Crear cuenta ✓" en el paso 2
(línea 5234) solo avanza a `setPaso(3)` sin llamar a `registrarAlumno()` de db.js.
Se llama a `onTerminar(form)` que simplemente hace `setUser({ rol:"alumno", ... })`
con los datos del formulario local, sin crear la cuenta en Supabase Auth.

Código exacto (línea 5903):
  setUser({ mail:datos.mail, rol:"alumno", nombre:datos.nombre, nivel:datos.nivel, esNuevo:true });

El usuario queda autenticado en el estado de React sin sesión real en Supabase.
Al refrescar la página pierde el acceso pero no tiene cuenta real.

Cuándo se manifiesta: Cada vez que un alumno nuevo completa el registro desde la UI.

Fix sugerido: Llamar a `registrarAlumno({ mail, pass, nombre, tel, nivel })` de db.js
dentro de `OnboardingRegistroAlumno` (o en `onTerminar`) y luego hacer login real.
```

---

```
AUD-05 | Severidad: ALTA | Área: seguridad
Archivo y línea: src/PuntoClasesApp.jsx:5910-5916
Qué pasa: El flujo de registro de profe nuevo (OnboardingRegistroProfe) tampoco
llama a ninguna función de db.js para crear la cuenta. Al terminar, setea un
usuario hardcodeado en memoria:
  setUser({ mail:"nuevo@profe.com", pass:"nuevo123", rol:"profe", ... });
El profe "nuevo" queda sin cuenta real en Supabase. Su contraseña ("nuevo123") queda
visible en el bundle (ver AUD-03).

Cuándo se manifiesta: Cada vez que un profe nuevo completa el onboarding.

Fix sugerido: Implementar el alta real: llamar a la API de invitación de Supabase
(supabase.auth.admin.inviteUserByEmail) desde un Edge Function, o crear la cuenta
y luego `signInWithPassword`. Nunca hardcodear el mail/pass del usuario nuevo.
```

---

```
AUD-06 | Severidad: ALTA | Área: seguridad
Archivo y línea: src/db.js:209-213 / src/db.js:215-222
Qué pasa: Las funciones `getAlumnos()` y `getTodasLasReservas()` no tienen ningún
filtro de usuario. Cualquier rol autenticado que logre llamarlas (por ejemplo, un
alumno que manipule la consola del navegador) obtiene todos los alumnos y todas
las reservas. La protección depende únicamente de que el frontend nunca las
invoque para roles no-admin, pero esto es bypasseable.

Cuándo se manifiesta: Si las políticas RLS de Supabase en las tablas `alumnos` y
`reservas` no restringen SELECT a solo los propios registros del usuario.

Fix sugerido: Asegurarse de que las tablas `alumnos` y `reservas` tengan políticas
RLS que solo permitan a un alumno leer su propia fila. El admin debería usar un
role especial (service role en Edge Function) o una política RLS basada en claims.
Esto no puede verificarse solo en el frontend.
```

---

```
AUD-07 | Severidad: ALTA | Área: seguridad
Archivo y línea: src/db.js:163-170 (marcarReserva) / db.js:172-177 (cargarDevolucion)
Qué pasa: Las funciones `marcarReserva` y `cargarDevolucion` actualizan reservas por
`id` sin verificar que el `profe_id` de la reserva corresponda al usuario autenticado.
Un profe podría llamar desde consola a `marcarReserva(idReservaAjena, "realizada")`
y marcar como realizada una clase de otro profe para que le liquiden.

Cuándo se manifiesta: Si las políticas RLS de la tabla `reservas` no verifican que
`profe_id = auth.uid()` en operaciones UPDATE.

Fix sugerido: Agregar en las políticas RLS de Supabase:
  FOR UPDATE USING (profe_id = auth.uid())
O mover estas operaciones a funciones RPC con verificación interna.
```

---

```
AUD-08 | Severidad: MEDIA | Área: seguridad
Archivo y línea: src/PuntoClasesApp.jsx:1364 (Chat alumno) / línea 3308-3311 (ChatProfe)
Qué pasa: El filtro anti-contacto del chat es bypasseable trivialmente. La regex
del alumno detecta números de 7+ dígitos, @, "whatsapp", "wa.me", etc., pero
no detecta variantes como "w-h-a-t-s-a-p-p", "wapp", obfuscación con espacios
entre dígitos (123 4567890), o dominios alternativos. La del profe es aún más
débil (línea 3308-3311).

Cuándo se manifiesta: Cuando un usuario escribe datos de contacto con variantes
de escritura no cubiertas por la regex.

Fix sugerido: El filtro del cliente es solo una capa UX, no de seguridad real.
La protección real debe estar en el backend (moderación de contenido, política RLS
que registre violaciones, o un webhook de Supabase que analice mensajes). Agregar
más variantes a la regex como medida parcial.
```

---

### ÁREA: SALDO Y PAGOS

---

```
AUD-09 | Severidad: CRITICA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:1779-1810
Qué pasa: Race condition severa en el procesamiento del pago de Mercado Pago.
El flujo es:
  1. Se lee `datosAlumno.saldo` del estado de React (cargado al inicio)
  2. Se calcula `nuevoSaldo = datosAlumno.saldo + horas`
  3. Se llama a `actualizarAlumno(user.id, { saldo: nuevoSaldo })`

Si el alumno tiene dos pestañas abiertas, o si el backend tarda en actualizar y
el usuario recarga, el saldo leído puede ser el viejo. Resultado: se sobreescribe
el saldo con un valor incorrecto (se pierden horas ya acreditadas previamente).

Código exacto (línea 1794-1797):
  const nuevoSaldo = +(datosAlumno.saldo + horas).toFixed(2);
  return Promise.all([
    crearCompra(user.id, horas, precio, null, "aprobado", paymentId),
    actualizarAlumno(user.id, { saldo: nuevoSaldo }),

Cuándo se manifiesta: Con múltiples pestañas abiertas, o si el usuario regresa de
MP y la página ya cargó con saldo viejo antes de que el backend lo actualizara.

Fix sugerido: Usar un UPDATE atómico con incremento relativo en Supabase:
  UPDATE alumnos SET saldo = saldo + $horas WHERE id = $id
O mejor: una función RPC de Supabase que haga todo en una transacción:
  acreditar_compra(p_alumno_id, p_horas, p_payment_id).
```

---

```
AUD-10 | Severidad: CRITICA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:1790-1804
Qué pasa: La deduplicación de pagos MP tiene una ventana de race condition.
El flujo es:
  1. `buscarCompraPorPaymentId(paymentId)` → query
  2. Si no existe → `crearCompra(...)` + `actualizarAlumno(...)`

Si el usuario abre dos pestañas simultáneamente o hace doble clic en Back desde MP,
dos instancias ejecutan el paso 1 al mismo tiempo, ambas obtienen "no existe", y
ambas crean la compra y suman el saldo. Resultado: saldo duplicado.

Cuándo se manifiesta: Con dos pestañas, conexión lenta, o si el navegador restaura
la URL de retorno dos veces.

Fix sugerido: La deduplicación debe ser atómica en el backend. Agregar una
constraint UNIQUE en `compras.payment_id` en Supabase y capturar el error de
duplicado. Idealmente usar un webhook de MP en el servidor (no el redirect del
cliente) como fuente de verdad para acreditar pagos.
```

---

```
AUD-11 | Severidad: ALTA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:666-686
Qué pasa: Al confirmar una reserva se hace primero `verificarBloqueOcupado` (check)
y luego `crearReserva` (write) en un loop separado. Esta es una clásica race
condition TOCTOU (Time-Of-Check Time-Of-Use). Entre la verificación y la creación,
otro alumno puede reservar el mismo bloque.

Código exacto:
  for (const h of horas) {
    const ocupado = await verificarBloqueOcupado(profeId, fecha, h);  // CHECK
    ...
  }
  for (const h of horas) {
    await crearReserva({ ... hora: h ... });  // USE (en otro loop, después)
  }

Cuándo se manifiesta: Cuando dos alumnos intentan reservar el mismo bloque horario
simultáneamente. El primero que hace el check ve el bloque libre, pero antes de
insertar el segundo también lo ve libre.

Fix sugerido: La función RPC `crear_reserva` en Supabase debe incluir la verificación
de disponibilidad dentro de la transacción SQL con un SELECT FOR UPDATE o un
constraint de unicidad en (profe_id, fecha, hora, estado). El check del cliente
sirve solo para UX rápido, nunca como guardián de integridad.
```

---

```
AUD-12 | Severidad: ALTA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:1852-1861
Qué pasa: Al cancelar una reserva desde el panel del alumno, la devolución de horas
se hace solo en el estado de React y en `actualizarAlumno`. No hay verificación de
que la reserva realmente esté en un estado cancelable ("confirmada" o "pendiente"),
ni de que el saldo no quede por encima del máximo posible. Tampoco se verifica
que el saldo actual en DB coincida con el estado de React antes de sumar.

Código exacto (línea 1856-1860):
  setSaldo(s => {
    const nuevo = +(s + horasRecup).toFixed(2);
    actualizarAlumno(user.id, { saldo: nuevo }).catch(console.error);
    return nuevo;
  });

El mismo problema de race condition que AUD-09: se lee el saldo del estado de React,
no del servidor.

Cuándo se manifiesta: Si el saldo en React y en DB están desincronizados (posible
si la página no se refrescó entre una operación y otra).

Fix sugerido: Usar UPDATE atómico en DB: `SET saldo = saldo + horasRecup`.
```

---

```
AUD-13 | Severidad: ALTA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:3882-3901 (accionAlumno)
Qué pasa: La acción "addHoras" del admin suma 1 hora al saldo leyendo el valor del
estado local `a.saldo`, no del servidor:
  actualizarAlumno(id, {saldo: (a.saldo || 0) + 1})
Si el saldo real en DB es diferente al que tiene el estado React del admin (posible
si el alumno compró mientras el admin tenía la sesión abierta), se sobreescribe con
el valor incorrecto.

Cuándo se manifiesta: Cuando el admin agrega horas a un alumno que acaba de comprar,
o cuando hay lag entre la carga del estado y la acción.

Fix sugerido: Usar UPDATE atómico: `SET saldo = saldo + 1`.
```

---

```
AUD-14 | Severidad: ALTA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:5665-5668 (ModalReprogramar alumno)
Qué pasa: Al reprogramar desde el panel del alumno, se llama a `reprogramarReserva`
pero si hay un error en la función, se ejecuta `onConfirmar` y `setConfirmado(true)`
igualmente porque el `.catch` está dentro del `await` pero no hace return:

  await reprogramarReserva(...).catch(err=>console.error("Error al reprogramar:",err));
  onConfirmar(nuevaFecha, nuevaHora);  // se ejecuta incluso si la DB falló
  setConfirmado(true);

Resultado: la UI muestra "Clase reprogramada" pero la DB no se actualizó.

Cuándo se manifiesta: Cuando hay un error de red o de RLS al reprogramar.

Fix sugerido:
  try {
    await reprogramarReserva(reserva.id, nuevaFecha, nuevaHora);
    onConfirmar(nuevaFecha, nuevaHora);
    setConfirmado(true);
  } catch(err) { mostrarError(err); }
```

---

```
AUD-15 | Severidad: ALTA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:5629-5636 (ModalReprogramar / ModalReprogramarProfe)
Qué pasa: Al cancelar desde el panel del alumno (línea 5692-5696), el cálculo de
horasRecup asume que la reserva vale `reserva.horas || 1` horas. Pero si la reserva
es grupal, el saldo descontado originalmente fue `factorGrupal × horas` (0.8hs por
hora), no `horas` horas completas. La cancelación devuelve más saldo del que se descontó
si `saldoPerdido` no está calculado sobre la base correcta.

Código exacto (línea 5693-5695):
  const horasRecup = conCosto
    ? +(((reserva.horas||1) - saldoPerdido)).toFixed(2)
    : (reserva.horas||1);

Para una reserva grupal de 1 hora: se devuelven `1 - 0.4 = 0.6hs`, pero el alumno
solo pagó 0.8hs de saldo (factorGrupal). Se le devuelven 0.6hs en lugar de 0.4hs.
Si no hay costo: se devuelve 1hs en lugar de 0.8hs.

Cuándo se manifiesta: En cualquier cancelación de reserva grupal.

Fix sugerido: La base debe ser `costoOriginal = tipo === "grupal" ? horas * factorGrupal : horas`.
  const costoOriginal = reserva.tipo === "grupal"
    ? (reserva.horas||1) * CFG.factorGrupal
    : (reserva.horas||1);
  const horasRecup = conCosto ? +(costoOriginal - saldoPerdido).toFixed(2) : costoOriginal;
```

---

```
AUD-16 | Severidad: ALTA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:1007-1009
Qué pasa: Los datos de la compra pendiente (horas y precio) se guardan en
localStorage antes de redirigir a Mercado Pago:
  localStorage.setItem("pc_compra_pendiente", JSON.stringify({ horas, precio }))
Si el usuario modifica ese valor en localStorage (DevTools → Application) antes de
volver, puede acreditar más horas de las que pagó. El servidor acepta el valor
de `horas` que viene del cliente sin verificar contra el `payment_id`.

Cuándo se manifiesta: Cuando un usuario malintencionado edita localStorage entre
la redirección a MP y el retorno al sitio.

Fix sugerido: No confiar en datos de localStorage para calcular las horas a acreditar.
Obtener el monto real del pago desde la API de MP (GET /v1/payments/{id}) en el
servidor, calcular las horas según el precio pagado y la tarifa vigente, y acreditar
ese valor. El localStorage solo debería guardar metadata de UX (qué pack seleccionó),
nunca el valor a acreditar.
```

---

```
AUD-17 | Severidad: MEDIA | Área: saldo
Archivo y línea: src/PuntoClasesApp.jsx:1806-1808
Qué pasa: Los pagos con estado "pending" o "failure" crean una fila en la tabla
`compras` con `estado_pago = "pendiente"` o `"fallido"`. Sin embargo, no hay lógica
que procese los pagos pendientes cuando MP los aprueba posteriormente (MP puede
aprobar un pago pendiente horas después, por ej. con transferencia bancaria). El
alumno no recibirá sus horas hasta que recargue la página manualmente, lo cual puede
no ocurrir.

Cuándo se manifiesta: Pagos con transferencia bancaria u otros métodos que MP
procesa asincrónicamente.

Fix sugerido: Configurar un webhook de MP en el servidor que escuche eventos
`payment.updated` y acredite las horas cuando el estado cambie a "approved".
```

---

### ÁREA: FECHAS Y ZONA HORARIA

---

```
AUD-18 | Severidad: ALTA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:196
Qué pasa: La función `diasVenc` calcula días hasta el vencimiento interpretando el
string ISO como UTC:
  const diasVenc = iso => Math.ceil((new Date(iso)-new Date())/(1000*60*60*24));

`new Date("2026-07-18")` se interpreta como 2026-07-18T00:00:00Z (UTC),
que en Argentina (UTC-3) equivale a 2026-07-17T21:00:00 local. En la noche del
17/07 argentino, `diasVenc("2026-07-18")` devuelve 0 o negativo aunque el
vencimiento real sea el 18/07. El alumno verá "¡Tus horas vencen en 0 días!" o
incluso "🚨 VENCIDO" cuando todavía tiene un día completo.

Cuándo se manifiesta: En el horario nocturno argentino (21:00-23:59) del día anterior
al vencimiento.

Fix sugerido: Parsear la fecha como local:
  const diasVenc = iso => {
    const [y,m,d] = iso.split("-").map(Number);
    const venc = new Date(y, m-1, d);  // local midnight
    const hoy  = new Date(); hoy.setHours(0,0,0,0);
    return Math.ceil((venc - hoy) / (1000*60*60*24));
  };
```

---

```
AUD-19 | Severidad: ALTA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:3734
Qué pasa: La función `diasHasta` del panel admin tiene el mismo problema UTC:
  const diasHasta = iso => iso ? Math.ceil((new Date(iso)-new Date())/(1000*60*60*24)) : 0;

Usada en las líneas 3755, 3929, 4146 para calcular alertas de vencimiento de horas
de alumnos. Misma consecuencia que AUD-18: los alumnos aparecerán con vencimiento
incorrecto en el panel admin durante el horario nocturno.

Cuándo se manifiesta: En el horario nocturno argentino (21:00-23:59) del día anterior
al vencimiento.

Fix sugerido: Mismo fix que AUD-18: parsear como fecha local.
```

---

```
AUD-20 | Severidad: ALTA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:1636-1638
Qué pasa: En el componente CountdownClase, la fecha de la clase se construye así:
  const fechaClase = new Date(clase.fecha + "T" + (clase.hora || "00:00") + ":00");

`clase.fecha` es un string "YYYY-MM-DD". Al concatenar con "T" + hora + ":00"
sin sufijo de timezone, la interpretación depende del navegador: la mayoría de los
navegadores modernos lo tratan como local, pero la spec de ECMAScript no lo garantiza
para formatos personalizados. Podría tratarse como UTC en algunos entornos
(Node.js, Safari iOS en ciertas versiones), desplazando el countdown 3 horas.

Cuándo se manifiesta: En Safari iOS y algunos contextos de Node.js.

Fix sugerido: Usar `new Date(y, m-1, d, hh, mm)` con partes numéricas separadas
para garantizar interpretación local sin ambigüedad.
```

---

```
AUD-21 | Severidad: MEDIA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:3483-3489 (AlertaDevolucionesPendientes)
Qué pasa: El cálculo de si pasaron 24hs desde una clase usa:
  const fechaClase = new Date(r.fecha);   // UTC midnight
  const hoy = new Date(HOY_ALERT);         // UTC midnight
  const diff = (hoy - fechaClase) / (1000*60*60*24);

Mismo problema UTC: `new Date("2026-05-28")` es UTC midnight = 21:00 del 27/05
en Argentina. Una clase del 28/05 parecerá de 3 horas antes de lo real.

Cuándo se manifiesta: Siempre (el cómputo de días es incorrecto sistemáticamente
en Argentina).

Fix sugerido: Usar parseo local como en AUD-18.
```

---

```
AUD-22 | Severidad: MEDIA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:5512-5515 (ModalReprogramar)
Qué pasa: El cálculo de si la clase es en menos de 24hs usa:
  const fechaClase = new Date(`${reserva.fecha}T${reserva.hora}`);
  const ahora = new Date();
  const horasRestantes = (fechaClase - ahora) / (1000*60*60);

Si el navegador interpreta `"2026-06-09T09:00"` (sin timezone) como UTC, la clase
parecerá 3 horas antes en Argentina. Una clase a las 09:00 local aparecerá como
las 06:00 UTC, y el cálculo "menos de 24hs" se activará incorrectamente.

Cuándo se manifiesta: En Safari iOS y contextos donde los strings datetime sin
timezone se tratan como UTC.

Fix sugerido: Agregar el offset explícito:
  new Date(`${reserva.fecha}T${reserva.hora}:00-03:00`)
O usar parseo con partes numéricas.
```

---

```
AUD-23 | Severidad: MEDIA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:2754
Qué pasa: En ModalRecurrente (disponibilidad profe), la fecha base para calcular
disponibilidad recurrente está hardcodeada:
  const hoy = new Date(2026,5,9); // HOY simulado

Esto hace que la disponibilidad recurrente siempre se calcule a partir del
09/06/2026, independientemente de la fecha real. En producción, en cualquier fecha
posterior, los bloques recurrentes se agregarán en fechas ya pasadas.

Cuándo se manifiesta: Siempre que la fecha actual sea posterior al 09/06/2026
(que ya es el caso hoy, 11/06/2026).

Fix sugerido: Reemplazar con `new Date()` para usar la fecha real del sistema.
```

---

```
AUD-24 | Severidad: MEDIA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:4865
Qué pasa: En ModalRecurrenteAlumno, la fecha base también está hardcodeada:
  const BASE = new Date("2026-06-09");
Mismo problema que AUD-23.

Cuándo se manifiesta: Siempre que la fecha actual sea posterior al 09/06/2026.

Fix sugerido: Reemplazar con `new Date()`.
```

---

```
AUD-25 | Severidad: BAJA | Área: fechas
Archivo y línea: src/PuntoClasesApp.jsx:231
Qué pasa: En la pantalla de Inicio del alumno, la fecha de vencimiento mostrada en
el badge del header usa el objeto @seed `ALUMNO.vencimiento` hardcodeado
("2026-07-18"), no el vencimiento real del alumno cargado desde Supabase:
  diasVenc(ALUMNO.vencimiento) — en 3 ocurrencias en líneas 1830, 1831, 1833, 1834

Cuándo se manifiesta: Siempre. El badge del header siempre muestra la urgencia
del vencimiento hardcodeado, no el del alumno real.

Fix sugerido: Usar `datosAlumno?.vencimiento || ALUMNO.vencimiento` para el badge.
```

---

### ÁREA: BUGS DE REACT

---

```
AUD-26 | Severidad: ALTA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:1347-1353 (Chat alumno) / 3292-3298 (ChatProfe)
Qué pasa: La suscripción Realtime de Supabase (canal de mensajes) se crea en un
useEffect que depende de `reservaSel`. El cleanup devuelve `canal.unsubscribe()`.
Sin embargo, si `reservaSel` cambia rápidamente (el usuario navega entre chats),
el cleanup del effect anterior se ejecuta pero el canal puede estar en estado de
conexión pendiente, y `unsubscribe()` puede no cancelar el handler. En Supabase
Realtime, si el canal no está en estado "joined" aún, `unsubscribe()` puede fallar
silenciosamente y el handler queda registrado.

Código exacto:
  useEffect(() => {
    if (!reservaSel) return;
    const canal = suscribirMensajes(reservaSel.id, msg => { ... });
    return () => { canal.unsubscribe(); };
  }, [reservaSel]);

Cuándo se manifiesta: Cuando el usuario abre y cierra chats rápidamente.
Resultado: memory leak y posibles mensajes duplicados (el handler viejo sigue
recibiendo y los inserta en el estado).

Fix sugerido: Verificar el estado del canal antes de suscribir, y usar el patrón
de referencia + flag de cancelación:
  let mounted = true;
  canal.subscribe(status => { if (status === "SUBSCRIBED" && !mounted) canal.unsubscribe(); });
  return () => { mounted = false; canal.unsubscribe(); };
```

---

```
AUD-27 | Severidad: ALTA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:2132
Qué pasa: La constante HOY se define a nivel de módulo (fuera de todo componente):
  const HOY = new Date().toISOString().slice(0,10);

Se evalúa UNA SOLA VEZ cuando se carga el módulo. Si el usuario deja la app abierta
y pasa la medianoche, HOY queda con la fecha anterior. Todas las comparaciones de
"próximas vs pasadas" en los paneles del profe usarán una fecha incorrecta.

Cuándo se manifiesta: Cuando un usuario deja la app abierta durante la medianoche.
También: la variable HOY en el módulo es distinta de la variable HOY_ALERT definida
dentro de AlertaDevolucionesPendientes (línea 3482), lo que es una inconsistencia.

Fix sugerido: Calcular HOY dentro de cada componente o como una función:
  const getHoy = () => new Date().toISOString().slice(0,10);
  // y usarla como getHoy() en cada render
```

---

```
AUD-28 | Severidad: ALTA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:1914
Qué pasa: En el componente ProfeReservas (versión mock del panel del profe), la
variable `hoy` está hardcodeada:
  const hoy = "2026-06-09";

Esta fecha ya pasó. Todas las reservas del profe serán clasificadas como "pasadas"
independientemente de cuándo se ejecute el código. El tab "Próximas" siempre
estará vacío o mostrará datos incorrectos.

Cuándo se manifiesta: Siempre (en producción hoy es 2026-06-11, ya pasó).

Fix sugerido: Usar `new Date().toISOString().slice(0,10)` o la constante HOY del
módulo (aunque HOY también tiene el problema de AUD-27).
```

---

```
AUD-29 | Severidad: ALTA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:1103-1113 (Perfil alumno)
Qué pasa: El componente Perfil tiene dos estados de datos de usuario: `datos` y
`borrador`. El estado `borrador` se inicializa con el valor de `datos` al montar:
  const [borrador, setBorrador] = useState(datos);
Pero `datos` en el momento del primer render es `{ nombre:"", mail:"", tel:"" }`
(valor inicial). El `useEffect` que llena `datos` desde `datosAlumno` se ejecuta
después del primer render. Por eso `borrador` queda inicializado con strings vacíos
y no se actualiza automáticamente cuando `datos` cambia (useState solo usa el valor
inicial una vez).

Cuándo se manifiesta: Siempre. Al abrir el modal de edición por primera vez, los
campos estarán vacíos aunque el perfil se haya cargado correctamente.

Fix sugerido: Inicializar borrador dentro del abrirEdicion():
  const abrirEdicion = () => { setBorrador(datos); setEditando(true); };
Esto ya está implementado (línea 1114), por lo que el flujo de edición funciona.
Sin embargo, `const [borrador, setBorrador] = useState(datos)` inicializa con
strings vacíos y es confuso. Eliminarlo y solo inicializar en `abrirEdicion`.
```

---

```
AUD-30 | Severidad: ALTA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:3574 (marcarAusente)
Qué pasa: Al marcar un alumno como ausente, el estado se actualiza con
`alumnoAusente:true, realizada:true`. Pero en la lógica de visualización (línea
2256-2279), se muestra el botón "Clase realizada" cuando `!r.realizada && !r.alumnoAusente`.
Si `realizada:true`, el alumno no aparece como "ausente" en la UI de Próximas sino
que desaparece de ambas condiciones (no es ausente ni no-realizada). Se necesita
un estado exclusivo para "ausente" que no use `realizada:true`.

Cuándo se manifiesta: Al marcar un alumno ausente, la clase desaparece del panel
de próximas sin mostrar el badge de "ausente".

Fix sugerido: No setear `realizada:true` al marcar ausente. Usar solo
`alumnoAusente:true`. Ajustar el condicional a:
  !r.realizada && !r.alumnoAusente → mostrar botones
  r.alumnoAusente → badge "ausente"
  r.realizada && !r.alumnoAusente → badge "realizada"
```

---

```
AUD-31 | Severidad: ALTA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:3597-3614 (handleDisponChange)
Qué pasa: La función handleDisponChange detecta cambios comparando el estado
anterior con el nuevo para llamar a `setBloque` o `borrarBloque`. Sin embargo,
la función recibe un updater (función o valor), ejecuta el updater para obtener
`next`, y luego DENTRO del setState hace las llamadas a la DB. Esto viola las
reglas de React: el updater del setState debe ser puro y sin side effects. Las
llamadas a `setBloque` y `borrarBloque` dentro del updater se ejecutarán en
StrictMode dos veces (en desarrollo), potencialmente creando bloques duplicados
o borrando bloques que no deberían borrarse.

Cuándo se manifiesta: En React StrictMode (desarrollo) o si React re-ejecuta el
updater por optimizaciones internas.

Fix sugerido: Separar la lógica: primero calcular `next` y la lista de cambios,
luego llamar al setState con el nuevo valor, y en un efecto separado sincronizar
los cambios a la DB.
```

---

```
AUD-32 | Severidad: MEDIA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:1337-1338 (Chat alumno)
Qué pasa: El componente Chat accede a la constante HOY del módulo (definida en
línea 2132) para filtrar reservas próximas vs historial. Pero HOY se define en el
scope del módulo del panel del profe. En el panel del alumno, el componente Chat
usa la misma constante. Si la pantalla "mensajes" se carga antes de que HOY del
módulo del profe se haya definido (imposible en este caso por ser mismo archivo,
pero igualmente confuso), habría un error.

El problema real: la constante HOY solo se evalúa al cargar el módulo y tiene el
problema de AUD-27 (se queda vieja si el usuario no recarga).

Fix sugerido: Usar `new Date().toISOString().slice(0,10)` localmente.
```

---

```
AUD-33 | Severidad: MEDIA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:1821
Qué pasa: El onboarding del alumno (Onboarding) se muestra si `!onboardingVisto`.
`onboardingVisto` es estado local de AppAlumno, inicializado en `false`. Se muestra
a TODOS los alumnos en CADA login (incluso los que ya lo vieron antes). No hay
persistencia en localStorage ni en la DB.

Cuándo se manifiesta: En cada sesión nueva del alumno.

Fix sugerido: Persistir en localStorage: `onboardingVisto = localStorage.getItem("pc_onboarding_visto")`.
```

---

```
AUD-34 | Severidad: MEDIA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:303-313
Qué pasa: En el componente Reservar, el useEffect que carga la disponibilidad
del profe no tiene manejo de cancelación cuando el componente se desmonta entre
la llamada y la respuesta. Si el alumno navega rápido (selecciona un profe y
vuelve atrás antes de que cargue la disponibilidad), el setState se llama sobre
un componente desmontado.

Cuándo se manifiesta: Con conexiones lentas o navegación rápida.

Fix sugerido: Agregar flag de cancelación o useRef para verificar si el componente
sigue montado antes de llamar a setDisponRaw.
```

---

```
AUD-35 | Severidad: MEDIA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:4185
Qué pasa: En la lista de profes del panel admin (Personas), la variable `porCobrar`
se calcula dentro del `.map()` de profes pero no filtra por profe:
  const porCobrar = sumPagoProfe(reservas.filter(r=>r.estado==="realizada"));

Suma el pago de TODAS las reservas realizadas para TODOS los profes, y lo muestra
en cada tarjeta de profe como si fuera el monto de ese profe específico.

Cuándo se manifiesta: Siempre. Con múltiples profes, cada uno mostrará el total
combinado como su monto "A cobrar".

Fix sugerido:
  const porCobrar = sumPagoProfe(reservas.filter(r=>r.estado==="realizada" && r.profe_id===p.id));
Nota: esto requiere que `reservas` en el panel admin incluya `profe_id`, lo cual
está disponible en los datos de Supabase (ver normReservaAdmin en línea 5523).
```

---

```
AUD-36 | Severidad: MEDIA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:807-812 (ModalResenia en Historial)
Qué pasa: El modal de reseña (`ModalResenia`) se invoca con un estado `modalResenia`
que puede ser seteado, pero en el componente Historial nunca se llama a
`setModalResenia(c)` con ninguna clase. El botón que abriría la reseña no existe
en el código del tab "historial" de Historial. El modal se renderiza pero es
inalcanzable.

Adicionalmente, el `onGuardar` del modal solo actualiza estado local de reseñas
(`setResenias`) sin persistir en la DB ni llamar a `crearResenia` de db.js.

Cuándo se manifiesta: La funcionalidad de reseñas desde el historial del alumno
está incompleta: el modal existe pero no hay forma de abrirlo desde el panel del
alumno.

Fix sugerido: Agregar un botón "Calificar clase" en las clases pasadas del historial
que llame a `setModalResenia(c)`. Conectar `onGuardar` con `crearResenia` de db.js.
```

---

```
AUD-37 | Severidad: MEDIA | Área: react
Archivo y línea: src/PuntoClasesApp.jsx:5881-5887 (PuntoClasesApp root)
Qué pasa: El useEffect de la app raíz suscribe a onAuthChange y guarda el
subscription en `{ data }`. El cleanup hace `data.subscription.unsubscribe()`.
Sin embargo, `getUsuarioActual()` en el callback de `onAuthChange` es una Promise
que no tiene manejo de error. Si `getUsuarioActual()` falla (ej. error de red),
el usuario quedaría en estado `null` (deslogueado) sin feedback.

Código exacto:
  const { data } = onAuthChange(async (u) => {
    setUser(u ? await getUsuarioActual() : null);
  });

Cuándo se manifiesta: Cuando hay un error de red al refrescar la sesión.

Fix sugerido: Envolver en try/catch.
```

---

### ÁREA: UX DETECTABLE EN CÓDIGO

---

```
AUD-38 | Severidad: ALTA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:1030-1034
Qué pasa: Cuando falla la creación de la preferencia de Mercado Pago, el error se
loguea en consola pero el usuario solo ve que el botón vuelve a decir "Pagar con
Mercado Pago →" sin ningún mensaje de error visible en la UI.

Código exacto:
  } catch (err) {
    console.error("Error al crear preferencia MP:", err);
    setPago("idle");
    localStorage.removeItem("pc_compra_pendiente");
  }

Cuándo se manifiesta: Cuando la API de MP devuelve error (credenciales inválidas,
timeout, etc.).

Fix sugerido: Agregar un estado de error y mostrarlo en la UI:
  setErrorPago("No se pudo procesar el pago. Intentá de nuevo.");
```

---

```
AUD-39 | Severidad: ALTA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:4504-4507
Qué pasa: El botón "Guardar cambios" en la configuración del admin (Finanzas → config)
solo actualiza el estado local de React:
  const guardar = () => { setGuardado(true); setTimeout(()=>setGuardado(false),2000); };

No llama a `updateConfig` de db.js ni persiste ningún cambio en Supabase. Al refrescar
la página, toda la configuración editada se pierde. El admin recibe feedback visual
"✓ Guardado" sin que nada se haya guardado realmente.

Cuándo se manifiesta: Siempre. La configuración del admin nunca se persiste.

Fix sugerido: Llamar a `updateConfig(cfg)` de db.js en el handler `guardar()`.
```

---

```
AUD-40 | Severidad: ALTA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:1115-1120 (Perfil alumno — guardarEdicion)
Qué pasa: El guardado del perfil usa `Promise.all` con un `.catch` que solo loguea
el error a consola. Si falla, el estado local (`datos`) se actualiza de todas
formas (`setDatos(borrador)`) y se muestra "✓ Perfil actualizado" aunque la DB
no se haya actualizado.

Código exacto:
  await Promise.all([...]).catch(err => console.error(...));
  setDatos(borrador);  // siempre se ejecuta, incluso si Promise.all falló
  setEditando(false);
  setGuardado(true);

Cuándo se manifiesta: Cuando hay un error de red o RLS al actualizar el perfil.

Fix sugerido: Usar try/catch en lugar de .catch:
  try {
    await Promise.all([...]);
    setDatos(borrador);
    setGuardado(true);
  } catch(err) {
    setError("No se pudo guardar el perfil.");
  }
```

---

```
AUD-41 | Severidad: ALTA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:3617-3623 (guardar devolución profe)
Qué pasa: Al guardar la devolución, si `cargarDevolucion` falla, se loguea en consola
pero el modal se cierra igual (`setModalR(null)`) y la devolución queda sin guardar
sin que el profe lo sepa.

Código exacto:
  } catch(err) { console.error("Error al guardar devolución:", err); }
  setModalR(null);  // se ejecuta siempre, incluso si falló

Cuándo se manifiesta: Error de red o RLS al guardar devolución.

Fix sugerido: No cerrar el modal si hubo error; mostrar mensaje de error al profe.
```

---

```
AUD-42 | Severidad: MEDIA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:358-361
Qué pasa: El modal de reserva recurrente del alumno (ModalRecurrenteAlumno) llama
a `onConfirmar(datos)` con los datos de la reserva recurrente, pero el handler en
Reservar es:
  onConfirmar={(datos)=>{ console.log("Recurrente:", datos); }}

La funcionalidad de reserva recurrente para el alumno no está implementada: solo
loguea en consola. El usuario completa todos los pasos del modal y al confirmar
nada ocurre (no se crean reservas, no se descuenta saldo).

Cuándo se manifiesta: Siempre que un alumno usa el flujo de reserva recurrente.

Fix sugerido: Implementar el handler: llamar a `crearReserva` para cada clase
confirmada o mostrar un mensaje claro de "funcionalidad en desarrollo".
```

---

```
AUD-43 | Severidad: MEDIA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:4986-4987 (Personas admin — eliminar alumno)
Qué pasa: El botón "Eliminar cuenta permanentemente" del admin solo elimina al
alumno del estado local de React:
  setAlumnos(prev=>prev.filter(x=>x.id!==a.id)); setSel(null);

No llama a ninguna función de db.js para eliminar la cuenta en Supabase. Al refrescar
la página, el alumno vuelve a aparecer.

Cuándo se manifiesta: Siempre. La eliminación de alumnos no persiste.

Fix sugerido: Implementar una función en db.js para desactivar/eliminar el alumno
(supabase.auth.admin.deleteUser en Edge Function, o marcar como eliminado).
```

---

```
AUD-44 | Severidad: MEDIA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:4249-4261 (Personas admin — nuevo profe)
Qué pasa: El formulario de "Nuevo profe" del admin solo agrega el profe al estado
local de React:
  setProfes(prev=>[...prev, { id: ..., nombre: ..., ... }]);

No llama a `crearProfe` de db.js ni crea la cuenta en Supabase Auth. Al refrescar
la página, el profe nuevo desaparece.

Cuándo se manifiesta: Siempre.

Fix sugerido: Llamar a `crearProfe` de db.js e implementar el alta real.
```

---

```
AUD-45 | Severidad: MEDIA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:5760-5761 (Login — recuperar contraseña)
Qué pasa: El botón "Enviar link" del flujo de recuperación de contraseña no llama
a `supabase.auth.resetPasswordForEmail`. Solo setea `recOk(true)` para mostrar
el mensaje de confirmación:
  <button onClick={()=>setRecOk(true)} ...>

El usuario recibe el mensaje "¡Revisá tu mail!" pero no se envía ningún email.

Cuándo se manifiesta: Siempre.

Fix sugerido: Llamar a `supabase.auth.resetPasswordForEmail(recMail)` antes de
mostrar la confirmación.
```

---

```
AUD-46 | Severidad: MEDIA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:4354 (guardar config Finanzas)
Qué pasa: La función `guardar` en Finanzas muestra "✓ Guardado" con timeout pero,
como se señaló en AUD-39, no persiste nada. Adicional: los cambios editados en
`cfg` (estado de React de AppAdminMain) tampoco se propagan a los componentes
hijos que usan CFG (la constante del módulo). Los cálculos financieros en Dashboard
y Finanzas seguirán usando los valores de CFG aunque el admin haya cambiado `cfg`.

Cuándo se manifiesta: Siempre que el admin edita la configuración.

Fix sugerido: Asegurarse de que todos los cálculos financieros usen `cfg` (el estado)
en lugar de `CFG` (la constante del módulo). En Dashboard: línea 3743 ya pasa `cfg`
a `sumPagoProfe` y `sumCowork`. Verificar que no haya referencias directas a CFG.
```

---

```
AUD-47 | Severidad: BAJA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:4772
Qué pasa: En el modal de reseña (ModalResenia), el texto hardcodeado menciona
"David González" explícitamente:
  "Tu opinión ayuda a otros alumnos a elegir y motiva a David a seguir mejorando."

Si se agregan más profes, el modal siempre mencionará a "David".

Fix sugerido: Usar el nombre del profe de la clase: `clase.profes?.profiles?.nombre || "el profe"`.
```

---

```
AUD-48 | Severidad: BAJA | Área: ux
Archivo y línea: src/PuntoClasesApp.jsx:3449
Qué pasa: El onboarding del profe (OnboardingProfe) hardcodea el nombre "David":
  { icon:"👋", titulo:"¡Bienvenido, David!", ... }

Todos los profes nuevos verán "¡Bienvenido, David!" en su onboarding.

Fix sugerido: Usar `profeNombre` o el nombre del usuario autenticado.
```

---

### ÁREA: ROBUSTEZ

---

```
AUD-49 | Severidad: ALTA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:1933 / 2234-2237 (ProfeReservas / Reservas)
Qué pasa: En los componentes del panel del profe que usan datos @seed (ProfeReservas
y el inicio de Reservas), se accede directamente a `r.alumno` como string. Pero
en la versión real (AppProfeMain), los datos de Supabase usan `r.alumnos?.profiles?.nombre`.
La función `normReserva` (línea 3544-3551) normaliza esto, pero los componentes
ProfeReservas y Alumnos todavía acceden a `r.alumno` directamente:

  <Av i={r.alumno.split(" ").map(n=>n[0]).join("").slice(0,2)} .../>  // línea 1933

Si `r.alumno` llega como `undefined` (porque la normalización no funcionó correctamente),
`.split()` lanzará un TypeError.

Cuándo se manifiesta: Si `normReserva` no setea `alumno` correctamente (ej. si el
alumno no tiene perfil asociado, `r.alumnos?.profiles?.nombre` devuelve undefined,
y el fallback es `r.alumno` que puede no existir en datos de Supabase).

Fix sugerido: Siempre usar `(r.alumno || "").split(...)`.
```

---

```
AUD-50 | Severidad: ALTA | Área: robustez
Archivo y línea: src/db.js:42-46 (getUsuarioActual)
Qué pasa: Si `supabase.from("profiles").select(...)` devuelve error (ej. perfil
no existe para ese usuario), el error se ignora silenciosamente (`const { data: perfil }`)
y se retorna `{ id, mail, ...undefined }`. Esto puede causar que `user.rol` sea
`undefined` en el router de roles, y la app no muestre ningún panel (retorna null,
pantalla en blanco).

Código exacto:
  const { data: perfil } = await supabase.from("profiles")...single();
  return { id: user.id, mail: user.email, ...perfil };

Cuándo se manifiesta: Si el trigger `handle_new_user` no creó el perfil (por un
error en el registro), o si la tabla profiles tiene datos inconsistentes.

Fix sugerido: Verificar el error y manejarlo explícitamente:
  const { data: perfil, error } = await supabase.from("profiles")...single();
  if (error || !perfil) throw new Error("Perfil no encontrado");
```

---

```
AUD-51 | Severidad: ALTA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:1275 (Perfil — tab Compras)
Qué pasa: En el tab de compras del perfil del alumno, el total invertido se calcula:
  (compras||[]).reduce((a,c)=>a+(c.monto||0),0)

El campo `monto` no existe en las compras reales de Supabase. La tabla `compras`
usa el campo `precio` (ver db.js línea 237-238). El total siempre mostrará $0.

Mismo problema en la línea 1283:
  <p ...>${(c.monto||0).toLocaleString("es-AR")}</p>

Y en la línea 1280:
  <p ...>{c.pack||c.descripcion||"Compra"}</p>
La tabla `compras` no tiene columna `pack` ni `descripcion`. Mostrará "Compra" siempre.

Cuándo se manifiesta: Siempre. El campo `monto` en la tabla es `precio`, y `pack`
no existe (ver crearCompra en db.js: `pack_id`, no `pack`).

Fix sugerido: Usar `c.precio` en lugar de `c.monto`.
Para el nombre del pack: derivar de `c.horas` + `c.pack_id`.
```

---

```
AUD-52 | Severidad: ALTA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:2704
Qué pasa: En el componente Ingresos del profe, se referencia `TARIFA_PROFE_GRP`
y `TARIFA_PROFE_IND` que son constantes del scope del panel admin (líneas 3685-3686),
no del scope del profe. En el panel del profe, Ingresos usa `calcPagoProfe(r)` (correcto),
pero los badges de detalle usan las constantes directamente:

  `👥 ${r.alumnosGrupo} alumnos × ${TARIFA_PROFE_GRP.toLocaleString(...)}` // línea 2704
  `👤 Individual · ${TARIFA_PROFE_IND.toLocaleString(...)}` // línea 2705

Estas constantes están definidas en el scope del módulo del panel admin y están
disponibles porque es el mismo archivo. Sin embargo, si se refactoriza el archivo,
este acoplamiento implícito causaría un error de referencia.

Cuándo se manifiesta: Por ahora funciona, pero es frágil y si se modifica CFG.tarifaProfeGrp
en la configuración del admin, los valores mostrados en los badges del profe NO
se actualizarán (usan la constante del módulo, no el estado `cfg` del admin).

Fix sugerido: Usar `CFG.tarifaProfeGrp` y `CFG.tarifaProfeInd` directamente,
o pasar cfg como prop al componente Ingresos.
```

---

```
AUD-53 | Severidad: MEDIA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:99-186 (bloques @seed)
Qué pasa: Los bloques de datos mock (@seed) del alumno (ALUMNO, COMPRAS, PROGRESO,
PROFES, DISPONIBILIDAD, HISTORIAL, PROXIMAS, MENSAJES_INIT) y del profe
(RESERVAS_INIT, DISPON_INIT, MENSAJES_PROFE_INIT) están incluidos en el bundle de
producción. Son varios KB de datos ficticios que nunca se usan en producción pero
aumentan el tamaño del bundle. Peor: algunos tienen datos de mails reales de prueba
(lucia@gmail.com, tomas@gmail.com, david@puntoclases.com).

Cuándo se manifiesta: Siempre. Son datos en el bundle del cliente.

Fix sugerido: Eliminar todos los bloques @seed o moverlos a un archivo separado
importado solo en desarrollo (ej. con import condicional en base a NODE_ENV).
```

---

```
AUD-54 | Severidad: MEDIA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:303 (calendarios fijos a 2026)
Qué pasa: Los calendarios del sistema (Reservar, Disponibilidad del profe, modal de
reprogramar, etc.) tienen el año hardcodeado a 2026:
  const year = 2026;   // línea 303, 1976, 2349, 2617, 4699
Y los meses están limitados entre mayo-agosto o similar:
  setMes(m=>Math.max(m-1,5))  // no puede ir antes de junio
  setMes(m=>Math.min(m+1,7))  // no puede ir más allá de agosto

En 2027 el sistema no permitirá reservar ninguna clase.

Cuándo se manifiesta: A partir del 1° de septiembre de 2026 (el calendario llega
solo hasta agosto) y definitivamente en enero 2027.

Fix sugerido: Usar `new Date().getFullYear()` para el año y eliminar los límites
de mes hardcodeados o hacerlos relativos a la fecha actual.
```

---

```
AUD-55 | Severidad: MEDIA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:31-45 (CFG hardcodeado)
Qué pasa: El objeto CFG con precios, tarifas y políticas está hardcodeado en el
frontend. Si el admin modifica la configuración en el panel (Finanzas → config),
esos cambios solo actualizan el estado `cfg` de AppAdminMain, pero NO actualizan
el objeto CFG usado en:
- La pantalla de compra del alumno (línea 48-51, 325, 594, 604, 622, etc.)
- Los cálculos de cancelación (ModalCancelacion, ModalReprogramar)
- El onboarding del alumno y del profe

Por ejemplo: si el admin cambia `vencimientoDias` de 45 a 30 en el panel, el alumno
seguirá viendo "las horas vencen a los 45 días" en todos los textos.

Cuándo se manifiesta: Siempre que el admin modifique la configuración en el panel
(aunque con AUD-39 la config tampoco se persiste, pero es un bug adicional).

Fix sugerido: Cargar la configuración desde Supabase (`getConfig()`) al inicio de
la app y propagarla como contexto React a todos los componentes.
```

---

```
AUD-56 | Severidad: MEDIA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:5847-5869 (useSaldoConDecimales)
Qué pasa: El hook `useSaldoConDecimales` está definido pero nunca se usa en la app.
Es código muerto.

Fix sugerido: Eliminar o integrar al flujo real de saldo.
```

---

```
AUD-57 | Severidad: BAJA | Área: robustez
Archivo y línea: src/db.js:143-151 (crearProfe)
Qué pasa: La función `crearProfe` inserta en la tabla `profes` sin `nombre` ni `mail`
(solo `materias`, `monotributo`, `activo`), asumiendo que el profe ya tiene cuenta.
El comentario reconoce esto ("En producción conviene hacerlo con una invitación...").
La función recibe `nombre` y `mail` como parámetros pero los ignora completamente.

Cuándo se manifiesta: Si se llama a crearProfe sin que el usuario ya exista.

Fix sugerido: Implementar el flujo completo de invitación o documentar claramente
que esta función es un stub incompleto.
```

---

```
AUD-58 | Severidad: BAJA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:1
Qué pasa: El import de `getPacks` desde db.js (que existe en línea 68) no está
incluido en el import statement de la línea 2. La función getPacks() está disponible
en db.js pero nunca se importa ni se usa en PuntoClasesApp.jsx. Los packs se leen
de la constante CFG hardcodeada en lugar de la tabla `packs` de Supabase.

Cuándo se manifiesta: Los packs mostrados al alumno siempre son los hardcodeados
en CFG, nunca los de la DB.

Fix sugerido: Cargar packs desde Supabase con `getPacks()` al inicio de AppAlumno
y pasarlos al componente Comprar. Así el admin puede gestionar packs sin deploys.
```

---

```
AUD-59 | Severidad: BAJA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:5123
Qué pasa: El formulario de registro del alumno (OnboardingRegistroAlumno) requiere
solo 4 caracteres de contraseña:
  form.pass.length >= 4

Esto es inseguro para una contraseña de cuenta real. Supabase Auth por defecto
requiere 6 caracteres mínimo, por lo que el formulario llegaría a Supabase y fallaría
con un error que no se muestra al usuario (ver AUD-04).

Fix sugerido: Usar el mínimo de Supabase (6 caracteres) o el recomendado (8+).
```

---

```
AUD-60 | Severidad: BAJA | Área: robustez
Archivo y línea: src/PuntoClasesApp.jsx:1023-1024
Qué pasa: En la respuesta de la API de Mercado Pago, se loguea el response completo:
  console.log("MP response completo:", JSON.stringify(pref));

Esto puede incluir datos sensibles de la preferencia (URLs, external_reference, etc.)
en la consola del navegador, visible para cualquier usuario en DevTools.

Fix sugerido: Eliminar el log en producción o condicionarlo a `import.meta.env.DEV`.
```

---

## RESUMEN EJECUTIVO

### Conteo de hallazgos por severidad

| Severidad | Cantidad |
|-----------|----------|
| CRITICA   | 3        |
| ALTA      | 24       |
| MEDIA     | 22       |
| BAJA      | 11       |
| **TOTAL** | **60**   |

---

### Top 5 más urgentes

**1. AUD-01 — CRITICA: VITE_MP_ACCESS_TOKEN expuesto en el bundle**
El Access Token de Mercado Pago (con permisos de cobro) está visible en el JavaScript
de producción. Cualquier visitante puede extraerlo y usarlo para crear preferencias de
pago, hacer reembolsos o consultar movimientos. Es el hallazgo con mayor impacto
financiero inmediato. Requiere crear un endpoint serverless antes de continuar
procesando pagos.

**2. AUD-09 + AUD-10 — CRITICA: Race conditions en acreditación de saldo**
El saldo se actualiza con `saldo_actual + horas` donde `saldo_actual` viene del estado
de React (potencialmente viejo). Con dos pestañas o una recarga rápida después del pago,
el saldo puede quedar mal calculado. La deduplicación por `payment_id` también tiene
una ventana de race condition. Con usuarios reales en producción, esto puede generar
saldos incorrectos (negativos o duplicados). Requiere operaciones atómicas en DB.

**3. AUD-03 — CRITICA: Contraseñas hardcodeadas en el bundle**
El array USUARIOS con contraseñas de admin, profe y alumnos de prueba está incluido
en el JavaScript de producción. Las contraseñas "admin123" y "profe123" son visibles
para cualquier visitante. Si estas credenciales corresponden a cuentas reales en
Supabase (probable dado que son las únicas credenciales de staff), hay riesgo de
acceso no autorizado al panel de administración.

**4. AUD-39 — ALTA: La configuración del admin no se persiste**
El admin puede editar precios, tarifas y políticas en el panel de Finanzas, ve
"✓ Guardado", pero nada se guarda en la DB. Al refrescar, todo vuelve a los valores
hardcodeados en CFG. Los cambios de negocio que el admin realice son silenciosamente
descartados.

**5. AUD-11 — ALTA: Race condition TOCTOU en creación de reservas**
La verificación de disponibilidad y la creación de la reserva son dos operaciones
separadas. Dos alumnos pueden reservar el mismo horario simultáneamente si ambos
pasan el check antes de que cualquiera inserte. Con usuarios reales en producción,
esto generará conflictos de horarios que deben resolverse manualmente. La solución
requiere que la función RPC `crear_reserva` en Supabase incluya la verificación de
disponibilidad dentro de la transacción.

---

*Fin del informe. Total de hallazgos: 60. Ningún código fue modificado durante esta auditoría.*

# CLAUDE.md — PuntoClases

Web de clases particulares. Continuás un proyecto **EN PRODUCCIÓN**.
Arrancá del estado de abajo; **no re-diagnostiques lo ✅**.

## Autonomía (regla fija)
- Claude Code corre TODO de forma autónoma sin pedir OK: lecturas, ediciones de código, comandos CLI, secrets, deploys, y migraciones a la base (incluida producción).
- ÚNICA obligación antes de una migración que MODIFIQUE o BORRE datos existentes (no para agregar columnas/tablas nuevas vacías): hacer un backup/dump de las tablas afectadas primero, automáticamente, sin preguntar. Dejar registrado en el CLAUDE.md qué se respaldó y dónde.
- Si una operación falla, revertir lo que se pueda y reportarlo a David. Nunca dejar la base rota a medias.

## Cómo trabajás conmigo (reglas fijas)
- Rioplatense, **output mínimo**. Tengo teclado complicado → **minimizá MI tecleo**: dame bloques para copiar y opciones para tildar.
- Antes de pedirme algo, **resolvelo vos con tus herramientas**: leé/editá/corré el código, `curl` para probar, Supabase CLI para datos. Pedime solo (a) un OK o (b) lo que tus herramientas no alcanzan (navegador/Dashboard).
- **CERO regresiones. Una cosa por vez. Evidencia ANTES de tocar; no asumas causas. Si errás, decilo.**
- Claude Code puede cargar secrets/credenciales por CLI directamente (corren en la máquina de David, los valores no pasan por chat).

## Bitácora viva (regla fija)
- Después de CADA cambio (código, deploy, migración, RPC, secrets), actualizá este archivo en la misma sesión.
- Si el cambio lo hizo alguien por fuera del código (David o Manuel en un dashboard) y me lo informan, registralo igual con fecha.
- Meta: que cualquiera que abra este archivo pueda retomar exactamente desde donde se dejó, sin re-diagnosticar.
- Mantené el archivo CORTO: estado actual, no historial largo. Lo cerrado se resume o se borra.

## Ahorro de tokens (aplicá por defecto, sin que lo pida)
- Mandá la exploración/búsqueda en el código a **subagentes**; que vuelva solo el resumen, no todo el rastreo. Es el mayor ahorro.
- **Avisame** cuando convenga `/clear` (cambié de tema) o `/compact` (sesión larga). **No los corras vos** — son destructivos y dependen de mi criterio.
- Las reglas y el estado viven acá, no en cada prompt.

## Entorno
- React+Vite → Vercel (auto-deploy en push a `main`). Repo: `c:\Users\Dell\Desktop\puntoclases`.
- Supabase ref: `ihwtdblkrxgzhdnzhzsh`. Pagos: Mercado Pago.
- Tooling listo: Node v24, Supabase CLI 2.106 (`npx supabase`, logueada+linkeada), Vercel CLI.
- Edge Functions: `crear-preferencia` (verify_jwt=true), `mp-webhook` (verify_jwt=false, público).
- MP test: vendedor de prueba `3462408456`. Comprador de prueba `3462408458`. Tarjeta: `4509 9535 6623 3704`, titular **APRO APRO**, 11/30, CVV 123, DNI 12345678.
- **NO pongas secretos en este archivo (se commitea a git).**
- **DB prod**: connection string en `DATABASE_URL` (`.env.local`, ignorado por git). Para consultar: `psql $DATABASE_URL -c "SELECT ..."`.

## Esquema (ojo)
- La tabla `compras` **NO tiene columna `created_at`** (sí tiene `creado_en`). Leé las columnas reales antes de consultarla.
- `service_role` tiene: `SELECT` en `config` y `packs`; `EXECUTE` en `acreditar_compra`. Ningún grant directo en `alumnos`, `compras`, `reservas`, `profiles`, `mensajes`.
- `acreditar_compra` es SECURITY DEFINER (owner postgres): inserta en `compras` y actualiza `alumnos` sin necesitar grants directos.

## ESTADO ACTUAL — al 2026-06-17 ✅ PRODUCCIÓN LISTA

### Todo cerrado y verificado en prod
- Pagos MP end-to-end en prod (credenciales prod cargadas; token rotado 2026-06-17 ~13:00)
- Webhook HMAC-SHA256 activo (firma inválida → 401, firma válida → 200, idempotente ✅)
- Horas sueltas: botón "Pagar con MP" habilitado al elegir cantidad ✅
- crear-preferencia: respuesta de error limpia (sin diagnóstico) ✅
- GRANTs service_role: solo `config (SELECT)` + `packs (SELECT)` en tablas de app ✅
- `crear_reserva`: fecha pasada + vencimiento validados en DB ✅
- `acreditar_compra`: renueva vencimiento al comprar ✅
- Privilege escalation en profiles cerrada ✅
- Chat en tiempo real (`mensajes` en publication realtime) ✅
- Profe nuevo: email automático para establecer contraseña ✅
- Errores inline, sin alert(), sin logs sensibles ✅
- Login/home: fondo celeste (#3D7A95→BL) reemplaza gris oscuro ✅
- CountdownClase: clases pasadas sin confirmar → "Pendiente de confirmación" en vez de tiempo negativo ✅
- Profe historial: botones "Clase dada / No se dio" para confirmar asistencia ✅
- Fix "0 días" (null vencimiento): dias=null, AlertaVencimiento retorna null, display "Sin fecha de vencimiento" ✅
- Fix saldo fantasma (saldoVivo): centralizado en módulo, aplica en header/Inicio/Perfil/Reservar ✅
- Fix 2 DB (migración 20260617000000): acreditar_compra aplica umbral 0.8; one-time UPDATE aplicado (0 filas afectadas) ✅
- Logo oficial transparente en login (`/logo-transparente.png`, 110px, alpha=0 confirmado) ✅
- Header app y login: fondo LOGO_BG=#DFF2FF (celeste exacto del PNG) — sin cuadrado visible ✅
- Subtítulo login: color #374151 explícito, sin opacity — legible sobre celeste ✅

- Tarjeta saldo Inicio: celeste #2188B6 (familia logo), textos opacity 0.80 unificado ✅
- Layout: ancho consistente en todas las pestañas — `width:"100%"` en todos los root containers + `boxSizing:"border-box"` donde hay padding lateral; elimina franjas blancas en móvil ✅
- PWA auto-update: vite-plugin-pwa (Workbox), banner "nueva versión → Actualizar" ✅
  - SW precachea app shell; polling cada hora; skipWaiting en click; cleanupOutdatedCaches ✅
  - Fix vercel.json: eliminado Clear-Site-Data de /sw.js (era destructivo, borraba auth) ✅
- mp-webhook: soporte dual formato MP — querystring `?type=payment&data.id=X` Y body JSON; firma HMAC usa el id correcto en ambos casos ✅
- Header profe: fondo negro → celeste LOGO_BG igual que vista alumno ✅
- Tarjeta bienvenida profe (Hoy/Próximas/Sin devolución): fondo negro → BL (#6FA8C0), textos DK (contraste 4.6:1 WCAG AA), alerta en P (rojo) ✅
- Badge mensajes profe: punto rojo en nav cuando hay msgs de alumnos sin leer (localStorage, sin col DB extra) ✅
- Clases confirmadas (estado ausente/realizada) → Historial aunque fecha >= hoy ✅
- Modal alumno ausente: monto no duplicado — desglose solo para grupal con >1 alumno ✅

### ⚠️ Pendiente de primera compra real
- Verificación end-to-end de acreditación en producción (requiere un pago real de usuario).

## Regla de negocio — Vencimiento de horas (fija)
- `saldo >= 0.8 hs` cuando vence → se pierde todo (saldo = 0). La clase mínima es 0.8 hs; si tenés menos no podés reservar.
- `saldo < 0.8 hs` cuando vence → se conserva (remanente no reservable se suma a próxima carga).
- La regla se aplica en `acreditar_compra` al recargar (punto atómico, idempotente por ON CONFLICT).
- Front: `saldoVivo(sal, venc)` en `AlumnoApp` → `saldoDisplay` se pasa a todos los componentes que muestran saldo (header badge, Inicio, Perfil, Reservar)..

## A futuro (no prioritario)
- **Google Calendar**: sincronizar reservas al Calendar del alumno y del profe. Requiere Google Cloud project con Calendar API habilitada + OAuth 2.0 credentials de Google. Iniciarlo cuando se decida.
- **WhatsApp**: notificaciones vía WA Business. Requiere cuenta Business en Meta verificada — el trámite tarda, conviene iniciarlo con tiempo.

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
- **Reads y diagnóstico:** automatizalos siempre.
- **Writes ADITIVOS / reversibles a la base** (ej: ADD COLUMN IF NOT EXISTS, CREATE POLICY, CREATE TABLE, INSERT … ON CONFLICT DO NOTHING, grants que agregan permisos, crear bucket de Storage, deploy de Edge Functions): corrélos vos por la Supabase CLI y mostrame evidencia de que aplicó. No me los pidas para correrlos yo.
- **Writes DESTRUCTIVOS / irreversibles** (DROP, DELETE, TRUNCATE, ALTER que borra o renombra columnas, migraciones con pérdida de datos, revocar o quitar permisos, rotar o borrar credenciales): NO ejecutes. Backup primero si aplica, mostrame el bloque y el plan, los corro yo.
- **Ante la duda:** si no tenés certeza de que un write es aditivo/reversible, tratalo como destructivo y pedime OK.

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
- **Foto de perfil** (alumnos y profes) ✅ — 2026-06-18
  - `profiles.avatar_url TEXT` (ADD COLUMN IF NOT EXISTS aplicado)
  - Bucket `avatars` (público) + 3 policies RLS storage (`avatar_insert_own`, `avatar_update_own`, `avatar_delete_own`) — path-based owner check
  - `subirAvatar(userId, file)` en db.js: Canvas center-crop → 400×400 webp 0.85 → storage upload → URL con `?t=timestamp`
  - Componente `Av`: prop `url` → `<img>` circular si existe, fallback a inicial
  - Perfil alumno: botón 📷 sobre avatar, modal de preview antes de confirmar, callback actualiza header en tiempo real
  - Perfil profe: ídem + fix bug avatar hardcodeado `"DG"` → `initialsProfe(perfil.nombre)`
- Header profe: fondo negro → celeste LOGO_BG igual que vista alumno ✅
- Tarjeta bienvenida profe (Hoy/Próximas/Sin devolución): fondo negro → BL (#6FA8C0), textos DK (contraste 4.6:1 WCAG AA), alerta en P (rojo) ✅
- Unificación celeste todos los roles — 6 elementos negros/oscuros → BL/LOGO_BG (criterio único: BL en hero cards, LOGO_BG en headers sticky, textos DK, boxes rgba(255,255,255,0.45), acentos P/GR) ✅
  - Profe Ingresos: tarjeta hero → BL, monto en P
  - Profe PerfilProfe: preview hero → BL; botón editar avatar DK → P
  - Admin Header: → LOGO_BG (igual a alumno y profe)
  - Admin Dashboard: hero → BL, ganancia negativa en P
  - Admin Finanzas P&L: card → BL, ganancia en GR (positiva) / P (negativa)
- Badge mensajes profe: punto rojo en nav cuando hay msgs de alumnos sin leer (localStorage, sin col DB extra) ✅
- Clases confirmadas (estado ausente/realizada) → Historial aunque fecha >= hoy ✅
- Modal alumno ausente: monto no duplicado — desglose solo para grupal con >1 alumno ✅
- **Foto de perfil** (alumnos y profes) ✅ — 2026-06-18
  - `profiles.avatar_url TEXT` (ADD COLUMN IF NOT EXISTS aplicado)
  - Bucket `avatars` (público) + 3 policies RLS storage (`avatar_insert_own`, `avatar_update_own`, `avatar_delete_own`) — path-based owner check
  - `subirAvatar(userId, file)` en db.js: Canvas center-crop → 400×400 webp 0.85 → storage upload → URL con `?t=timestamp`
  - Componente `Av`: prop `url` → `<img>` circular si existe, fallback a inicial
  - Perfil alumno: botón 📷 sobre avatar, modal de preview antes de confirmar, callback actualiza header en tiempo real
  - Perfil profe: ídem + fix bug avatar hardcodeado `"DG"` → `initialsProfe(perfil.nombre)`
  - Fix subida silenciosa: try/catch en `img.onload` (Promise no cuelga), fallback JPEG si WebP falla (iOS < 16.4), error visible en modal
  - Fix "No se pudo leer la imagen" (2026-06-18): `comprimirImagen` creaba segundo blob URL fuera de user-gesture → iOS WKWebView dispara `img.onerror`. Fix integral: `FileReader.readAsDataURL` en `onFileChangeAlumno/Profe` → `dataUrl` compartido para preview Y compresión (sin createObjectURL en Canvas). `subirAvatar` acepta `dataUrl`. Errores por paso con mensajes distintos. Elimina `alert()` → `setErrorFoto*` inline.
  - Fix "The resource already exists" (2026-06-18): `remove + upload` reemplazado por `upload upsert:true`. Agregada `avatar_select_own` SELECT policy en storage.objects (migration 20260618000001) para que el upsert resuelva el conflict check. Cache-busting `?t=timestamp` ya estaba en la URL retornada.

- **RLS profiles_update** (migración 20260618000000) ✅ — 2026-06-18
  - Causa: WITH CHECK tenía subquery `SELECT rol FROM profiles WHERE id = auth.uid()` → Postgres re-evaluaba la misma policy al leer la tabla → recursión infinita (42P17) al hacer UPDATE de avatar_url.
  - Fix: reemplazado por `mi_rol()` (ya SECURITY DEFINER + STABLE). Semántica idéntica.
  - Evidencia: UPDATE propio OK (UPDATE 1 sin recursión), cross-user denegado (UPDATE 0), cambio de rol propio rechazado (RLS error).

- **Botón compartir app** (F) ✅ — 2026-06-19
  - Componente `ShareBtn` en header alumno y profe. Web Share API en móvil; fallback clipboard + toast "Link copiado ✓" en desktop.
  - URL: `window.location.origin`. Sin tocar DB.

- **Disponibilidad profe bloques 30 min** (G) ✅ — 2026-06-19
  - `HORAS_DIA` extendido a 23 slots (08:00–19:00 en intervalos de 30 min). UI only — `hora` es `TEXT` sin CHECK constraint, DB acepta "08:30" sin migración.
  - Grilla profe: 3 → 4 columnas, padding reducido. Grilla alumno Reservar: array hardcodeado → `HORAS_DIA`, mismas 4 columnas.
  - Slots existentes en DB (horas enteras) siguen funcionando.

- **Guía PWA auto-abrir** (H) ✅ — 2026-06-19
  - `useEffect` en `LoginScreen`, `AppAlumno` y `PerfilProfe`: si `!ES_PWA && !localStorage("guia_pwa_vista")`, abre `GuiaInstalacion` a los 800ms y setea el flag.
  - El primer componente en montar gana; los demás no abren (flag ya seteado).
  - Acceso manual via botón en Perfil sigue disponible. Key localStorage: `guia_pwa_vista`.

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

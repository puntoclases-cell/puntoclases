// ════════════════════════════════════════════════════════════════════════════
// PUNTOCLASES — Capa de datos (Supabase)
// Reemplaza los bloques @seed de PuntoClasesApp.jsx por lecturas/escrituras reales.
// Instalar:  npm install @supabase/supabase-js
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

// Las claves van en variables de entorno, NUNCA hardcodeadas en el repo.
// En Vite: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  (archivo .env.local)
const URL  = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(URL, ANON);

// La anon key es pública (segura para el front): RLS protege los datos.
// La service_role key (que saltea RLS) JAMÁS va en el front — sólo server-side.

// ── AUTENTICACIÓN ────────────────────────────────────────────────────────────

// Registro de alumno. El trigger handle_new_user crea profile + fila en alumnos.
export async function registrarAlumno({ mail, pass, nombre, tel, nivel }) {
  const { data, error } = await supabase.auth.signUp({
    email: mail,
    password: pass,
    options: { data: { rol: "alumno", nombre, tel, nivel } },
  });
  if (error) throw error;
  return data.user;
}

export async function login(mail, pass) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: mail, password: pass });
  if (error) throw error;
  return data.user;
}

export async function logout() {
  await supabase.auth.signOut();
}

// Devuelve el usuario actual con su rol y nombre (de profiles), o null.
export async function getUsuarioActual() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil, error: perfilError } = await supabase.from("profiles").select("rol,nombre,mail").eq("id", user.id).single();
  if (perfilError || !perfil) throw new Error("Perfil no encontrado");
  return { id: user.id, mail: user.email, ...perfil };
}

// Escuchar cambios de sesión (login/logout) para actualizar la UI.
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
}

export async function enviarRecuperacion(mail) {
  const { error } = await supabase.auth.resetPasswordForEmail(mail);
  if (error) throw error;
}

export async function actualizarPassword(newPass) {
  const { error } = await supabase.auth.updateUser({ password: newPass });
  if (error) throw error;
}

export function onPasswordRecovery(callback) {
  return supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") callback();
  });
}

// ── CONFIG Y PACKS ───────────────────────────────────────────────────────────

export async function getConfig() {
  const { data, error } = await supabase.from("config").select("*").eq("id", 1).single();
  if (error) throw error;
  return data; // { precio_ind, factor_grupal, tarifa_profe_ind, ... }
}

export async function updateConfig(cambios) {
  const { data, error } = await supabase.from("config").update(cambios).eq("id", 1).select().single();
  if (error) throw error;
  return data;
}

export async function getPacks() {
  const { data, error } = await supabase.from("packs").select("*").eq("activo", true).order("orden");
  if (error) throw error;
  return data;
}

// ── ALUMNO ───────────────────────────────────────────────────────────────────

export async function getAlumno(alumnoId) {
  const { data, error } = await supabase
    .from("alumnos")
    .select("*, profiles(nombre, mail)")
    .eq("id", alumnoId).single();
  if (error) throw error;
  return data; // incluye saldo, saldo_residual, vencimiento, nivel, profiles.nombre
}

export async function getCompras(alumnoId) {
  const { data, error } = await supabase.from("compras").select("*").eq("alumno_id", alumnoId).order("creado_en", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getReservasAlumno(alumnoId) {
  const { data, error } = await supabase
    .from("reservas")
    .select("*, profes(profiles(nombre))")
    .eq("alumno_id", alumnoId).order("fecha", { ascending: false });
  if (error) throw error;
  return data;
}

// Crear reserva (descuenta saldo de forma atómica vía función SQL).
export async function verificarBloqueOcupado(profeId, fecha, hora) {
  const { data, error } = await supabase.from("reservas")
    .select("id")
    .eq("profe_id", profeId)
    .eq("fecha", fecha)
    .eq("hora", hora)
    .in("estado", ["confirmada", "pendiente"])
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

export async function crearReserva({ profeId, materia, fecha, hora, horas, modalidad, tipo, alumnosGrupo, necesidad }) {
  const { data, error } = await supabase.rpc("crear_reserva", {
    p_profe_id: profeId, p_materia: materia, p_fecha: fecha, p_hora: hora,
    p_horas: horas, p_modalidad: modalidad, p_tipo: tipo,
    p_alumnos_grupo: alumnosGrupo ?? null, p_necesidad: necesidad ?? null,
  });
  if (error) throw error; // p.ej. "Saldo insuficiente"
  return data;
}

export async function actualizarPerfil(userId, cambios) {
  const { data, error } = await supabase.from("profiles").update(cambios).eq("id", userId).select().single();
  if (error) throw error;
  return data;
}

// ── PROFE ────────────────────────────────────────────────────────────────────

export async function getProfes() {
  const { data, error } = await supabase.from("profes_publicos").select("*");
  if (error) throw error;
  return data; // { id, activo, materias, suspendido, nombre } — sin datos sensibles
}

export async function getProfesAdmin() {
  const { data, error } = await supabase.from("profes").select("*, profiles(nombre, mail)");
  if (error) throw error;
  return data;
}

export async function registrarProfe({ mail, pass, nombre, tel }) {
  const { data, error } = await supabase.auth.signUp({
    email: mail,
    password: pass,
    options: { data: { rol: "profe", nombre, tel } },
  });
  if (error) throw error;
  return data.user;
}

export async function crearProfe({ nombre, mail, materias, monotributo }) {
  // STUB: `nombre` y `mail` son ignorados aquí — el alta real de un profe
  // requiere crear su usuario auth (auth.signUp) server-side o vía invitación.
  // Usar `registrarProfe` para el flujo completo de registro con contraseña.
  const { data, error } = await supabase.from("profes").insert({
    materias, monotributo, activo: true,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function getReservasProfe(profeId) {
  const { data, error } = await supabase
    .from("reservas")
    .select("*, alumnos(profiles(nombre))")
    .eq("profe_id", profeId).order("fecha");
  if (error) throw error;
  return data;
}

export async function marcarReserva(reservaId, estado) {
  // estado: 'realizada' | 'ausente' | 'cancelada' | 'rechazada' | 'confirmada'
  const { data, error } = await supabase.from("reservas")
    .update({ estado, marcada_en: new Date().toISOString() })
    .eq("id", reservaId).select().single();
  if (error) throw error;
  return data;
}

export async function cargarDevolucion(reservaId, devolucion, avance) {
  const { data, error } = await supabase.from("reservas")
    .update({ devolucion, avance }).eq("id", reservaId).select().single();
  if (error) throw error;
  return data;
}

export async function reprogramarReserva(reservaId, nuevaFecha, nuevaHora) {
  const { data, error } = await supabase.from("reservas")
    .update({ fecha: nuevaFecha, hora: nuevaHora, estado: "confirmada" })
    .eq("id", reservaId).select().single();
  if (error) throw error;
  return data;
}

export async function getDisponibilidad(profeId) {
  const { data, error } = await supabase.from("disponibilidad").select("*").eq("profe_id", profeId);
  if (error) throw error;
  return data;
}

export async function setBloque(profeId, fecha, hora, tipo) {
  const { data, error } = await supabase.from("disponibilidad")
    .upsert({ profe_id: profeId, fecha, hora, tipo }, { onConflict: "profe_id,fecha,hora" })
    .select().single();
  if (error) throw error;
  return data;
}

export async function borrarBloque(profeId, fecha, hora) {
  const { error } = await supabase.from("disponibilidad").delete()
    .match({ profe_id: profeId, fecha, hora });
  if (error) throw error;
}

// ── ADMIN ────────────────────────────────────────────────────────────────────

export async function getAlumnos() {
  const { data, error } = await supabase.from("alumnos").select("*, profiles(nombre, mail)");
  if (error) throw error;
  return data;
}

export async function getTodasLasReservas() {
  const { data, error } = await supabase
    .from("reservas")
    .select("*, alumnos(profiles(nombre)), profes(profiles(nombre))")
    .order("fecha", { ascending: false });
  if (error) throw error;
  return data;
}

export async function actualizarProfe(profeId, cambios) {
  const { data, error } = await supabase.from("profes").update(cambios).eq("id", profeId).select().single();
  if (error) throw error;
  return data;
}

export async function actualizarAlumno(alumnoId, cambios) {
  const { data, error } = await supabase.from("alumnos").update(cambios).eq("id", alumnoId).select().single();
  if (error) throw error;
  return data;
}

export async function crearCompra(alumnoId, horas, precio, packId = null, estadoPago = "aprobado", paymentId = null) {
  const { data, error } = await supabase.from("compras")
    .insert({ alumno_id: alumnoId, horas, precio, medio: "mercadopago", pack_id: packId, estado_pago: estadoPago, payment_id: paymentId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function buscarCompraPorPaymentId(paymentId) {
  if (!paymentId) return null;
  const { data, error } = await supabase.from("compras").select("id").eq("payment_id", paymentId).maybeSingle();
  if (error) throw error;
  return data;
}

// ── CHAT ─────────────────────────────────────────────────────────────────────

export async function getMensajes(reservaId) {
  const { data, error } = await supabase.from("mensajes").select("*").eq("reserva_id", reservaId).order("creado_en");
  if (error) throw error;
  return data;
}

export async function enviarMensaje(reservaId, emisor, emisorId, texto) {
  const { data, error } = await supabase.from("mensajes")
    .insert({ reserva_id: reservaId, emisor, emisor_id: emisorId, texto }).select().single();
  if (error) throw error;
  return data;
}

// Suscripción en tiempo real a los mensajes de una reserva (chat en vivo).
export function suscribirMensajes(reservaId, onNuevo) {
  return supabase.channel(`chat-${reservaId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "mensajes", filter: `reserva_id=eq.${reservaId}` },
      (payload) => onNuevo(payload.new))
    .subscribe();
}

// ── RESEÑAS ──────────────────────────────────────────────────────────────────

export async function crearResenia(reservaId, alumnoId, profeId, estrellas, comentario) {
  const { data, error } = await supabase.from("resenias")
    .insert({ reserva_id: reservaId, alumno_id: alumnoId, profe_id: profeId, estrellas, comentario })
    .select().single();
  if (error) throw error;
  return data;
}

// ── RPC ATÓMICAS ─────────────────────────────────────────────────────────────

export async function acreditarCompra(alumnoId, horas, precio, paymentId, packId = null) {
  const { data, error } = await supabase.rpc("acreditar_compra", {
    p_alumno_id: alumnoId, p_horas: horas, p_precio: precio,
    p_payment_id: paymentId, p_pack_id: packId,
  });
  if (error) throw error;
  return data[0]; // { compra_id, saldo_nuevo }
}

export async function devolverHoras(reservaId, factorGrupal, penalizacionPct) {
  const { data, error } = await supabase.rpc("devolver_horas", {
    p_reserva_id: reservaId,
    p_factor_grupal: factorGrupal,
    p_penalizacion_pct: penalizacionPct,
  });
  if (error) throw error;
  return data[0]; // { saldo_nuevo, horas_devueltas }
}

export async function addHorasAdmin(alumnoId, delta = 1) {
  const { data, error } = await supabase.rpc("add_horas_admin", {
    p_alumno_id: alumnoId, p_delta: delta,
  });
  if (error) throw error;
  return data; // numeric saldo_nuevo
}

// ── EDGE FUNCTIONS ────────────────────────────────────────────────────────────

export async function crearPreferencia(horas, packId = null) {
  const { data, error } = await supabase.functions.invoke("crear-preferencia", {
    body: { horas, packId },
  });
  if (error) throw error;
  return data; // { init_point }
}

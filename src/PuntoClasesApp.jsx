import { useState, useEffect } from "react";
import { login, getUsuarioActual, onAuthChange, logout, getAlumno, getCompras, getReservasAlumno, getProfes, getProfesAdmin, getDisponibilidad, getReservasProfe, marcarReserva, cargarDevolucion, reprogramarReserva, setBloque, borrarBloque, getAlumnos, getTodasLasReservas, actualizarAlumno, actualizarProfe, actualizarPerfil, crearCompra, crearReserva, verificarBloqueOcupado, getMensajes, enviarMensaje, suscribirMensajes, registrarAlumno, registrarProfe, enviarRecuperacion, actualizarPassword, onPasswordRecovery, crearResenia, getConfig, updateConfig, getPacks, devolverHoras, addHorasAdmin, crearPreferencia } from "./db";

// ════════════════════════════════════════════════════════════════════════════
// PUNTOCLASES — APP UNIFICADA
// Login → detecta rol → muestra panel correcto
// Roles: alumno | profe (con onboarding) | admin
// ════════════════════════════════════════════════════════════════════════════


// ── MARCA ──────────────────────────────────────────────────────────────────
const P = "#D94F3D";      // rojo coral
const PD = "#B83C2C";     // rojo oscuro
const DK = "#2E2E2E";     // gris oscuro
const BL = "#6FA8C0";     // azul acero
const BG = "#F0F6FA";     // fondo celeste
const PL = "#FDECEA";     // rojo muy suave
const PB = "#F5C2BB";     // borde rojo suave
const AM = "#92400e";
const AML = "#fefce8";
const AMB = "#fde68a";
const GR  = "#15803d";
const GRL = "#f0fdf4";
const GRB = "#bbf7d0";

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE NEGOCIO — FUENTE ÚNICA DE VERDAD
// Cambiá un valor acá y se actualiza en TODOS los paneles (alumno, profe, admin).
// Ningún precio/tarifa debe estar hardcodeado en otro lado del archivo.
// ════════════════════════════════════════════════════════════════════════════
const CFG = {
  precioInd: 20000,        // $ que paga el alumno por hora individual
  factorGrupal: 0.8,       // la clase grupal descuenta 0.8 hs de saldo y cuesta 0.8 del valor
  tarifaProfeInd: 10000,   // $ que cobra el profe por hora individual
  tarifaProfeGrp: 8000,    // $ que cobra el profe por alumno-hora en grupal
  coworkPorAlumno: 2000,   // $ por alumno PRESENCIAL por hora (las virtuales NO pagan cowork)
  vencimientoDias: 45,     // las horas vencen a los 45 días desde la compra
  penalizacionPct: 50,     // cancelación con -24hs: alumno pierde 50%, profe cobra 50%
  packs: [                 // packs con descuento — el precio se DERIVA de precioInd
    { id: "p4",  horas: 4,  descuento: 10, tag: null },
    { id: "p8",  horas: 8,  descuento: 15, tag: "⭐ Popular" },
    { id: "p12", horas: 12, descuento: 20, tag: null },
  ],
  packPrueba: { id: "prueba", horas: 2, descuento: 50, tag: "🎁 1ra vez" }, // SOLO alumnos nuevos (1ra compra)
};

// ── DERIVADOS DE CFG (nunca duplicar un número, siempre calcular desde CFG) ──
const precioGrpHora    = (cfg = CFG) => Math.round(cfg.precioInd * (cfg.factorGrupal ?? CFG.factorGrupal)); // 16000
const precioPackTotal  = (horas, descuento, cfg = CFG) => Math.round(cfg.precioInd * horas * (1 - descuento / 100));
const precioHoraEquiv  = (horas, descuento, cfg = CFG) => precioPackTotal(horas, descuento, cfg) / horas;

// ── HELPERS FINANCIEROS CENTRALIZADOS ───────────────────────────────────────
// Una sola definición para cada cálculo: elimina las fórmulas duplicadas que
// antes vivían en Ingresos, Dashboard, Personas y Finanzas (origen del bug de
// "grupal sin multiplicar por horas").
//
// Pago al profe por una reserva. SIEMPRE multiplica por horas (fix grupal).
const calcPagoProfe = (r, cfg = CFG) => r.tipo === "grupal"
  ? cfg.tarifaProfeGrp * (r.alumnos_grupo ?? r.alumnosGrupo ?? 1) * (r.horas || 1)
  : cfg.tarifaProfeInd * (r.horas || 1);

// Seña al profe si el alumno cancela tarde / no se presenta: 50% de su tarifa.
// Se calcula sobre la tarifa del profe, sin importar el descuento que pagó el alumno.
const calcSeñaProfe = (r, cfg = CFG) => Math.round(calcPagoProfe(r, cfg) * cfg.penalizacionPct / 100);

// Costo cowork de una reserva: SOLO presenciales, $ por alumno POR HORA (las virtuales = 0).
const calcCoworkReserva = (r, cfg = CFG) => r.modalidad === "Presencial"
  ? (r.alumnos_grupo ?? r.alumnosGrupo ?? 1) * (r.horas || 1) * cfg.coworkPorAlumno
  : 0;

// Sumas sobre un conjunto de reservas.
const sumPagoProfe = (reservas, cfg = CFG) => reservas.reduce((a, r) => a + calcPagoProfe(r, cfg), 0);
const sumCowork    = (reservas, cfg = CFG) => reservas.reduce((a, r) => a + calcCoworkReserva(r, cfg), 0);

// Logo SVG
function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path d="M50 5C32 5 17 20 17 38C17 60 50 95 50 95C50 95 83 60 83 38C83 20 68 5 50 5Z" fill={DK}/>
      <path d="M52 8C36 8 23 21 23 38C23 58 52 90 52 90C52 90 79 58 79 38C79 21 68 8 52 8Z" fill={BL}/>
      <path d="M50 7C34 7 21 20 21 38C21 58 50 92 50 92C50 92 79 58 79 38C79 20 66 7 50 7Z" fill={P}/>
      <circle cx="50" cy="38" r="16" fill={DK}/>
      <circle cx="50" cy="38" r="9" fill={P}/>
      <circle cx="50" cy="38" r="4" fill={DK}/>
      <path d="M72 18 Q85 10 82 28" stroke={DK} strokeWidth="7" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CAPA DE DATOS MOCK — @seed
// Todo lo simulado con useState vive acá y en los otros bloques marcados @seed.
// Al conectar backend (Supabase/Firebase), reemplazar cada uno de estos por una
// query/fetch. Buscar "@seed" para encontrar la capa de datos completa.
// Clusters: (1) datos del alumno  (2) datos del profe  (3) datos del admin  (4) usuarios/login
// ════════════════════════════════════════════════════════════════════════════


const DIAS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ── HELPERS ─────────────────────────────────────────────────────────────────
const diasEnMes = (y,m) => new Date(y,m+1,0).getDate();
const primerDia = (y,m) => new Date(y,m,1).getDay();
const toISO = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const fmt = iso => { const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; };
const diasVenc = iso => { if (!iso) return 0; const [y,m,d]=iso.split("-"); const hoy=new Date(); hoy.setHours(0,0,0,0); return Math.ceil((new Date(+y,+m-1,+d)-hoy)/(1000*60*60*24)); };

// ── UI PRIMITIVOS ────────────────────────────────────────────────────────────
const Av = ({i,size=40,color=P}) => (
  <div style={{width:size,height:size,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:size*0.35,flexShrink:0}}>
    {i}
  </div>
);

const Badge = ({children,bg="#fdecea",col=P}) => (
  <span style={{background:bg,color:col,borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>{children}</span>
);

const Card = ({children,style={}}) => (
  <div style={{background:"#fff",borderRadius:16,padding:20,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",...style}}>{children}</div>
);

const Btn = ({children,onClick,disabled,variant="primary",full,style={}}) => {
  const styles = {
    primary: {background:disabled?"#ccc":P,color:"#fff"},
    secondary: {background:"#f1f5f9",color:"#475569"},
    danger: {background:"#fff5f5",color:"#dc2626",border:"1.5px solid #fecaca"},
    success: {background:disabled?"#ccc":"#15803d",color:"#fff"},
    warning: {background:"#fefce8",color:"#92400e",border:"1.5px solid #fde68a"},
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{border:"none",borderRadius:12,padding:"13px 16px",fontSize:14,fontWeight:700,cursor:disabled?"not-allowed":"pointer",width:"100%",...styles[variant],...style}}>
      {children}
    </button>
  );
};

// ── PANTALLA INICIO ──────────────────────────────────────────────────────────
function Inicio({onNav, saldo, nombre, reservas, vencimiento}) {
  const dias = vencimiento ? diasVenc(vencimiento) : 0;
  const pct = Math.min((saldo/12)*100,100);
  const hoyInicio = new Date().toISOString().slice(0,10);
  const proximaClase = (reservas||[])
    .filter(r => r.fecha >= hoyInicio && r.estado !== "cancelada")
    .sort((a,b) => a.fecha.localeCompare(b.fecha))[0] || null;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Hero saldo */}
      <div style={{background:`linear-gradient(135deg, ${DK} 0%, #3d3d3d 100%)`,borderRadius:20,padding:"22px 20px",color:"#fff",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(217,79,61,0.15)"}}/>
        <h2 style={{margin:"0 0 14px",fontSize:22,fontWeight:700}}>¡Hola, {nombre.split(" ")[0]}! 👋</h2>
        <div style={{background:"rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div>
              <p style={{margin:0,fontSize:13,opacity:0.8}}>Saldo de horas</p>
              <p style={{margin:"2px 0 0",fontSize:11,opacity:0.55}}>
                ≈ ${(saldo*CFG.precioInd).toLocaleString("es-AR")} en clases individuales
              </p>
            </div>
            <span style={{fontSize:24,fontWeight:800}}>{saldo} hs</span>
          </div>
          <div style={{background:"rgba(255,255,255,0.2)",borderRadius:99,height:6,marginBottom:6}}>
            <div style={{background:pct<=25?"#fca5a5":pct<=50?"#fde68a":"#86efac",borderRadius:99,height:6,width:`${pct}%`,transition:"width 0.6s"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,opacity:0.65}}>
            <span>Vence en {dias} días</span>
            <span>{vencimiento ? fmt(vencimiento) : "—"}</span>
          </div>
        </div>
      </div>

      {/* Alerta de vencimiento */}
      <AlertaVencimiento dias={dias} saldo={saldo} onComprar={()=>onNav("comprar")}/>

      {/* Countdown próxima clase */}
      {proximaClase && <CountdownClase clase={proximaClase} onChat={()=>onNav("mensajes")}/>}

      {/* Accesos rápidos */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {[
          {icon:"📅",label:"Reservar clase",sc:"reservar",bg:"#fdecea",border:PB},
          {icon:"📚",label:"Mis clases",sc:"historial",bg:"#f0fdf4",border:"#bbf7d0"},
          {icon:"💰",label:"Comprar horas",sc:"comprar",bg:"#fefce8",border:"#fde68a"},
          {icon:"👤",label:"Mi profe",sc:"profes",bg:"#f0f6fa",border:"#a8d4e8"},
        ].map(a=>(
          <button key={a.sc} onClick={()=>onNav(a.sc)} style={{background:a.bg,border:`1.5px solid ${a.border}`,borderRadius:14,padding:"16px 12px",cursor:"pointer",textAlign:"left",display:"flex",flexDirection:"column",gap:6}}>
            <span style={{fontSize:24}}>{a.icon}</span>
            <span style={{fontSize:14,fontWeight:600,color:DK}}>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── PANTALLA RESERVAR ─────────────────────────────────────────────────────────
function Reservar({ saldo, onReservar, profes, alumnoId }) {
  const [paso,setPaso] = useState(1);
  const [profeId,setProfeId] = useState(null);
  const [materia,setMateria] = useState("");
  const [modalidad,setModalidad] = useState("");
  const [fecha,setFecha] = useState(null);
  const [horas,setHoras] = useState([]);  // array de bloques tildados
  const [tipo,setTipo] = useState("individual");

  const [necesidad,setNecesidad] = useState("");
  const [mes,setMes] = useState(new Date().getMonth());
  const [mostrarCancelacion,setMostrarCancelacion] = useState(false);
  const [modalRecurrenteAlumno, setModalRecurrenteAlumno] = useState(false);
  const [errorReserva, setErrorReserva] = useState("");
  const year = new Date().getFullYear();
  const [nombreProfeElegido, setNombreProfeElegido] = useState("");

  const [disponRaw, setDisponRaw] = useState([]);
  useEffect(() => {
    if (!profeId) return;
    let cancelled = false;
    setDisponRaw([]);
    getDisponibilidad(profeId)
      .then(data => { if (!cancelled) setDisponRaw(data || []); })
      .catch(err => console.error("Error al cargar disponibilidad:", err));
    return () => { cancelled = true; };
  }, [profeId]);

  const profe = (profes||[]).find(p=>p.id===profeId);
  const dispon = disponRaw.reduce((acc, bloque) => {
    if (!acc[bloque.fecha]) acc[bloque.fecha] = {};
    acc[bloque.fecha][bloque.hora] = bloque.tipo;
    return acc;
  }, {});
  const bloquesDelDia = fecha ? Object.entries(dispon[fecha]||{})
    .filter(([h,t]) => t==="ambas" || t===tipo)
    .map(([h]) => h)
    .sort() : [];
  const costoBase = tipo==="grupal" ? CFG.factorGrupal : 1;
  const costo = +(costoBase * horas.length).toFixed(1);
  const saldoInsuficiente = costo > saldo;
  const toggleHora = (h) => setHoras(prev => prev.includes(h) ? prev.filter(x=>x!==h) : [...prev,h]);

  const materiasUnicas = [...new Set((profes||[]).flatMap(p=>p.materias||[]))].sort();
  const profesParaMateria = (profes||[]).filter(p=>(p.materias||[]).includes(materia));
  const seg = paso>=5?4:paso>=3?3:paso;

  if (paso===6) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:300,gap:16,textAlign:"center",padding:20}}>
      <div style={{width:80,height:80,background:PL,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40}}>🎉</div>
      <h2 style={{margin:0,color:DK,fontSize:22}}>¡Clase reservada!</h2>
      <p style={{margin:0,color:"#64748b",fontSize:15,lineHeight:1.6}}>{materia} con {nombreProfeElegido || profe?.nombre || profe?.titulo}<br/>{fmt(fecha)} — {horas.sort().join(', ')}</p>
      <Badge bg="#dcfce7" col="#15803d">-{costo} hs descontadas de tu saldo</Badge>
      <Btn onClick={()=>{setPaso(1);setProfeId(null);setMateria("");setModalidad("");setFecha(null);setHoras([]);setNecesidad("");setTipo("individual");setNombreProfeElegido("");}}>
        Reservar otra clase
      </Btn>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Banner reserva recurrente */}
      <button onClick={()=>setModalRecurrenteAlumno(true)}
        style={{background:"#f0f6fa",border:"1.5px solid #a8d4e8",borderRadius:14,padding:"12px 16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:24}}>🔄</span>
        <div style={{flex:1}}>
          <p style={{margin:0,fontWeight:700,fontSize:13,color:BL}}>¿Siempre el mismo día y hora?</p>
          <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>Configurá una reserva recurrente semanal →</p>
        </div>
      </button>
      {modalRecurrenteAlumno && (
        <ModalRecurrenteAlumno
          profes={profes}
          onConfirmar={(datos)=>{ console.log("Recurrente:", datos); }}
          onCerrar={()=>setModalRecurrenteAlumno(false)}
        />
      )}
      {/* Progreso */}
      <div style={{display:"flex",gap:6}}>
        {[1,2,3,4].map(n=>(
          <div key={n} style={{flex:1,height:4,borderRadius:99,background:seg>=n?P:"#e2e8f0",transition:"background 0.3s"}}/>
        ))}
      </div>

      {/* PASO 1: Materia */}
      {paso===1 && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <h3 style={{margin:0,color:DK}}>¿Qué materia necesitás?</h3>
          {!profes ? (
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {[90,70,110,85,75,95].map((w,i)=>(
                <div key={i} style={{width:w,height:42,borderRadius:99,background:"#e2e8f0",opacity:0.7}}/>
              ))}
            </div>
          ) : materiasUnicas.length===0 ? (
            <p style={{color:"#64748b",textAlign:"center",padding:20}}>No hay materias disponibles.</p>
          ) : (
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {materiasUnicas.map(m=>(
                <button key={m} onClick={()=>setMateria(m)}
                  style={{
                    background:materia===m?P:"#fff",
                    color:materia===m?"#fff":P,
                    border:`2px solid ${P}`,
                    borderRadius:99,
                    padding:"10px 18px",
                    fontSize:14,
                    fontWeight:700,
                    cursor:"pointer",
                    transition:"all 0.15s",
                  }}>
                  {m}
                </button>
              ))}
            </div>
          )}
          <Btn onClick={()=>setPaso(2)} disabled={!materia}>Continuar →</Btn>
        </div>
      )}

      {/* PASO 2: Profe para esa materia */}
      {paso===2 && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <button onClick={()=>{setPaso(1);setProfeId(null);setModalidad("");}}
            style={{background:"none",border:"none",cursor:"pointer",textAlign:"left",fontSize:14,color:P,fontWeight:700,padding:0}}>
            ← Cambiar materia
          </button>
          <h3 style={{margin:0,color:DK}}>Elegí tu profe de {materia}</h3>
          {profesParaMateria.length===0 ? (
            <Card>
              <p style={{margin:"0 0 12px",color:"#64748b",textAlign:"center",fontSize:14}}>
                No hay profes disponibles para <strong>{materia}</strong> en este momento.
              </p>
              <Btn onClick={()=>setPaso(1)} variant="secondary">← Elegir otra materia</Btn>
            </Card>
          ) : profesParaMateria.map(p=>{
            const nombreProfe = p.nombre || p.titulo || "";
            const initials = nombreProfe.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || "P";
            const modalidades = p.modalidad || p.modalidades || ["Presencial","Virtual"];
            const modalText = modalidades.length===1 ? modalidades[0] : "Presencial y Virtual";
            return (
              <div key={p.id} style={{
                border:`2px solid #e2e8f0`,
                borderRadius:16,
                padding:16,
                background:"#fff",
                boxShadow:"0 1px 6px rgba(0,0,0,0.04)",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                  <Av i={initials} color={P} size={48}/>
                  <div style={{flex:1}}>
                    <p style={{margin:0,fontWeight:800,fontSize:15,color:DK}}>{nombreProfe}</p>
                    <p style={{margin:"2px 0 6px",fontSize:12,color:"#64748b"}}>{modalText}</p>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {(p.materias||[]).map(m=>(
                        <span key={m} style={{
                          background:m===materia?P:"#f1f5f9",
                          color:m===materia?"#fff":"#64748b",
                          borderRadius:99,
                          padding:"3px 10px",
                          fontSize:11,
                          fontWeight:600,
                        }}>{m}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <Btn onClick={()=>{
                  setProfeId(p.id);
                  setNombreProfeElegido(nombreProfe);
                  setModalidad(modalidades[0]);
                  setFecha(null);
                  setHoras([]);
                  setPaso(3);
                }}>
                  Reservar con {nombreProfe.split(" ")[0]} →
                </Btn>
              </div>
            );
          })}
        </div>
      )}

      {/* PASO 3: Calendario */}
      {paso===3 && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:PL,border:`1.5px solid ${PB}`,borderRadius:12,padding:"10px 14px"}}>
            <p style={{margin:0,fontSize:13,color:P,fontWeight:600}}>
              {materia} · con {(nombreProfeElegido || profe?.nombre || profe?.titulo || "el profe").split(" ")[0]}
            </p>
          </div>
          <h3 style={{margin:0,color:DK}}>Elegí el día</h3>
          <Card style={{padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <button onClick={()=>setMes(m=>Math.max(m-1,0))} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:P}}>‹</button>
              <span style={{fontWeight:700,fontSize:15,color:DK}}>{MESES[mes]} {year}</span>
              <button onClick={()=>setMes(m=>Math.min(m+1,11))} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:P}}>›</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,textAlign:"center"}}>
              {DIAS.map(d=><div key={d} style={{fontSize:11,color:"#94a3b8",fontWeight:600,paddingBottom:4}}>{d}</div>)}
              {Array(primerDia(year,mes)).fill(null).map((_,i)=><div key={`e${i}`}/>)}
              {Array(diasEnMes(year,mes)).fill(null).map((_,i)=>{
                const d=i+1, iso=toISO(year,mes,d), sel=fecha===iso;
                const bloqDia = Object.entries(dispon[iso]||{})
                  .filter(([h,t]) => t==="ambas" || t===tipo);
                const tiene = bloqDia.length > 0;
                const hoy = toISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                const esPasado = iso < hoy;
                const disponible = tiene && !esPasado;
                return (
                  <button key={d} disabled={!disponible} onClick={()=>setFecha(iso)}
                    style={{aspectRatio:"1",borderRadius:8,border:sel?`2px solid ${P}`:"none",background:sel?P:disponible?PL:"transparent",color:sel?"#fff":disponible?P:"#cbd5e1",fontSize:13,fontWeight:disponible?700:400,cursor:disponible?"pointer":"default"}}>
                    {d}
                  </button>
                );
              })}
            </div>
          </Card>
          <p style={{margin:0,fontSize:12,color:"#94a3b8",textAlign:"center"}}>Los días resaltados tienen horarios disponibles</p>
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={()=>setPaso(2)} variant="secondary" style={{flex:1}}>← Volver</Btn>
            <Btn onClick={()=>setPaso(4)} disabled={!fecha} style={{flex:2}}>Continuar →</Btn>
          </div>
        </div>
      )}

      {/* PASO 4: Selector de bloques horarios */}
      {paso===4 && (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{background:PL,border:`1.5px solid ${PB}`,borderRadius:12,padding:"10px 14px"}}>
            <p style={{margin:0,fontSize:13,color:P,fontWeight:600}}>
              {materia} · con {(nombreProfeElegido || profe?.nombre || profe?.titulo || "el profe").split(" ")[0]}
            </p>
          </div>
          <div>
            <h3 style={{margin:"0 0 4px",color:DK}}>Elegí tus horas</h3>
            <p style={{margin:0,fontSize:13,color:"#64748b"}}>{fmt(fecha)} — tildá los bloques que querés</p>
          </div>

          {/* Leyenda */}
          <div style={{display:"flex",gap:16,fontSize:12,color:"#64748b"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:16,height:16,borderRadius:4,background:P}}/>
              <span>Seleccionado</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:16,height:16,borderRadius:4,background:PL,border:`1.5px solid ${PB}`}}/>
              <span>Disponible</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:16,height:16,borderRadius:4,background:"#f1f5f9",border:"1.5px solid #e2e8f0"}}/>
              <span>Ocupado</span>
            </div>
          </div>

          {/* Grilla de bloques — todos los horarios posibles del día */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
            {["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"].map(h => {
              const libre = bloquesDelDia.includes(h);
              const sel = horas.includes(h);
              return (
                <button key={h} onClick={()=>libre && toggleHora(h)} disabled={!libre}
                  style={{
                    padding:"14px 0",
                    borderRadius:12,
                    border: sel ? `2px solid ${P}` : libre ? `2px solid ${PB}` : "2px solid #e2e8f0",
                    background: sel ? P : libre ? PL : "#f8fafc",
                    color: sel ? "#fff" : libre ? P : "#cbd5e1",
                    fontWeight:700,
                    fontSize:13,
                    cursor:libre?"pointer":"not-allowed",
                    display:"flex",
                    flexDirection:"column",
                    alignItems:"center",
                    gap:4,
                    transition:"all 0.15s",
                    position:"relative",
                  }}>
                  {sel ? <span style={{fontSize:10,opacity:0.9}}>✓</span> : libre ? <span style={{fontSize:10}}>{(dispon[fecha]||{})[h]==="ambas"?"✦":"·"}</span> : null}
                  {h}
                  {!libre && <span style={{fontSize:9,color:"#94a3b8",fontWeight:400}}>ocupado</span>}
                </button>
              );
            })}
          </div>

          {/* Resumen de selección */}
          {horas.length > 0 && (
            <Card style={{background:PL,border:`1.5px solid ${PB}`,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{horas.length} hora{horas.length>1?"s":""} seleccionada{horas.length>1?"s":""}</p>
                  <p style={{margin:"4px 0 0",fontSize:12,color:"#64748b"}}>{horas.sort().join(" · ")}</p>
                </div>
                <div style={{textAlign:"right"}}>
                  <p style={{margin:0,fontSize:20,fontWeight:800,color:P}}>{costo} hs</p>
                  <p style={{margin:"2px 0 0",fontSize:11,color:"#64748b"}}>de tu saldo</p>
                </div>
              </div>
            </Card>
          )}

          {/* Tipo de clase — las clases virtuales son solo individuales */}
          <p style={{margin:"4px 0 0",fontWeight:600,color:DK,fontSize:14}}>Tipo de clase:</p>
          <div style={{display:"grid",gridTemplateColumns:modalidad==="Virtual"?"1fr":"1fr 1fr",gap:10}}>
            {/* INDIVIDUAL */}
            <button onClick={()=>setTipo("individual")}
              style={{background:tipo==="individual"?PL:"#fff",border:`2px solid ${tipo==="individual"?P:"#e2e8f0"}`,borderRadius:12,padding:"14px",cursor:"pointer",textAlign:"left"}}>
              <div style={{fontSize:22}}>👤</div>
              <div style={{fontWeight:700,fontSize:14,color:DK,marginTop:4}}>Individual</div>
              <div style={{fontSize:12,color:P,fontWeight:600}}>{horas.length||1} hs de saldo</div>
              <div style={{fontSize:11,color:"#94a3b8"}}>${((horas.length||1)*CFG.precioInd).toLocaleString("es-AR")}</div>
            </button>
            {/* GRUPAL — solo presencial */}
            {modalidad!=="Virtual" && (
            <button onClick={()=>setTipo("grupal")}
              style={{background:tipo==="grupal"?"#f0fdf4":"#fff",border:`2px solid ${tipo==="grupal"?"#15803d":"#e2e8f0"}`,borderRadius:12,padding:"14px",cursor:"pointer",textAlign:"left",position:"relative"}}>
              <span style={{position:"absolute",top:-8,right:8,background:"#15803d",color:"#fff",fontSize:10,fontWeight:700,borderRadius:99,padding:"2px 8px"}}>{CFG.packs[CFG.packs.length-1].descuento}% OFF</span>
              <div style={{fontSize:22}}>👥</div>
              <div style={{fontWeight:700,fontSize:14,color:DK,marginTop:4}}>Grupal</div>
              <div style={{fontSize:12,color:"#15803d",fontWeight:600}}>{horas.length>0?costo:"—"} hs de saldo</div>
              <div style={{fontSize:11,color:"#94a3b8"}}>${horas.length>0?(costo*CFG.precioInd).toLocaleString("es-AR"):"—"} · ahorrás ${horas.length>0?((horas.length-costo)*CFG.precioInd).toLocaleString("es-AR"):"—"}</div>
            </button>
            )}
          </div>
          {modalidad==="Virtual" && (
            <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>ℹ️ Las clases virtuales son siempre individuales.</p>
          )}
          {/* Explicación del descuento */}
          {tipo==="grupal" && (
            <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:10,padding:"10px 12px"}}>
              <p style={{margin:0,fontSize:12,color:"#15803d"}}>
                💡 La clase grupal vale <strong>{costo} hs</strong> de saldo en lugar de <strong>{horas.length} hs</strong>.
                Pagaste ${CFG.precioInd.toLocaleString("es-AR")}/hs pero gastás menos saldo porque compartís la clase.
              </p>
            </div>
          )}

          <Card style={{background:"#fefce8",border:"1.5px solid #fde68a",padding:12}}>
            <p style={{margin:0,fontSize:13,color:"#92400e"}}>⚠️ Cancelaciones con menos de 24hs pierden el 50% por hora.</p>
          </Card>
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={()=>setPaso(3)} variant="secondary" style={{flex:1}}>← Volver</Btn>
            <Btn onClick={()=>setMostrarCancelacion(true)} disabled={horas.length===0} style={{flex:2}}>Continuar →</Btn>
          </div>
          {mostrarCancelacion && (
            <ModalCancelacion
              onAceptar={()=>{setMostrarCancelacion(false);setPaso(5);}}
              onCerrar={()=>setMostrarCancelacion(false)}
            />
          )}
        </div>
      )}

      {/* PASO 5: Confirmar */}
      {paso===5 && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <h3 style={{margin:0,color:DK}}>¿Qué necesitás trabajar?</h3>
          <p style={{margin:0,fontSize:13,color:"#64748b"}}>Contale a {(nombreProfeElegido || profe?.nombre || profe?.titulo || "el profe").split(" ")[0]} qué temas traer preparados. Cuanto más detalle, mejor la clase.</p>
          <textarea value={necesidad} onChange={e=>setNecesidad(e.target.value)}
            placeholder="Ej: Tengo parcial de funciones cuadráticas la semana que viene y no entiendo factorización..."
            style={{width:"100%",minHeight:120,borderRadius:12,border:`2px solid ${necesidad?P:"#e2e8f0"}`,padding:14,fontSize:14,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",outline:"none",transition:"border 0.2s"}}/>
          <Card style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",padding:14}}>
            <p style={{margin:"0 0 8px",fontWeight:700,fontSize:13,color:"#166534"}}>Resumen de tu reserva</p>
            <div style={{display:"flex",flexDirection:"column",gap:4,fontSize:13,color:"#374151"}}>
              <span>👨‍🏫 {nombreProfeElegido || profe?.nombre || profe?.titulo || "—"} — {materia}</span>
              <span>📅 {fmt(fecha)} — {horas.sort().join(', ')}</span>
              <span>📍 {modalidad} · Clase {tipo}</span>
              <span>⏱ Se descuentan <strong>{costo} hs</strong> de tu saldo</span>
            </div>
          </Card>
          {saldoInsuficiente && (
            <div style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:12,padding:"10px 14px",fontSize:13,color:"#dc2626"}}>
              ⚠️ No te alcanza el saldo: esta reserva cuesta {costo} hs y tenés {saldo} hs. Comprá más horas para continuar.
            </div>
          )}
          {errorReserva && (
            <div style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:12,padding:"10px 14px",fontSize:13,color:"#dc2626"}}>
              ⚠️ {errorReserva}
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={()=>setPaso(4)} variant="secondary" style={{flex:1}}>← Volver</Btn>
            <Btn onClick={async ()=>{
              setErrorReserva("");
              try {
                const hoy = toISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                if (fecha < hoy) {
                  setErrorReserva("No podés reservar en una fecha pasada.");
                  return;
                }
                for (const h of horas) {
                  const ocupado = await verificarBloqueOcupado(profeId, fecha, h);
                  if (ocupado) {
                    setErrorReserva(`El horario ${h} ya no está disponible. Volvé a elegir otro.`);
                    setPaso(3);
                    return;
                  }
                }
                for (const h of horas) {
                  await crearReserva({ profeId, materia, fecha, hora: h, horas: 1, modalidad, tipo, alumnosGrupo: null, necesidad });
                }
                onReservar(costo);
                setPaso(6);
              } catch (err) {
                setErrorReserva(err.message || "No se pudo confirmar la reserva. Intentá de nuevo.");
              }
            }} disabled={saldoInsuficiente} style={{flex:2}}>Confirmar reserva ✓</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PANTALLA HISTORIAL ───────────────────────────────────────────────────────
function Historial({ reservas, onReprogramar, onCancelar, alumnoId, cfg }) {
  const [tab,setTab] = useState("proximas");
  const [abierto,setAbierto] = useState(null);
  const [modalResenia,setModalResenia] = useState(null);
  const [modalReprog,setModalReprog] = useState(null);
  const [resenias,setResenias] = useState({});

  const hoy = new Date().toISOString().slice(0,10);
  const proximas = (reservas||[])
    .filter(r => r.fecha >= hoy)
    .sort((a,b) => a.fecha.localeCompare(b.fecha));
  const pasadas = (reservas||[])
    .filter(r => r.fecha < hoy)
    .sort((a,b) => b.fecha.localeCompare(a.fecha));

  const estadoBadge = {
    confirmada: { bg:"#dcfce7", col:"#15803d", label:"Confirmada ✓" },
    pendiente:  { bg:"#fefce8", col:"#92400e", label:"Pendiente" },
    cancelada:  { bg:"#fff5f5", col:"#dc2626", label:"Cancelada" },
  };
  const getBadge = (estado) => estadoBadge[estado] || { bg:"#f1f5f9", col:"#64748b", label: estado||"Reservada" };

  const inicialesProfe = (nombre) =>
    (nombre||"").split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || "P";

  if (!reservas) return <p style={{color:"#64748b",textAlign:"center",padding:20}}>Cargando clases…</p>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Mis clases</h3>
      <div style={{display:"flex",background:"#f1f5f9",borderRadius:12,padding:4,gap:4}}>
        {[{v:"proximas",l:"Próximas"},{v:"historial",l:"Historial"}].map(t=>(
          <button key={t.v} onClick={()=>setTab(t.v)}
            style={{flex:1,background:tab===t.v?"#fff":"transparent",border:"none",borderRadius:10,padding:"10px",fontSize:14,fontWeight:700,color:tab===t.v?P:"#64748b",cursor:"pointer",boxShadow:tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {tab==="proximas" && proximas.length === 0 && (
        <p style={{color:"#94a3b8",textAlign:"center",padding:16,fontSize:14}}>No tenés clases próximas agendadas.</p>
      )}
      {tab==="proximas" && proximas.map(c=>{
        const nombreProfe = c.profes?.profiles?.nombre || "";
        const badge = getBadge(c.estado);
        return (
          <Card key={c.id}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <Av i={inicialesProfe(nombreProfe)} color={P}/>
              <div style={{flex:1}}>
                <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>{c.materia}</p>
                <p style={{margin:"2px 0 0",fontSize:13,color:"#64748b"}}>con {nombreProfe}</p>
              </div>
              <div style={{textAlign:"right"}}>
                <p style={{margin:0,fontWeight:700,color:P}}>{c.hora}</p>
                <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{fmt(c.fecha)}</p>
              </div>
            </div>
            <div style={{marginTop:10,display:"flex",gap:8}}>
              <Badge bg="#f0f6fa" col={BL}>{c.modalidad}</Badge>
              <Badge bg={badge.bg} col={badge.col}>{badge.label}</Badge>
            </div>
            {(c.estado === "confirmada" || c.estado === "pendiente") && (
              <div style={{marginTop:10}}>
                <Btn variant="danger" onClick={()=>setModalReprog(c)}>Reprogramar / Cancelar</Btn>
              </div>
            )}
          </Card>
        );
      })}

      {tab==="historial" && pasadas.length === 0 && (
        <p style={{color:"#94a3b8",textAlign:"center",padding:16,fontSize:14}}>Todavía no tenés clases realizadas.</p>
      )}
      {tab==="historial" && pasadas.map(c=>{
        const nombreProfe = c.profes?.profiles?.nombre || "";
        const nombreCorto = nombreProfe.split(" ")[0] || "el profe";
        return (
          <Card key={c.id} style={{cursor:"pointer"}}>
            <div onClick={()=>setAbierto(abierto===c.id?null:c.id)} style={{display:"flex",alignItems:"center",gap:12}}>
              <Av i={inicialesProfe(nombreProfe)} color="#94a3b8" size={36}/>
              <div style={{flex:1}}>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{c.materia}</p>
                <p style={{margin:"2px 0 0",fontSize:12,color:"#94a3b8"}}>{fmt(c.fecha)} · {c.hora} · {c.modalidad}</p>
              </div>
              <span style={{color:"#94a3b8",fontSize:16}}>{abierto===c.id?"▲":"▼"}</span>
            </div>
            {abierto===c.id && (
              <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>
                <div style={{background:"#f8fafc",borderRadius:10,padding:12}}>
                  <p style={{margin:"0 0 4px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Lo que pediste trabajar</p>
                  <p style={{margin:0,fontSize:13,color:"#374151"}}>{c.necesidad||"—"}</p>
                </div>
                {c.devolucion ? (
                  <div style={{background:"#f0fdf4",borderRadius:10,padding:12,border:"1px solid #bbf7d0"}}>
                    <p style={{margin:"0 0 4px",fontSize:11,fontWeight:700,color:"#166534",textTransform:"uppercase"}}>Devolución de {nombreCorto}</p>
                    <p style={{margin:0,fontSize:13,color:"#374151"}}>{c.devolucion}</p>
                  </div>
                ) : (
                  <div style={{background:"#fefce8",borderRadius:10,padding:12,border:"1px solid #fde68a"}}>
                    <p style={{margin:0,fontSize:13,color:"#92400e"}}>⏳ {nombreCorto} todavía no cargó la devolución.</p>
                  </div>
                )}
                {c.estado==="realizada" && !resenias[c.id] && (
                  <button onClick={()=>setModalResenia(c)}
                    style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:13,fontWeight:700,color:"#92400e",textAlign:"left"}}>
                    ⭐ Calificar clase
                  </button>
                )}
                {resenias[c.id] && (
                  <div style={{background:"#f8fafc",borderRadius:10,padding:"8px 14px",fontSize:13,color:"#64748b"}}>
                    {"★".repeat(resenias[c.id].estrellas)} · {resenias[c.id].comentario||"Reseña enviada"}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {modalResenia && (
        <ModalResenia
          clase={modalResenia}
          onGuardar={async (estrellas, comentario) => {
            try {
              await crearResenia(modalResenia.id, alumnoId, modalResenia.profe_id, estrellas, comentario);
              setResenias(prev=>({...prev,[modalResenia.id]:{estrellas,comentario}}));
            } catch(err) { console.error("Error al guardar reseña:", err); }
            setModalResenia(null);
          }}
          onOmitir={()=>setModalResenia(null)}
        />
      )}
      {modalReprog && (
        <ModalReprogramar
          reserva={modalReprog}
          cfg={cfg}
          onCerrar={()=>setModalReprog(null)}
          onConfirmar={(nuevaFecha, nuevaHora) => onReprogramar(modalReprog.id, nuevaFecha, nuevaHora)}
          onCancelar={(saldoNuevo) => onCancelar(modalReprog.id, saldoNuevo)}
        />
      )}
    </div>
  );
}

// ── PANTALLA COMPRAR ─────────────────────────────────────────────────────────
function Comprar({ onComprar, compras, cfg: cfgProp, packsDB }) {
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("packs"); // "packs" | "sueltas"
  const [cantSueltas, setCantSueltas] = useState(1);
  const [pago, setPago] = useState("idle"); // idle | procesando | aprobado
  // El pack de prueba solo aplica a la 1ra compra: si no hay historial, es alumno nuevo.
  const esNuevoAlumno = compras !== null && compras.length === 0;

  const cfgEfectiva = cfgProp || CFG; // usa config live si está disponible
  const PRECIO_HS = cfgEfectiva.precioInd;

  // Identifica pack prueba (tag con "1ra vez") y packs regulares desde DB o CFG
  const packPruebaSource = packsDB && packsDB.length
    ? packsDB.find(p => (p.tag || "").includes("1ra"))
    : CFG.packPrueba;
  const packsRegSource = packsDB && packsDB.length
    ? packsDB.filter(p => !((p.tag || "").includes("1ra")))
    : CFG.packs;

  const mkPack = (p, esNuevo = false) => ({
    id: p.id,
    horas: p.horas,
    precio: precioPackTotal(p.horas, p.descuento, cfgEfectiva),
    original: p.horas * PRECIO_HS,
    desc: `${p.descuento}% OFF`,
    tag: p.tag,
    esNuevo,
  });
  const packs = [
    ...(packPruebaSource ? [mkPack(packPruebaSource, true)] : []),
    ...packsRegSource.map(p => mkPack(p)),
  ];

  // Si compra sueltas, ¿cuánto le habría costado con el mejor pack que califica?
  const packAplicable = [...packsRegSource].reverse().find(p => cantSueltas >= p.horas);
  const precioSuelto = cantSueltas * PRECIO_HS;
  const precioEquivPack = packAplicable
    ? cantSueltas * precioHoraEquiv(packAplicable.horas, packAplicable.descuento, cfgEfectiva)
    : null;
  const ahorroPack = precioEquivPack ? precioSuelto - precioEquivPack : 0;

  const seleccion = tab==="packs"
    ? packs.find(p=>p.id===sel)
    : {horas:cantSueltas, precio:precioSuelto};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div>
        <h3 style={{margin:"0 0 4px",color:DK}}>Comprar horas</h3>
        <p style={{margin:0,fontSize:13,color:"#64748b"}}>Las horas vencen a los {cfgEfectiva.vencimiento||cfgEfectiva.vencimientoDias||CFG.vencimientoDias} días desde la compra.</p>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",background:"#f1f5f9",borderRadius:12,padding:4,gap:4}}>
        {[{v:"packs",l:"📦 Packs con descuento"},{v:"sueltas",l:"🕐 Horas sueltas"}].map(t=>(
          <button key={t.v} onClick={()=>{setTab(t.v);setSel(null);}}
            style={{flex:1,background:tab===t.v?"#fff":"transparent",border:"none",borderRadius:10,padding:"10px 6px",fontSize:12,fontWeight:700,color:tab===t.v?P:"#64748b",cursor:"pointer",boxShadow:tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* PACKS */}
      {tab==="packs" && (<>
        <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:12,padding:"12px 14px"}}>
          <p style={{margin:"0 0 6px",fontWeight:700,fontSize:13,color:"#15803d"}}>💡 ¿Cómo funciona el saldo?</p>
          <div style={{fontSize:12,color:"#374151",lineHeight:1.7}}>
            <div>• Clase <strong>individual</strong>: descuenta <strong>1 hs</strong> de saldo (${cfgEfectiva.precioInd.toLocaleString("es-AR")}/hs)</div>
            <div>• Clase <strong>grupal</strong>: descuenta <strong>{cfgEfectiva.factorGrupal} hs</strong> de saldo — pagás ${precioGrpHora(cfgEfectiva).toLocaleString("es-AR")} en lugar de ${cfgEfectiva.precioInd.toLocaleString("es-AR")} ✓</div>
            <div>• Las horas vencen a los <strong>{cfgEfectiva.vencimiento||cfgEfectiva.vencimientoDias||CFG.vencimientoDias} días</strong> — el residual de grupales se acumula y no vence</div>
          </div>
        </div>
        {packs.filter(p=>!p.esNuevo || esNuevoAlumno).map(p=>(
          <button key={p.id} onClick={()=>setSel(p.id)}
            style={{
              background:p.esNuevo?(sel===p.id?"#fefce8":AML):(sel===p.id?PL:"#fff"),
              border:`2px solid ${p.esNuevo?(sel===p.id?AMB:AMB):(sel===p.id?P:"#e2e8f0")}`,
              borderRadius:14,padding:"16px",cursor:"pointer",textAlign:"left",position:"relative"
            }}>
            {p.tag && <span style={{position:"absolute",top:-10,right:16,background:p.esNuevo?AM:P,color:"#fff",borderRadius:99,padding:"2px 12px",fontSize:12,fontWeight:700}}>{p.tag}</span>}
            {p.esNuevo && (
              <div style={{background:AML,borderRadius:8,padding:"6px 10px",marginBottom:10,border:`1px solid ${AMB}`}}>
                <p style={{margin:0,fontSize:12,color:AM,fontWeight:600}}>🎁 Solo para nuevos alumnos — primera compra</p>
              </div>
            )}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <p style={{margin:0,fontSize:22,fontWeight:800,color:DK}}>{p.horas} horas</p>
                <p style={{margin:"2px 0 6px",fontSize:13,color:"#64748b"}}>${(p.precio/p.horas).toLocaleString("es-AR")} / hora</p>
                <Badge bg={p.esNuevo?"#fef3c7":"#dcfce7"} col={p.esNuevo?AM:"#15803d"}>{p.desc}</Badge>
              </div>
              <div style={{textAlign:"right"}}>
                <p style={{margin:0,fontSize:22,fontWeight:800,color:p.esNuevo?AM:P}}>${p.precio.toLocaleString("es-AR")}</p>
                <p style={{margin:"2px 0 0",fontSize:12,textDecoration:"line-through",color:"#94a3b8"}}>${p.original.toLocaleString("es-AR")}</p>
                <p style={{margin:"2px 0 0",fontSize:11,color:p.esNuevo?AM:"#15803d",fontWeight:600}}>
                  Ahorrás ${(p.original-p.precio).toLocaleString("es-AR")}
                </p>
              </div>
            </div>
          </button>
        ))}
      </>)}

      {/* HORAS SUELTAS */}
      {tab==="sueltas" && (<>
        <div style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:12,padding:"10px 14px"}}>
          <p style={{margin:0,fontSize:13,color:"#92400e"}}>💡 Las horas sueltas valen ${PRECIO_HS.toLocaleString("es-AR")} c/u (precio full, sin descuento).</p>
        </div>

        {/* Selector cantidad */}
        <Card>
          <p style={{margin:"0 0 14px",fontWeight:700,fontSize:15,color:DK}}>¿Cuántas horas querés comprar?</p>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:20,marginBottom:16}}>
            <button onClick={()=>setCantSueltas(c=>Math.max(1,c-1))}
              style={{width:44,height:44,borderRadius:"50%",background:cantSueltas===1?"#f1f5f9":PL,border:"none",cursor:cantSueltas===1?"not-allowed":"pointer",fontSize:24,fontWeight:800,color:cantSueltas===1?"#cbd5e1":P,display:"flex",alignItems:"center",justifyContent:"center"}}>
              −
            </button>
            <div style={{textAlign:"center"}}>
              <p style={{margin:0,fontSize:48,fontWeight:800,color:P,lineHeight:1}}>{cantSueltas}</p>
              <p style={{margin:0,fontSize:13,color:"#64748b"}}>hora{cantSueltas!==1?"s":""}</p>
            </div>
            <button onClick={()=>setCantSueltas(c=>Math.min(10,c+1))}
              style={{width:44,height:44,borderRadius:"50%",background:cantSueltas===10?"#f1f5f9":PL,border:"none",cursor:cantSueltas===10?"not-allowed":"pointer",fontSize:24,fontWeight:800,color:cantSueltas===10?"#cbd5e1":P,display:"flex",alignItems:"center",justifyContent:"center"}}>
              +
            </button>
          </div>

          {/* Resumen precio */}
          <div style={{background:"#f8fafc",borderRadius:12,padding:"14px 16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:14,color:"#64748b"}}>{cantSueltas}hs × ${PRECIO_HS.toLocaleString("es-AR")}</span>
              <span style={{fontWeight:800,fontSize:18,color:P}}>${precioSuelto.toLocaleString("es-AR")}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,color:"#64748b"}}>Precio por hora</span>
              <span style={{fontWeight:600,fontSize:13,color:"#374151"}}>${PRECIO_HS.toLocaleString("es-AR")}</span>
            </div>
          </div>

          {/* Sugerencia de pack si conviene */}
          {ahorroPack > 0 && (
            <button onClick={()=>setTab("packs")}
              style={{marginTop:12,width:"100%",background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:12,padding:"12px 14px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>💡</span>
              <div style={{flex:1}}>
                <p style={{margin:0,fontWeight:700,fontSize:13,color:"#15803d"}}>
                  Con un pack ahorrás ${ahorroPack.toLocaleString("es-AR")}
                </p>
                <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>Ver packs con descuento →</p>
              </div>
            </button>
          )}
        </Card>

        {/* Selector rápido */}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[1,2,3,5].map(n=>(
            <button key={n} onClick={()=>{setCantSueltas(n);setSel("sueltas");}}
              style={{background:cantSueltas===n&&sel==="sueltas"?P:PL,color:cantSueltas===n&&sel==="sueltas"?"#fff":P,
                border:`1.5px solid ${cantSueltas===n&&sel==="sueltas"?P:PB}`,
                borderRadius:99,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              {n}hs — ${(n*PRECIO_HS).toLocaleString("es-AR")}
            </button>
          ))}
        </div>
      </>)}

      <Btn disabled={!seleccion || pago==="procesando"}
        onClick={async ()=>{
          if (!seleccion) return;
          setPago("procesando");
          try {
            localStorage.setItem("pc_compra_pendiente", JSON.stringify({
              horas: seleccion.horas,
              precio: seleccion.precio,
            }));
            const { init_point } = await crearPreferencia(
              seleccion.horas,
              tab === "packs" ? sel : null,
            );
            window.location.href = init_point;
          } catch (err) {
            console.error("Error al crear preferencia MP:", err);
            setPago("idle");
            localStorage.removeItem("pc_compra_pendiente");
          }
        }}>
        {pago==="procesando" ? "Procesando pago…" : "Pagar con Mercado Pago →"}
      </Btn>
      <p style={{margin:0,fontSize:12,color:"#94a3b8",textAlign:"center"}}>Pago seguro · Tarjetas, débito y transferencia</p>

      {/* Comprobante de pago aprobado (simulado) */}
      {pago==="aprobado" && seleccion && (
        <div onClick={()=>{setPago("idle");setSel(null);}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:50}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,padding:"28px 22px",maxWidth:360,width:"100%",textAlign:"center",display:"flex",flexDirection:"column",gap:6}}>
            <div style={{width:64,height:64,borderRadius:"50%",background:"#dcfce7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 6px"}}>✓</div>
            <h3 style={{margin:0,color:DK,fontSize:19}}>¡Pago aprobado!</h3>
            <p style={{margin:0,fontSize:14,color:"#64748b"}}>Se acreditaron <strong style={{color:P}}>{seleccion.horas} horas</strong> a tu saldo.</p>
            <div style={{background:"#f8fafc",borderRadius:12,padding:14,margin:"10px 0",textAlign:"left",display:"flex",flexDirection:"column",gap:6,fontSize:13,color:"#374151"}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Detalle</span><strong>{seleccion.horas}hs{tab==="packs"?" (pack)":""}</strong></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Monto</span><strong>${seleccion.precio.toLocaleString("es-AR")}</strong></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Medio</span><strong>Mercado Pago</strong></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Vencen</span><strong>en {CFG.vencimientoDias} días</strong></div>
            </div>
            <Btn onClick={()=>{setPago("idle");setSel(null);}}>Listo</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PANTALLA PROFES ──────────────────────────────────────────────────────────
function Profes({ onReservar, profes }) {
  if (!profes) return <p style={{color:"#64748b",textAlign:"center",padding:20}}>Cargando...</p>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Nuestro profe</h3>
      {profes.map(p=>{
        const nombreProfe = p.nombre || "";
        const initiales = nombreProfe.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || "P";
        return (
          <Card key={p.id}>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
              <Av i={initiales} color={P} size={56}/>
              <div>
                <p style={{margin:0,fontWeight:800,fontSize:18,color:DK}}>{nombreProfe}</p>
                <p style={{margin:"4px 0 0",fontSize:13,color:"#64748b"}}>{p.bio||""}</p>
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Materias</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {(p.materias||[]).map(m=><Badge key={m} bg={PL} col={P}>{m}</Badge>)}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Modalidad</p>
              <div style={{display:"flex",gap:6}}>
                {(p.modalidad||p.modalidades||["Presencial","Virtual"]).map(m=><Badge key={m} bg="#f0f6fa" col={BL}>{m}</Badge>)}
              </div>
            </div>
            <Btn onClick={onReservar}>Reservar clase</Btn>
          </Card>
        );
      })}
    </div>
  );
}


// ── PANTALLA PERFIL ──────────────────────────────────────────────────────────
function Perfil({ onLogout, saldo, compras, datosAlumno, reservas }) {
  const [editando, setEditando] = useState(false);
  const [datos, setDatos] = useState({ nombre:"", mail:"", tel:"" });
  useEffect(() => {
    if (datosAlumno) setDatos({
      nombre: datosAlumno.profiles?.nombre || "",
      mail: datosAlumno.profiles?.mail || "",
      tel: datosAlumno.tel || ""
    });
  }, [datosAlumno]);
  const iniciales = (datosAlumno?.profiles?.nombre||"").split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || "?";
  const [borrador, setBorrador] = useState({nombre:"",mail:"",tel:""});
  const [guardado, setGuardado] = useState(false);
  const abrirEdicion = () => { setBorrador(datos); setEditando(true); };
  const guardarEdicion = async () => {
    await Promise.all([
      actualizarPerfil(datosAlumno.id, { nombre: borrador.nombre }),
      actualizarAlumno(datosAlumno.id, { tel: borrador.tel }),
    ]).catch(err => console.error("Error al guardar perfil:", err));
    setDatos(borrador);
    setEditando(false);
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2500);
  };
  const [notif, setNotif] = useState({ reserva:true, recordatorio:true, devolucion:true, promo:false });
  const [tab, setTab] = useState("progreso");

  const totalClases = (reservas||[]).length;
  const materiasUnicas = [...new Set((reservas||[]).map(r=>r.materia).filter(Boolean))];
  const EMOJI_MATERIA = { "Matemática":"📐","Física":"⚡","Química":"🧪","Álgebra":"📐","Biología":"🔬","Historia":"📜","Inglés":"🌍","Lengua":"📝" };
  const progresoReal = materiasUnicas.map(materia => {
    const cls = (reservas||[]).filter(r=>r.materia===materia);
    const ultimo = [...cls].reverse().find(r=>r.avance||r.devolucion);
    return { materia, clases:cls.length, avance: ultimo?.avance||ultimo?.devolucion||null };
  });

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Header perfil */}
      <Card style={{padding:20}}>
        {!editando ? (
        <>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
          <div style={{position:"relative"}}>
            <Av i={iniciales} size={64} color={DK}/>
            <button onClick={abrirEdicion} title="Editar perfil" style={{position:"absolute",bottom:0,right:0,width:22,height:22,borderRadius:"50%",background:P,border:"2px solid #fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,color:"#fff"}}>✎</button>
          </div>
          <div style={{flex:1}}>
            <p style={{margin:0,fontWeight:800,fontSize:18,color:DK}}>{datos.nombre}</p>
            <p style={{margin:"3px 0 0",fontSize:13,color:"#64748b"}}>{datosAlumno?.nivel||"—"}</p>
            <Badge bg={PL} col={P}>⏱ {saldo} hs disponibles</Badge>
          </div>
        </div>

        {guardado && (
          <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:13,color:"#166534",fontWeight:600}}>✓ Perfil actualizado</div>
        )}

        {/* Datos personales */}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[
            {icon:"✉️", label:"Email", val:datos.mail},
            {icon:"📱", label:"Teléfono", val:datos.tel},
          ].map(d=>(
            <div key={d.label} style={{display:"flex",alignItems:"center",gap:10,background:"#f8fafc",borderRadius:10,padding:"10px 14px"}}>
              <span style={{fontSize:18}}>{d.icon}</span>
              <div style={{flex:1}}>
                <p style={{margin:0,fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase"}}>{d.label}</p>
                <p style={{margin:"2px 0 0",fontSize:14,color:DK,fontWeight:500}}>{d.val}</p>
              </div>
              <button onClick={abrirEdicion} style={{background:"none",border:"none",color:P,fontSize:13,fontWeight:700,cursor:"pointer"}}>Editar</button>
            </div>
          ))}
        </div>
        </>
        ) : (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <p style={{margin:0,fontWeight:800,fontSize:16,color:DK}}>Editar perfil</p>
          {[
            {k:"nombre",label:"Nombre y apellido",type:"text"},
            {k:"mail",label:"Email",type:"email"},
            {k:"tel",label:"Teléfono",type:"tel"},
          ].map(f=>(
            <div key={f.k}>
              <label style={{display:"block",fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{f.label}</label>
              <input type={f.type} value={borrador[f.k]} onChange={e=>setBorrador(b=>({...b,[f.k]:e.target.value}))}
                style={{width:"100%",boxSizing:"border-box",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"11px 12px",fontSize:14,color:DK,outline:"none"}}/>
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <Btn variant="secondary" onClick={()=>setEditando(false)} style={{flex:1}}>Cancelar</Btn>
            <Btn onClick={guardarEdicion} disabled={!borrador.nombre.trim()||!borrador.mail.trim()} style={{flex:1}}>Guardar</Btn>
          </div>
        </div>
        )}
      </Card>

      {/* Tabs: Progreso / Compras */}
      <div style={{display:"flex",background:"#f1f5f9",borderRadius:12,padding:4,gap:4}}>
        {[{v:"progreso",l:"📈 Progreso"},{v:"compras",l:"🧾 Compras"},{v:"notif",l:"🔔 Avisos"}].map(t=>(
          <button key={t.v} onClick={()=>setTab(t.v)}
            style={{flex:1,background:tab===t.v?"#fff":"transparent",border:"none",borderRadius:10,padding:"9px 4px",fontSize:12,fontWeight:700,color:tab===t.v?P:"#64748b",cursor:"pointer",boxShadow:tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* TAB PROGRESO — para padres */}
      {tab==="progreso" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:`linear-gradient(135deg,${DK},#3d3d3d)`,borderRadius:14,padding:"14px 16px",color:"#fff"}}>
            <p style={{margin:"0 0 4px",fontSize:11,opacity:0.7,textTransform:"uppercase",letterSpacing:0.8}}>Resumen general</p>
            <div style={{display:"flex",gap:20}}>
              <div style={{textAlign:"center"}}>
                <p style={{margin:0,fontSize:26,fontWeight:800}}>{totalClases}</p>
                <p style={{margin:0,fontSize:11,opacity:0.7}}>Clases totales</p>
              </div>
              <div style={{textAlign:"center"}}>
                <p style={{margin:0,fontSize:26,fontWeight:800}}>{materiasUnicas.length}</p>
                <p style={{margin:0,fontSize:11,opacity:0.7}}>Materias</p>
              </div>
              <div style={{textAlign:"center"}}>
                <p style={{margin:0,fontSize:26,fontWeight:800,color:"#86efac"}}>↑</p>
                <p style={{margin:0,fontSize:11,opacity:0.7}}>Tendencia</p>
              </div>
            </div>
          </div>

          {progresoReal.length === 0 && (
            <p style={{color:"#94a3b8",textAlign:"center",fontSize:13}}>Todavía no hay clases registradas.</p>
          )}
          {progresoReal.map(p=>(
            <Card key={p.materia}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <span style={{fontSize:28}}>{EMOJI_MATERIA[p.materia]||"📖"}</span>
                <div style={{flex:1}}>
                  <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>{p.materia}</p>
                  <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{p.clases} clase{p.clases!==1?"s":""} realizadas</p>
                </div>
                <div style={{display:"flex",gap:1}}>
                  {Array(5).fill(null).map((_,i)=>(
                    <div key={i} style={{width:6,height:24,borderRadius:3,background:i<Math.min(Math.ceil(p.clases/1.5),5)?P:"#e2e8f0"}}/>
                  ))}
                </div>
              </div>
              {p.avance ? (
                <div style={{background:"#f0fdf4",borderRadius:10,padding:"10px 12px",border:"1px solid #bbf7d0"}}>
                  <p style={{margin:"0 0 3px",fontSize:11,fontWeight:700,color:"#166534",textTransform:"uppercase"}}>Devolución del profe</p>
                  <p style={{margin:0,fontSize:13,color:"#374151",lineHeight:1.5}}>{p.avance}</p>
                </div>
              ) : (
                <div style={{background:"#fefce8",borderRadius:10,padding:"10px 12px",border:"1px solid #fde68a"}}>
                  <p style={{margin:0,fontSize:13,color:"#92400e"}}>⏳ Sin devolución registrada aún.</p>
                </div>
              )}
            </Card>
          ))}

          <Card style={{background:"#fefce8",border:"1.5px solid #fde68a",padding:14}}>
            <p style={{margin:"0 0 4px",fontWeight:700,fontSize:13,color:"#92400e"}}>💡 Para padres</p>
            <p style={{margin:0,fontSize:13,color:"#78350f",lineHeight:1.5}}>Este resumen se actualiza después de cada clase. Si querés recibir un reporte semanal por mail, activalo en Avisos.</p>
          </Card>
        </div>
      )}

      {/* TAB COMPRAS */}
      {tab==="compras" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <p style={{margin:0,fontSize:13,color:"#64748b"}}>Total invertido</p>
            <p style={{margin:0,fontWeight:800,fontSize:18,color:DK}}>${(compras||[]).reduce((a,c)=>a+(c.precio||0),0).toLocaleString("es-AR")}</p>
          </div>
          {(compras||[]).map(c=>{
            const fechaISO = c.fecha || (c.creado_en||"").slice(0,10);
            return (
              <Card key={c.id} style={{padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{c.horas ? `${c.horas}hs` : "Compra"}</p>
                    <p style={{margin:"3px 0 0",fontSize:12,color:"#94a3b8"}}>{fechaISO ? fmt(fechaISO) : "-"} · {c.metodo||c.metodo_pago||"-"}</p>
                  </div>
                  <p style={{margin:0,fontWeight:800,fontSize:15,color:P}}>${(c.precio||0).toLocaleString("es-AR")}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* TAB NOTIFICACIONES */}
      {tab==="notif" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <p style={{margin:0,fontSize:13,color:"#64748b"}}>Elegí qué notificaciones querés recibir.</p>
          {[
            {k:"reserva",l:"Confirmación de reserva",d:"Cuando confirmás una clase"},
            {k:"recordatorio",l:"Recordatorio de clase",d:"24hs antes de cada clase"},
            {k:"devolucion",l:"Nueva devolución",d:"Cuando el profe carga el avance"},
            {k:"promo",l:"Promociones y descuentos",d:"Ofertas especiales de packs"},
          ].map(n=>(
            <Card key={n.k} style={{padding:14}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1}}>
                  <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{n.l}</p>
                  <p style={{margin:"2px 0 0",fontSize:12,color:"#94a3b8"}}>{n.d}</p>
                </div>
                <button onClick={()=>setNotif(prev=>({...prev,[n.k]:!prev[n.k]}))}
                  style={{width:44,height:24,borderRadius:99,background:notif[n.k]?P:"#e2e8f0",border:"none",cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
                  <div style={{position:"absolute",top:3,left:notif[n.k]?22:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Cerrar sesión */}
      <button onClick={onLogout} style={{background:"none",border:"1.5px solid #fecaca",borderRadius:12,padding:"13px",fontSize:14,fontWeight:700,color:"#dc2626",cursor:"pointer",marginTop:4,width:"100%"}}>
        Cerrar sesión
      </button>

    </div>
  );
}

// ── APP ──────────────────────────────────────────────────────────────────────

// ── PANTALLA CHAT ─────────────────────────────────────────────────────────────
function Chat({ reservas, userId }) {
  const [reservaSel, setReservaSel] = useState(null);
  const [mensajes, setMensajes] = useState({});
  const [texto, setTexto] = useState("");

  const fmtHora = iso => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
  const inisProfe = n => (n||"P").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();

  const proximas = (reservas||[]).filter(r => r.fecha >= HOY).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const historial = (reservas||[]).filter(r => r.fecha < HOY).sort((a,b)=>b.fecha.localeCompare(a.fecha));

  useEffect(() => {
    if (!reservaSel) return;
    getMensajes(reservaSel.id)
      .then(data => setMensajes(prev => ({...prev, [reservaSel.id]: data || []})))
      .catch(err => console.error("Error al cargar mensajes:", err));
  }, [reservaSel]);

  useEffect(() => {
    if (!reservaSel) return;
    let mounted = true;
    const canal = suscribirMensajes(reservaSel.id, msg => {
      if (mounted) setMensajes(prev => { const ya=prev[reservaSel.id]||[]; if(ya.some(m=>m.id===msg.id)) return prev; return {...prev,[reservaSel.id]:[...ya,msg]}; });
    });
    return () => { mounted = false; canal.unsubscribe(); };
  }, [reservaSel]);

  const enviar = () => {
    if (!texto.trim()) return;
    const t = texto.trim();
    setTexto("");
    enviarMensaje(reservaSel.id, "alumno", userId, t)
      .then(msg => { if(msg?.id) setMensajes(prev=>{ const ya=prev[reservaSel.id]||[]; if(ya.some(m=>m.id===msg.id)) return prev; return {...prev,[reservaSel.id]:[...ya,msg]}; }); })
      .catch(err => { console.error("Error al enviar mensaje:", err); setTexto(t); });
  };

  // Detectar si el mensaje intenta compartir contacto
  const esContacto = (t) => /(\d[\s.-]?){7,}|@|whatsapp|wa\.me|instagram|telegram|gmail|hotmail|yahoo/i.test(t);

  // ── VISTA DETALLE DE CHAT ──────────────────────────────────────────────────
  if (reservaSel) {
    const msgs = mensajes[reservaSel.id] || [];
    const nombreP = reservaSel.profes?.profiles?.nombre || "Profe";
    return (
      <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 140px)"}}>
        {/* Header del chat */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexShrink:0}}>
          <button onClick={()=>setReservaSel(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:P,padding:0}}>←</button>
          <Av i={inisProfe(nombreP)} color={P} size={38}/>
          <div style={{flex:1}}>
            <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>{nombreP}</p>
            <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{reservaSel.materia} · {fmt(reservaSel.fecha)} {reservaSel.hora}</p>
          </div>
          <Badge bg={reservaSel.modalidad==="Virtual"?"#f0f6fa":PL} col={reservaSel.modalidad==="Virtual"?BL:P}>
            {reservaSel.modalidad}
          </Badge>
        </div>

        {/* Aviso de privacidad */}
        <div style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:10,padding:"8px 12px",marginBottom:12,flexShrink:0}}>
          <p style={{margin:0,fontSize:11,color:"#92400e",textAlign:"center"}}>
            🔒 Este chat es solo para coordinar la clase. Los datos de contacto están deshabilitados.
          </p>
        </div>

        {/* Mensajes */}
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:10,paddingBottom:8}}>
          {msgs.length === 0 && (
            <div style={{textAlign:"center",padding:"40px 20px"}}>
              <p style={{margin:0,fontSize:14,color:"#94a3b8"}}>Aún no hay mensajes.<br/>Escribile a {nombreP.split(" ")[0]} sobre la clase.</p>
            </div>
          )}
          {msgs.map(m => {
            const esMio = m.emisor === "alumno";
            return (
              <div key={m.id} style={{display:"flex",justifyContent:esMio?"flex-end":"flex-start",gap:8,alignItems:"flex-end"}}>
                {!esMio && <Av i={inisProfe(nombreP)} color={P} size={28}/>}
                <div style={{maxWidth:"75%"}}>
                  <div style={{
                    background: esMio ? P : "#fff",
                    color: esMio ? "#fff" : DK,
                    borderRadius: esMio ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    padding:"10px 14px",
                    boxShadow:"0 1px 4px rgba(0,0,0,0.08)",
                    fontSize:14,
                    lineHeight:1.5,
                  }}>
                    {m.texto}
                  </div>
                  <p style={{margin:"3px 0 0",fontSize:10,color:"#94a3b8",textAlign:esMio?"right":"left"}}>{fmtHora(m.creado_en)}</p>
                </div>
                {esMio && <Av i="Yo" color={DK} size={28}/>}
              </div>
            );
          })}
        </div>

        {/* Input */}
        <div style={{flexShrink:0,paddingTop:12,borderTop:"1px solid #e2e8f0"}}>
          {esContacto(texto) && (
            <div style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:8,padding:"6px 12px",marginBottom:8}}>
              <p style={{margin:0,fontSize:12,color:"#dc2626"}}>⚠️ No podés compartir datos de contacto en el chat.</p>
            </div>
          )}
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea
              value={texto}
              onChange={e=>setTexto(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(!esContacto(texto))enviar();} }}
              placeholder="Escribí tu mensaje..."
              style={{flex:1,border:`2px solid ${texto?P+"44":"#e2e8f0"}`,borderRadius:12,padding:"10px 14px",fontSize:14,fontFamily:"inherit",resize:"none",outline:"none",minHeight:44,maxHeight:100,lineHeight:1.4,transition:"border 0.2s"}}
              rows={1}
            />
            <button
              onClick={()=>!esContacto(texto)&&enviar()}
              disabled={!texto.trim()||esContacto(texto)}
              style={{width:44,height:44,borderRadius:12,background:texto.trim()&&!esContacto(texto)?P:"#e2e8f0",border:"none",cursor:texto.trim()&&!esContacto(texto)?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,transition:"background 0.2s"}}>
              ➤
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── LISTA DE CONVERSACIONES ────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Mensajes</h3>
      <p style={{margin:0,fontSize:13,color:"#64748b"}}>Cada conversación está ligada a una clase reservada.</p>

      {/* Próximas clases con chat */}
      {proximas.length > 0 && (
        <div>
          <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>Clases próximas</p>
          {proximas.map(r => {
            const msgs = mensajes[r.id] || [];
            const ultimo = msgs[msgs.length-1];
            const sinLeer = msgs.filter(m=>m.emisor==="profe").length > 0;
            const nombreP = r.profes?.profiles?.nombre || "Profe";
            return (
              <button key={r.id} onClick={()=>setReservaSel(r)}
                style={{width:"100%",background:"#fff",border:`1.5px solid ${sinLeer?P:"#e2e8f0"}`,borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",marginBottom:10,boxShadow:sinLeer?"0 2px 12px rgba(217,79,61,0.15)":"0 2px 8px rgba(0,0,0,0.04)"}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{position:"relative"}}>
                    <Av i={inisProfe(nombreP)} color={P} size={44}/>
                    {sinLeer && <div style={{position:"absolute",top:0,right:0,width:12,height:12,borderRadius:"50%",background:P,border:"2px solid #fff"}}/>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                      <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{nombreP}</p>
                      {ultimo && <span style={{fontSize:11,color:"#94a3b8"}}>{fmtHora(ultimo.creado_en)}</span>}
                    </div>
                    <p style={{margin:0,fontSize:12,color:"#64748b",fontWeight:600}}>{r.materia} · {fmt(r.fecha)} {r.hora}</p>
                    {ultimo
                      ? <p style={{margin:"3px 0 0",fontSize:13,color:sinLeer?DK:"#94a3b8",fontWeight:sinLeer?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {ultimo.emisor==="alumno"?"Vos: ":""}{ultimo.texto}
                        </p>
                      : <p style={{margin:"3px 0 0",fontSize:13,color:"#94a3b8",fontStyle:"italic"}}>Iniciá la conversación →</p>
                    }
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Historial */}
      {historial.length > 0 && (
        <div>
          <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>Clases pasadas</p>
          {historial.map(r => {
            const msgs = mensajes[r.id] || [];
            const ultimo = msgs[msgs.length-1];
            const nombreP = r.profes?.profiles?.nombre || "Profe";
            return (
              <button key={r.id} onClick={()=>setReservaSel(r)}
                style={{width:"100%",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",marginBottom:10,opacity:0.85}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <Av i={inisProfe(nombreP)} color="#94a3b8" size={40}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <p style={{margin:0,fontWeight:700,fontSize:13,color:DK}}>{nombreP}</p>
                      {ultimo && <span style={{fontSize:11,color:"#94a3b8"}}>{fmtHora(ultimo.creado_en)}</span>}
                    </div>
                    <p style={{margin:0,fontSize:12,color:"#94a3b8"}}>{r.materia} · {fmt(r.fecha)}</p>
                    {ultimo && <p style={{margin:"3px 0 0",fontSize:12,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ultimo.texto}</p>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Aviso general */}
      <Card style={{background:"#f0f6fa",border:"1.5px solid #a8d4e8",padding:14}}>
        <p style={{margin:0,fontSize:13,color:BL,lineHeight:1.5}}>
          💬 Los mensajes son privados entre vos y tu profe, y están asociados a cada clase.<br/>
          <span style={{fontSize:12,opacity:0.8}}>No es posible compartir datos de contacto externos.</span>
        </p>
      </Card>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// MEJORAS: ONBOARDING + ALERTAS + COUNTDOWN + POLÍTICA CANCELACIÓN
// ════════════════════════════════════════════════════════════════════════════

// ── ONBOARDING (3 pasos) ──────────────────────────────────────────────────────
function Onboarding({ onTerminar }) {
  const [paso, setPaso] = useState(0);
  const pasos = [
    {
      icon:"🎉", titulo:"¡Bienvenido a PuntoClases!",
      desc:"Acá podés reservar clases de apoyo, gestionar tus horas y seguir tu progreso.",
      cta:"Siguiente →", color:P,
    },
    {
      icon:"💰", titulo:"Comprá un pack de horas",
      desc:`Tus horas se usan como saldo. Cada vez que reservás una clase, se descuenta automáticamente. Los packs tienen descuento y vencen a los ${CFG.vencimientoDias} días.`,
      cta:"Siguiente →", color:"#15803d",
    },
    {
      icon:"📅", titulo:"Reservá cuando quieras",
      desc:"Elegís materia, modalidad (presencial o virtual), el día y los horarios disponibles de tu profe. También podés escribirle por el chat de la clase.",
      cta:"¡Empezar!", color:BL,
    },
  ];
  const p = pasos[paso];

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"32px 24px 48px",width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:20}}>
        {/* Dots */}
        <div style={{display:"flex",justifyContent:"center",gap:8}}>
          {pasos.map((_,i)=>(
            <div key={i} style={{width:i===paso?24:8,height:8,borderRadius:99,background:i===paso?P:"#e2e8f0",transition:"all 0.3s"}}/>
          ))}
        </div>

        {/* Contenido */}
        <div style={{textAlign:"center",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{width:80,height:80,borderRadius:"50%",background:p.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40,margin:"0 auto"}}>
            {p.icon}
          </div>
          <h2 style={{margin:0,fontSize:22,fontWeight:800,color:DK}}>{p.titulo}</h2>
          <p style={{margin:0,fontSize:15,color:"#64748b",lineHeight:1.6}}>{p.desc}</p>
        </div>

        <button onClick={()=>{ if(paso<pasos.length-1) setPaso(paso+1); else onTerminar(); }}
          style={{background:p.color,color:"#fff",border:"none",borderRadius:14,padding:"16px",fontSize:16,fontWeight:800,cursor:"pointer",transition:"background 0.3s"}}>
          {p.cta}
        </button>

        {paso < pasos.length-1 && (
          <button onClick={onTerminar} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",textDecoration:"underline",padding:0,textAlign:"center"}}>
            Saltar introducción
          </button>
        )}
      </div>
    </div>
  );
}

// ── ALERTA DE VENCIMIENTO ─────────────────────────────────────────────────────
function AlertaVencimiento({ dias, saldo, onComprar }) {
  if (saldo === 0) return (
    <button onClick={onComprar} style={{background:PL,border:`1.5px solid ${PB}`,borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,width:"100%"}}>
      <span style={{fontSize:28}}>📦</span>
      <div style={{flex:1}}>
        <p style={{margin:0,fontWeight:700,fontSize:14,color:P}}>Sin horas disponibles</p>
        <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>Comprá un pack para seguir reservando clases.</p>
      </div>
      <span style={{fontSize:12,fontWeight:700,color:P,flexShrink:0}}>Ver packs →</span>
    </button>
  );

  if (dias <= 2) return (
    <button onClick={onComprar} style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,width:"100%"}}>
      <span style={{fontSize:28}}>🚨</span>
      <div style={{flex:1}}>
        <p style={{margin:0,fontWeight:700,fontSize:14,color:"#dc2626"}}>¡Tus horas vencen en {dias} día{dias!==1?"s":""}!</p>
        <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>Tenés {saldo}hs. Si no las usás, las perdés. Reservá ahora.</p>
      </div>
      <span style={{fontSize:12,fontWeight:700,color:"#dc2626",flexShrink:0}}>Reservar →</span>
    </button>
  );

  if (dias <= 7) return (
    <button onClick={onComprar} style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,width:"100%"}}>
      <span style={{fontSize:28}}>⏰</span>
      <div style={{flex:1}}>
        <p style={{margin:0,fontWeight:700,fontSize:14,color:"#92400e"}}>Tus horas vencen en {dias} días</p>
        <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>Todavía tenés {saldo}hs. Usálas antes de que venzan.</p>
      </div>
      <span style={{fontSize:12,fontWeight:700,color:"#92400e",flexShrink:0}}>Reservar →</span>
    </button>
  );

  return null; // más de 7 días, no molestamos
}

// ── COUNTDOWN PRÓXIMA CLASE ───────────────────────────────────────────────────
function CountdownClase({ clase, onChat }) {
  // Calculamos días hasta la clase (simulado)
  const fechaClase = new Date(+clase.fecha.slice(0,4), +clase.fecha.slice(5,7)-1, +clase.fecha.slice(8,10), +(clase.hora||"00:00").slice(0,2), +(clase.hora||"00:00").slice(3,5));
  const ahora = new Date();
  const diff = fechaClase - ahora;
  const dias = Math.floor(diff / (1000*60*60*24));
  const horas = Math.floor((diff % (1000*60*60*24)) / (1000*60*60));
  const mins = Math.floor((diff % (1000*60*60)) / (1000*60));

  const esVirtual = clase.modalidad === "Virtual";
  const esMañana = dias === 0;
  const esHoy = dias < 0;

  return (
    <div style={{background: esHoy ? `linear-gradient(135deg,${P},#b83c2c)` : esMañana ? `linear-gradient(135deg,#15803d,#16a34a)` : `linear-gradient(135deg,${DK},#3d3d3d)`,borderRadius:16,padding:"16px",color:"#fff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <p style={{margin:0,fontSize:11,opacity:0.6,textTransform:"uppercase",letterSpacing:0.8}}>
            {esHoy?"🔴 CLASE AHORA":"Próxima clase"}
          </p>
          <p style={{margin:"4px 0 0",fontWeight:800,fontSize:16}}>{clase.materia} con {clase.profes?.profiles?.nombre?.split(" ")[0] || "el profe"}</p>
          <p style={{margin:"2px 0 0",fontSize:12,opacity:0.7}}>{fmt(clase.fecha)} · {clase.hora} · {clase.modalidad}</p>
        </div>
        <div style={{textAlign:"center",background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"10px 12px",flexShrink:0}}>
          {dias >= 1 ? (<>
            <p style={{margin:0,fontSize:22,fontWeight:800}}>{dias}d {horas}h</p>
            <p style={{margin:0,fontSize:10,opacity:0.7}}>para la clase</p>
          </>) : (<>
            <p style={{margin:0,fontSize:22,fontWeight:800}}>{horas}h {mins}m</p>
            <p style={{margin:0,fontSize:10,opacity:0.7}}>para la clase</p>
          </>)}
        </div>
      </div>

      {/* Recordatorios */}
      <div style={{display:"flex",gap:8}}>
        {esVirtual && (
          <div style={{flex:1,background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>🖥️</span>
            <div>
              <p style={{margin:0,fontSize:11,fontWeight:700}}>Clase virtual</p>
              <p style={{margin:0,fontSize:10,opacity:0.7}}>Link en el chat</p>
            </div>
          </div>
        )}
        {!esVirtual && (
          <div style={{flex:1,background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>📍</span>
            <div>
              <p style={{margin:0,fontSize:11,fontWeight:700}}>Presencial</p>
              <p style={{margin:0,fontSize:10,opacity:0.7}}>Bendito Pedro · Córdoba 2429</p>
            </div>
          </div>
        )}
        <button onClick={onChat} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:10,padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,color:"#fff",fontWeight:700,fontSize:12}}>
          <span>💬</span> Chat
        </button>
      </div>
    </div>
  );
}

// ── MODAL POLÍTICA DE CANCELACIÓN ────────────────────────────────────────────
function ModalCancelacion({ onAceptar, onCerrar }) {
  const [leido, setLeido] = useState(false);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{margin:0,color:DK,fontSize:18}}>📋 Política de cancelación</h3>
          <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[
            {icon:"✅",bg:"#f0fdf4",col:"#15803d",titulo:"Cancelación con +24hs de anticipación",desc:"Podés reprogramar sin costo. La hora vuelve a tu saldo."},
            {icon:"⚠️",bg:"#fefce8",col:"#92400e",titulo:"Cancelación con menos de 24hs",desc:`Se retiene el ${CFG.penalizacionPct}% de la hora como seña. El profe cobra igual.`},
            {icon:"🚫",bg:"#fff5f5",col:"#dc2626",titulo:"No presentarse sin avisar",desc:"Se descuenta la hora completa. El profe cobra el 100%."},
            {icon:"🔄",bg:"#f0f6fa",col:BL,titulo:"Reprogramación",desc:"Podés cambiar el horario con +24hs. Sin costo adicional."},
          ].map(r=>(
            <div key={r.titulo} style={{background:r.bg,borderRadius:12,padding:"12px 14px",display:"flex",gap:12,alignItems:"flex-start"}}>
              <span style={{fontSize:22,flexShrink:0}}>{r.icon}</span>
              <div>
                <p style={{margin:0,fontWeight:700,fontSize:13,color:r.col}}>{r.titulo}</p>
                <p style={{margin:"3px 0 0",fontSize:12,color:"#374151"}}>{r.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button onClick={()=>setLeido(!leido)} style={{display:"flex",alignItems:"center",gap:10,background:"none",border:"none",cursor:"pointer",padding:0,textAlign:"left"}}>
          <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${leido?P:"#e2e8f0"}`,background:leido?P:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}}>
            {leido && <span style={{color:"#fff",fontSize:13,fontWeight:800}}>✓</span>}
          </div>
          <span style={{fontSize:13,color:"#374151"}}>Entendí la política de cancelación</span>
        </button>

        <button onClick={onAceptar} disabled={!leido}
          style={{background:leido?P:"#e2e8f0",color:leido?"#fff":"#94a3b8",border:"none",borderRadius:12,padding:"15px",fontSize:15,fontWeight:700,cursor:leido?"pointer":"not-allowed",transition:"all 0.2s"}}>
          Continuar con la reserva →
        </button>
      </div>
    </div>
  );
}

function AppAlumno({ user, onLogout }) {
  const [screen,setScreen] = useState("inicio");
  const [onboardingVisto,setOnboardingVisto] = useState(() => !!localStorage.getItem("pc_onboarding_visto"));
  const [saldo,setSaldo] = useState(0);

  const [datosAlumno, setDatosAlumno] = useState(null);
  useEffect(() => {
    if (!user) return;
    getAlumno(user.id)
      .then((d) => { setDatosAlumno(d); setSaldo(d.saldo); })
      .catch((err) => console.error("Error al cargar alumno:", err));
  }, [user]);
  const nombreAlumno = datosAlumno?.profiles?.nombre || "";

  const [reservasAlumno, setReservasAlumno] = useState(null);
  useEffect(() => {
    if (!user) return;
    getReservasAlumno(user.id)
      .then((r) => { console.log("RESERVAS DEL ALUMNO:", r); setReservasAlumno(r); })
      .catch((err) => console.error("Error al cargar reservas:", err));
  }, [user]);

  const [comprasAlumno, setComprasAlumno] = useState(null);
  useEffect(() => {
    if (!user) return;
    getCompras(user.id)
      .then((c) => { console.log("COMPRAS DEL ALUMNO:", c); setComprasAlumno(c); })
      .catch((err) => console.error("Error al cargar compras:", err));
  }, [user]);

  const [profesData, setProfesData] = useState(null);
  useEffect(() => {
    getProfes()
      .then(data => setProfesData(data))
      .catch(err => console.error("Error al cargar profes:", err));
  }, []);

  const [cfgLive, setCfgLive] = useState(null);
  const [packsLive, setPacksLive] = useState(null);
  useEffect(() => {
    getConfig()
      .then(row => setCfgLive(normCfg(row)))
      .catch(() => {});
    getPacks()
      .then(data => setPacksLive(data || []))
      .catch(() => {});
  }, []);

  const [compraAprobada, setCompraAprobada] = useState(null);
  useEffect(() => {
    if (!user || !datosAlumno) return;
    const params = new URLSearchParams(window.location.search);
    const collectionStatus = params.get("collection_status");
    const paymentId = params.get("payment_id") || params.get("collection_id") || null;
    if (!collectionStatus) return;
    const raw = localStorage.getItem("pc_compra_pendiente");
    const { horas, precio } = raw ? JSON.parse(raw) : {};
    localStorage.removeItem("pc_compra_pendiente");
    window.history.replaceState({}, "", window.location.pathname);

    if (collectionStatus === "approved") {
      // El webhook acredita las horas — acá solo mostramos confirmación y refrescamos saldo
      setCompraAprobada({ horas, precio });
      setTimeout(() => {
        getAlumno(user.id).then(d => { if (d?.saldo !== undefined) setSaldo(d.saldo); }).catch(() => {});
        getCompras(user.id).then(c => setComprasAlumno(c)).catch(() => {});
      }, 5000);
    } else {
      const estadoPago = collectionStatus === "pending" ? "pendiente" : "fallido";
      if (horas && precio) {
        crearCompra(user.id, horas, precio, null, estadoPago, paymentId)
          .catch(err => console.error("Error al registrar compra " + estadoPago + ":", err));
      }
    }
  }, [user, datosAlumno]);

  const nav = [
    {id:"inicio",icon:"🏠",label:"Inicio"},
    {id:"reservar",icon:"📅",label:"Reservar"},
    {id:"historial",icon:"📚",label:"Clases"},
    {id:"mensajes",icon:"💬",label:"Mensajes"},
    {id:"perfil",icon:"👤",label:"Perfil"},
  ];
  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto",position:"relative"}}>
      {!onboardingVisto && <Onboarding onTerminar={()=>{ localStorage.setItem("pc_onboarding_visto","1"); setOnboardingVisto(true); }}/>}
      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Logo size={32}/>
          <span style={{fontWeight:800,fontSize:17,color:DK,letterSpacing:-0.5}}>PuntoClases</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{
            background:diasVenc(datosAlumno?.vencimiento)<=2?"#fff5f5":diasVenc(datosAlumno?.vencimiento)<=7?"#fefce8":PL,
            border:`1.5px solid ${diasVenc(datosAlumno?.vencimiento)<=2?"#fecaca":diasVenc(datosAlumno?.vencimiento)<=7?"#fde68a":PB}`,
            borderRadius:99,padding:"4px 12px",fontSize:13,fontWeight:700,
            color:diasVenc(datosAlumno?.vencimiento)<=2?"#dc2626":diasVenc(datosAlumno?.vencimiento)<=7?"#92400e":P}}>
            {diasVenc(datosAlumno?.vencimiento)<=2?"🚨":diasVenc(datosAlumno?.vencimiento)<=7?"⏰":"⏱"} {saldo} hs
          </div>
          <div onClick={()=>setScreen("perfil")} style={{cursor:"pointer"}}><Av i={(nombreAlumno||"").split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase()||"?"} size={32} color={DK}/></div>
        </div>
      </div>

      {/* Contenido */}
      <div style={{flex:1,padding:"16px 16px 80px"}}>
        {screen==="inicio" && <Inicio onNav={setScreen} saldo={saldo} nombre={nombreAlumno} reservas={reservasAlumno} vencimiento={datosAlumno?.vencimiento}/>}
        {screen==="reservar" && <Reservar profes={profesData} saldo={saldo} alumnoId={user?.id} onReservar={(costo)=>{setSaldo(s=>+(s-costo).toFixed(2));getReservasAlumno(user.id).then(r=>setReservasAlumno(r)).catch(()=>{});}}/>}
        {screen==="historial" && (
          <Historial
            reservas={reservasAlumno}
            alumnoId={user?.id}
            cfg={cfgLive}
            onReprogramar={(id, nuevaFecha, nuevaHora) => {
              setReservasAlumno(prev => (prev||[]).map(r =>
                r.id===id ? {...r, fecha:nuevaFecha, hora:nuevaHora, estado:"confirmada"} : r
              ));
            }}
            onCancelar={(id, saldoNuevo) => {
              setReservasAlumno(prev => (prev||[]).map(r =>
                r.id===id ? {...r, estado:"cancelada"} : r
              ));
              setSaldo(saldoNuevo);
            }}
          />
        )}
        {screen==="comprar" && <Comprar compras={comprasAlumno} cfg={cfgLive} packsDB={packsLive} onComprar={(hs)=>setSaldo(s=>+(s+hs).toFixed(2))}/>}
        {screen==="profes" && <Profes profes={profesData} onReservar={()=>setScreen("reservar")}/>}
        {screen==="perfil" && <Perfil datosAlumno={datosAlumno} reservas={reservasAlumno} compras={comprasAlumno} onLogout={onLogout} saldo={saldo}/>}
        {screen==="mensajes" && <Chat reservas={reservasAlumno} userId={user?.id}/>}
      </div>

      {/* Modal pago aprobado */}
      {compraAprobada && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#fff",borderRadius:20,padding:"28px 22px",maxWidth:360,width:"100%",textAlign:"center",display:"flex",flexDirection:"column",gap:14,alignItems:"center"}}>
            <div style={{width:64,height:64,borderRadius:"50%",background:"#dcfce7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34}}>✓</div>
            <h3 style={{margin:0,color:DK,fontSize:19}}>¡Pago recibido!</h3>
            <p style={{margin:0,fontSize:14,color:"#64748b"}}>
              {compraAprobada.horas
                ? <>Se acreditarán <strong style={{color:P}}>{compraAprobada.horas} horas</strong> a tu saldo en segundos.</>
                : "Tu pago fue procesado. Las horas se acreditarán en segundos."}
            </p>
            {compraAprobada.horas && compraAprobada.precio && (
              <div style={{background:"#f8fafc",borderRadius:12,padding:14,width:"100%",textAlign:"left",display:"flex",flexDirection:"column",gap:6,fontSize:13,color:"#374151"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}><span>Horas</span><strong>{compraAprobada.horas}hs</strong></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span>Monto</span><strong>${compraAprobada.precio.toLocaleString("es-AR")}</strong></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span>Medio</span><strong>Mercado Pago</strong></div>
              </div>
            )}
            <Btn onClick={()=>setCompraAprobada(null)}>Listo</Btn>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid #e2e8f0",display:"flex",padding:"8px 0 12px",zIndex:10}}>
        {nav.map(n=>(
          <button key={n.id} onClick={()=>setScreen(n.id)}
            style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>{n.icon}</span>
            <span style={{fontSize:10,fontWeight:screen===n.id?700:400,color:screen===n.id?P:"#94a3b8"}}>{n.label}</span>
            {screen===n.id && <div style={{width:4,height:4,borderRadius:"50%",background:P}}/>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL DEL PROFE — app separada que monta sobre el mismo archivo
// ════════════════════════════════════════════════════════════════════════════

const HORAS_DIA = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"];

// ── SUBPANTALLAS DEL PROFE ───────────────────────────────────────────────────

// Pantalla reservas del profe
function ProfeReservas({ reservas, onDevolucion }) {
  const [tab, setTab] = useState("proximas");
  const [abierto, setAbierto] = useState(null);
  const hoy = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; })();
  const proximas = reservas.filter(r => r.fecha >= hoy).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const pasadas = reservas.filter(r => r.fecha < hoy).sort((a,b)=>b.fecha.localeCompare(a.fecha));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Mis reservas</h3>
      <div style={{display:"flex",background:"#f1f5f9",borderRadius:12,padding:4,gap:4}}>
        {[{v:"proximas",l:"Próximas"},{v:"pasadas",l:"Historial"}].map(t=>(
          <button key={t.v} onClick={()=>setTab(t.v)}
            style={{flex:1,background:tab===t.v?"#fff":"transparent",border:"none",borderRadius:10,padding:"10px",fontSize:14,fontWeight:700,color:tab===t.v?P:"#64748b",cursor:"pointer",boxShadow:tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {(tab==="proximas"?proximas:pasadas).map(r=>(
        <Card key={r.id} style={{cursor:"pointer"}}>
          <div onClick={()=>setAbierto(abierto===r.id?null:r.id)} style={{display:"flex",alignItems:"center",gap:12}}>
            <Av i={(r.alumno||"").split(" ").map(n=>n[0]).join("").slice(0,2)} color={P} size={38}/>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.materia} — {r.alumno}</p>
              <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{fmt(r.fecha)} · {r.hora} · {r.modalidad}</p>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
              <Badge bg={r.tipo==="grupal"?"#f0f6fa":PL} col={r.tipo==="grupal"?BL:P}>{r.tipo}</Badge>
              {tab==="pasadas" && !r.devolucion && <Badge bg="#fefce8" col="#92400e">⚠️ sin dev.</Badge>}
              {tab==="pasadas" && r.devolucion && <Badge bg="#dcfce7" col="#15803d">✓ completa</Badge>}
            </div>
          </div>

          {abierto===r.id && (
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>
              {r.necesidad && (
                <div style={{background:"#f8fafc",borderRadius:10,padding:12}}>
                  <p style={{margin:"0 0 4px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>El alumno necesita</p>
                  <p style={{margin:0,fontSize:13,color:"#374151"}}>{r.necesidad}</p>
                </div>
              )}
              {tab==="pasadas" && (
                r.devolucion ? (
                  <div style={{background:"#f0fdf4",borderRadius:10,padding:12,border:"1px solid #bbf7d0"}}>
                    <p style={{margin:"0 0 4px",fontSize:11,fontWeight:700,color:"#166534",textTransform:"uppercase"}}>Tu devolución</p>
                    <p style={{margin:0,fontSize:13,color:"#374151"}}>{r.devolucion}</p>
                  </div>
                ) : (
                  <Btn onClick={()=>onDevolucion(r)}>✍️ Cargar devolución</Btn>
                )
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}


// Pantalla disponibilidad del profe
function ProfeDisponibilidad({ dispon, setDispon }) {
  const [fechaSel, setFechaSel] = useState(null);
  const [mes, setMes] = useState(new Date().getMonth());
  const year = new Date().getFullYear();
  const TIPOS = ["individual","grupal","ambas"];
  const TIPO_COLOR = { individual:{bg:PL,col:P}, grupal:{bg:"#f0f6fa",col:BL}, ambas:{bg:"#f0fdf4",col:"#15803d"} };

  const toggleBloque = (h) => {
    setDispon(prev => {
      const diaActual = prev[fechaSel] || {};
      if (diaActual[h]) {
        // Ciclar entre individual -> grupal -> ambas -> eliminar
        const ciclo = {individual:"grupal",grupal:"ambas",ambas:null};
        const siguiente = ciclo[diaActual[h]];
        const nuevo = {...diaActual};
        if (siguiente) nuevo[h] = siguiente;
        else delete nuevo[h];
        return {...prev, [fechaSel]:nuevo};
      } else {
        return {...prev, [fechaSel]:{...diaActual,[h]:"individual"}};
      }
    });
  };

  const bloquesHoy = fechaSel ? (dispon[fechaSel]||{}) : {};
  const diasConDispon = Object.keys(dispon);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div>
        <h3 style={{margin:"0 0 4px",color:DK}}>Mi disponibilidad</h3>
        <p style={{margin:0,fontSize:13,color:"#64748b"}}>Tocá un día para editar sus horarios</p>
      </div>

      {/* Leyenda */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[
          {t:"individual",l:"Solo individual",bg:PL,col:P},
          {t:"grupal",l:"Solo grupal",bg:"#f0f6fa",col:BL},
          {t:"ambas",l:"Ambas",bg:"#f0fdf4",col:"#15803d"},
        ].map(x=>(
          <span key={x.t} style={{background:x.bg,color:x.col,borderRadius:99,padding:"4px 12px",fontSize:11,fontWeight:700}}>
            {x.l}
          </span>
        ))}
      </div>

      {/* Calendario */}
      <Card style={{padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={()=>setMes(m=>Math.max(m-1,0))} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:P}}>‹</button>
          <span style={{fontWeight:700,fontSize:15,color:DK}}>{MESES[mes]} {year}</span>
          <button onClick={()=>setMes(m=>Math.min(m+1,11))} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:P}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,textAlign:"center"}}>
          {DIAS.map(d=><div key={d} style={{fontSize:11,color:"#94a3b8",fontWeight:600,paddingBottom:4}}>{d}</div>)}
          {Array(primerDia(year,mes)).fill(null).map((_,i)=><div key={`e${i}`}/>)}
          {Array(diasEnMes(year,mes)).fill(null).map((_,i)=>{
            const d=i+1, iso=toISO(year,mes,d);
            const tieneDispon = !!dispon[iso] && Object.keys(dispon[iso]).length>0;
            const sel = fechaSel===iso;
            return (
              <button key={d} onClick={()=>setFechaSel(sel?null:iso)}
                style={{aspectRatio:"1",borderRadius:8,border:sel?`2px solid ${P}`:"none",
                  background:sel?P:tieneDispon?"#dcfce7":"transparent",
                  color:sel?"#fff":tieneDispon?"#15803d":"#374151",
                  fontSize:12,fontWeight:tieneDispon?700:400,cursor:"pointer",position:"relative"}}>
                {d}
                {tieneDispon && !sel && <div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:"#15803d"}}/>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Editor de bloques del día */}
      {fechaSel && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>{fmt(fechaSel)}</p>
            <button onClick={()=>{setDispon(prev=>{const n={...prev};delete n[fechaSel];return n;});}}
              style={{background:"none",border:"1.5px solid #fecaca",borderRadius:8,padding:"4px 12px",fontSize:12,color:"#dc2626",cursor:"pointer",fontWeight:600}}>
              Limpiar día
            </button>
          </div>
          <p style={{margin:0,fontSize:12,color:"#64748b"}}>Tocá para agregar · Volvé a tocar para cambiar tipo · Una vez más para quitar</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {HORAS_DIA.map(h=>{
              const tipo = bloquesHoy[h];
              const colors = tipo ? TIPO_COLOR[tipo] : {bg:"#f8fafc",col:"#94a3b8"};
              return (
                <button key={h} onClick={()=>toggleBloque(h)}
                  style={{padding:"14px 0",borderRadius:12,border:`2px solid ${tipo?colors.col+"44":"#e2e8f0"}`,
                    background:colors.bg,color:colors.col,
                    fontWeight:tipo?700:400,fontSize:13,cursor:"pointer",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all 0.15s"}}>
                  <span style={{fontSize:16}}>{tipo==="individual"?"👤":tipo==="grupal"?"👥":tipo==="ambas"?"✦":"+"}</span>
                  {h}
                  {tipo && <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",opacity:0.8}}>{tipo}</span>}
                </button>
              );
            })}
          </div>

          <Card style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",padding:12}}>
            <p style={{margin:0,fontSize:13,color:"#166534"}}>
              <strong>{Object.keys(bloquesHoy).length} bloques</strong> cargados para este día ·{" "}
              {Object.values(bloquesHoy).filter(t=>t==="individual"||t==="ambas").length} individuales ·{" "}
              {Object.values(bloquesHoy).filter(t=>t==="grupal"||t==="ambas").length} grupales
            </p>
          </Card>
        </div>
      )}

      {!fechaSel && (
        <Card style={{padding:14,textAlign:"center"}}>
          <p style={{margin:0,fontSize:13,color:"#94a3b8"}}>Seleccioná un día en el calendario para editar sus horarios disponibles</p>
        </Card>
      )}
    </div>
  );
}


// ── APP PROFE ─────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════
// PANEL DEL PROFE
// ════════════════════════════════════════════════════════════════════
// ─── COPIA STANDALONE DEL PANEL DEL PROFE ───────────────────────────────────



// Tarifas — ver constantes en panel admin


const initialsProfe = nombre => (nombre||"?").split(" ").map(n=>n[0]).join("").slice(0,2);
const HOY = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; })();

// ── PANTALLA INICIO ──────────────────────────────────────────────────────────
function ProfeInicioPanel({ onNav, reservas, profeNombre }) {
  const hoyR = reservas.filter(r=>r.fecha===HOY);
  const proximas = reservas.filter(r=>r.fecha>=HOY).length;
  const sinDevol = reservas.filter(r=>r.fecha<HOY&&!r.devolucion);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:`linear-gradient(135deg,${DK},#444)`,borderRadius:20,padding:"22px 20px",color:"#fff",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:100,height:100,borderRadius:"50%",background:"rgba(217,79,61,0.2)"}}/>
        <p style={{margin:0,fontSize:12,opacity:0.6,textTransform:"uppercase",letterSpacing:1}}>Panel del profe</p>
        <h2 style={{margin:"4px 0 16px",fontSize:21,fontWeight:800}}>{profeNombre||"—"} 👨‍🏫</h2>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          {[
            {n:hoyR.length,l:"Hoy",alert:false},
            {n:proximas,l:"Próximas",alert:false},
            {n:sinDevol.length,l:"Sin devolución",alert:sinDevol.length>0},
          ].map(s=>(
            <div key={s.l} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 0",textAlign:"center"}}>
              <p style={{margin:0,fontSize:24,fontWeight:800,color:s.alert?"#fbbf24":"#fff"}}>{s.n}</p>
              <p style={{margin:0,fontSize:11,opacity:0.7,lineHeight:1.3}}>{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {sinDevol.length>0 && (
        <button onClick={()=>onNav("reservas")} style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:28}}>⚠️</span>
          <div>
            <p style={{margin:0,fontWeight:700,fontSize:14,color:"#92400e"}}>{sinDevol.length} clase{sinDevol.length>1?"s":""} sin devolución</p>
            <p style={{margin:"2px 0 0",fontSize:12,color:"#a16207"}}>Los alumnos esperan tu feedback.</p>
          </div>
        </button>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {[
          {icon:"📋",label:"Mis reservas",sc:"reservas",bg:"#fdecea",border:PB},
          {icon:"🗓️",label:"Mi disponibilidad",sc:"disponibilidad",bg:"#f0f6fa",border:"#a8d4e8"},
          {icon:"✍️",label:"Cargar devolución",sc:"reservas",bg:"#f0fdf4",border:"#bbf7d0"},
          {icon:"👥",label:"Mis alumnos",sc:"alumnos",bg:"#fefce8",border:"#fde68a"},
        ].map(a=>(
          <button key={a.label} onClick={()=>onNav(a.sc)} style={{background:a.bg,border:`1.5px solid ${a.border}`,borderRadius:14,padding:"16px 12px",cursor:"pointer",textAlign:"left",display:"flex",flexDirection:"column",gap:6}}>
            <span style={{fontSize:24}}>{a.icon}</span>
            <span style={{fontSize:13,fontWeight:600,color:DK}}>{a.label}</span>
          </button>
        ))}
      </div>

      {hoyR.length>0 && (
        <div>
          <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>Clases de hoy</p>
          {hoyR.map(r=>(
            <Card key={r.id} style={{marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <Av i={initialsProfe(r.alumno)} color={P}/>
                <div style={{flex:1}}>
                  <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.materia} — {r.alumno}</p>
                  <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{r.hora} · {r.modalidad}</p>
                </div>
                <Badge bg={r.tipo==="grupal"?"#f0f6fa":PL} col={r.tipo==="grupal"?BL:P}>
                  {r.tipo==="grupal"?"👥 Grupal":"👤 Indiv."}
                </Badge>
              </div>
              {r.necesidad && (
                <div style={{marginTop:10,background:"#f8fafc",borderRadius:8,padding:"8px 12px"}}>
                  <p style={{margin:0,fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>El alumno necesita</p>
                  <p style={{margin:"3px 0 0",fontSize:13,color:"#374151"}}>{r.necesidad}</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PANTALLA RESERVAS ────────────────────────────────────────────────────────
function Reservas({ reservas, onDevolucion, onMarcar, onAusente, onReprogramar }) {
  const [tab,setTab] = useState("proximas");
  const [abierto,setAbierto] = useState(null);
  const proximas = reservas.filter(r=>r.fecha>=HOY).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const pasadas = reservas.filter(r=>r.fecha<HOY).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const lista = tab==="proximas" ? proximas : pasadas;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Mis reservas</h3>
      <div style={{display:"flex",background:"#f1f5f9",borderRadius:12,padding:4,gap:4}}>
        {[{v:"proximas",l:`Próximas (${proximas.length})`},{v:"pasadas",l:`Historial (${pasadas.length})`}].map(t=>(
          <button key={t.v} onClick={()=>setTab(t.v)}
            style={{flex:1,background:tab===t.v?"#fff":"transparent",border:"none",borderRadius:10,padding:"10px",fontSize:13,fontWeight:700,color:tab===t.v?P:"#64748b",cursor:"pointer",boxShadow:tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {lista.map(r=>(
        <Card key={r.id} style={{cursor:"pointer"}}>
          <div onClick={()=>setAbierto(abierto===r.id?null:r.id)} style={{display:"flex",alignItems:"center",gap:12}}>
            <Av i={initialsProfe(r.alumno)} color={P} size={38}/>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.materia} — {r.alumno}</p>
              <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{fmt(r.fecha)} · {r.hora} · {r.modalidad}</p>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
              <Badge bg={r.tipo==="grupal"?"#f0f6fa":PL} col={r.tipo==="grupal"?BL:P}>{r.tipo==="grupal"?"👥":"👤"}</Badge>
              {tab==="pasadas" && !r.devolucion && <Badge bg="#fefce8" col="#92400e">⚠️ pendiente</Badge>}
              {tab==="pasadas" && r.devolucion && <Badge bg="#dcfce7" col="#15803d">✓ ok</Badge>}
            </div>
          </div>

          {abierto===r.id && (
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>
              {r.necesidad && (
                <div style={{background:"#f8fafc",borderRadius:10,padding:12}}>
                  <p style={{margin:"0 0 4px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>El alumno necesita</p>
                  <p style={{margin:0,fontSize:13,color:"#374151"}}>{r.necesidad}</p>
                </div>
              )}
              {tab==="proximas" && !r.realizada && !r.alumnoAusente && (
                <>
                  {r.fecha<=HOY && (
                    <div style={{display:"flex",gap:8,marginTop:8}}>
                      <Btn onClick={()=>onMarcar(r)} style={{flex:2}}>✅ Clase realizada</Btn>
                      <Btn onClick={()=>onAusente(r)} variant="danger" style={{flex:1}}>👤 Ausente</Btn>
                    </div>
                  )}
                  <button onClick={()=>onReprogramar(r)}
                    style={{marginTop:8,width:"100%",background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:10,padding:"10px",fontSize:13,fontWeight:700,cursor:"pointer",color:"#92400e"}}>
                    🔄 Cancelar / Reprogramar clase
                  </button>
                </>
              )}
              {tab==="proximas" && r.alumnoAusente && (
                <div style={{marginTop:8,background:"#fff5f5",borderRadius:8,padding:"8px 12px",border:"1px solid #fecaca"}}>
                  <p style={{margin:0,fontSize:12,color:"#dc2626"}}>👤 Alumno ausente · {r.marcadaEn}</p>
                </div>
              )}
              {tab==="proximas" && r.realizada && (
                <div style={{marginTop:8,background:"#f0fdf4",borderRadius:8,padding:"8px 12px",border:"1px solid #bbf7d0"}}>
                  <p style={{margin:0,fontSize:12,color:"#15803d"}}>✓ Clase realizada · {r.marcadaEn}</p>
                </div>
              )}
              {tab==="pasadas" && (
                r.devolucion ? (
                  <div style={{background:"#f0fdf4",borderRadius:10,padding:12,border:"1px solid #bbf7d0"}}>
                    <p style={{margin:"0 0 4px",fontSize:11,fontWeight:700,color:"#166534",textTransform:"uppercase"}}>Tu devolución</p>
                    <p style={{margin:0,fontSize:13,color:"#374151"}}>{r.devolucion}</p>
                  </div>
                ) : (
                  <Btn onClick={()=>onDevolucion(r)}>✍️ Cargar devolución</Btn>
                )
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── MODAL DEVOLUCIÓN ─────────────────────────────────────────────────────────
function ModalDevolucion({ reserva, onGuardar, onCerrar }) {
  const [texto,setTexto] = useState("");
  const [avance,setAvance] = useState("");

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{margin:0,color:DK}}>Cargar devolución</h3>
          <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>
        <Card style={{background:"#f8fafc",padding:12}}>
          <p style={{margin:0,fontSize:13,color:"#374151"}}>
            <strong>{reserva.materia}</strong> — {reserva.alumno}<br/>
            <span style={{color:"#64748b"}}>{fmt(reserva.fecha)} · {reserva.hora}</span>
          </p>
        </Card>
        <div>
          <p style={{margin:"0 0 6px",fontWeight:600,fontSize:14,color:DK}}>¿Qué trabajaron?</p>
          <textarea value={texto} onChange={e=>setTexto(e.target.value)}
            placeholder="Ej: Trabajamos funciones cuadráticas, método de factorización. El alumno mejoró notablemente..."
            style={{width:"100%",minHeight:100,borderRadius:10,border:`2px solid ${texto?P:"#e2e8f0"}`,padding:12,fontSize:14,fontFamily:"inherit",resize:"none",boxSizing:"border-box",outline:"none",transition:"border 0.2s"}}/>
        </div>
        <div>
          <p style={{margin:"0 0 8px",fontWeight:600,fontSize:14,color:DK}}>Avance del alumno</p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[
              {v:"Excelente progreso 🌟",bg:"#f0fdf4",col:"#15803d"},
              {v:"Buen avance 👍",bg:"#f0f6fa",col:BL},
              {v:"Regular, necesita refuerzo ⚡",bg:"#fefce8",col:"#92400e"},
              {v:"Dificultades, recomiendo más clases 📌",bg:PL,col:P},
            ].map(op=>(
              <button key={op.v} onClick={()=>setAvance(op.v)}
                style={{background:avance===op.v?op.col:op.bg,color:avance===op.v?"#fff":op.col,
                  border:`1.5px solid ${op.col}44`,borderRadius:10,padding:"10px 14px",
                  fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"left",transition:"all 0.15s"}}>
                {op.v}
              </button>
            ))}
          </div>
        </div>
        <Btn onClick={()=>onGuardar(texto+" — "+avance)} disabled={!texto||!avance}>
          Guardar devolución ✓
        </Btn>
      </div>
    </div>
  );
}

// ── PANTALLA DISPONIBILIDAD ──────────────────────────────────────────────────
function Disponibilidad({ dispon, setDispon, onRecurrente }) {
  const [fechaSel,setFechaSel] = useState(null);
  const [mes,setMes] = useState(new Date().getMonth());
  const year = new Date().getFullYear();
  const TIPO_COLOR = {
    individual:{bg:PL,col:P,icon:"👤"},
    grupal:{bg:"#f0f6fa",col:BL,icon:"👥"},
    ambas:{bg:"#f0fdf4",col:"#15803d",icon:"✦"},
  };

  const toggleBloque = (h) => {
    setDispon(prev=>{
      const dia = prev[fechaSel]||{};
      const ciclo = {individual:"grupal",grupal:"ambas",ambas:null};
      const actual = dia[h];
      const nuevo = {...dia};
      if (!actual) nuevo[h]="individual";
      else if (ciclo[actual]) nuevo[h]=ciclo[actual];
      else delete nuevo[h];
      return {...prev,[fechaSel]:nuevo};
    });
  };

  const bloquesHoy = fechaSel?(dispon[fechaSel]||{}):{};
  const indivCount = Object.values(bloquesHoy).filter(t=>t==="individual"||t==="ambas").length;
  const grupalCount = Object.values(bloquesHoy).filter(t=>t==="grupal"||t==="ambas").length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <h3 style={{margin:"0 0 4px",color:DK}}>Mi disponibilidad</h3>
          <p style={{margin:0,fontSize:13,color:"#64748b"}}>Tocá un día para editar · o usá recurrente</p>
        </div>
        <button onClick={onRecurrente}
          style={{background:P,color:"#fff",border:"none",borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>
          🔄 Recurrente
        </button>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {Object.entries(TIPO_COLOR).map(([t,c])=>(
          <span key={t} style={{background:c.bg,color:c.col,borderRadius:99,padding:"4px 12px",fontSize:11,fontWeight:700}}>
            {c.icon} {t==="individual"?"Solo individual":t==="grupal"?"Solo grupal":"Ambas modalidades"}
          </span>
        ))}
      </div>

      <Card style={{padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={()=>setMes(m=>Math.max(m-1,0))} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:P}}>‹</button>
          <span style={{fontWeight:700,fontSize:15,color:DK}}>{MESES[mes]} {year}</span>
          <button onClick={()=>setMes(m=>Math.min(m+1,11))} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:P}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,textAlign:"center"}}>
          {DIAS.map(d=><div key={d} style={{fontSize:11,color:"#94a3b8",fontWeight:600,paddingBottom:4}}>{d}</div>)}
          {Array(primerDia(year,mes)).fill(null).map((_,i)=><div key={`e${i}`}/>)}
          {Array(diasEnMes(year,mes)).fill(null).map((_,i)=>{
            const d=i+1, iso=toISO(year,mes,d);
            const cnt = Object.keys(dispon[iso]||{}).length;
            const sel = fechaSel===iso;
            return (
              <button key={d} onClick={()=>setFechaSel(sel?null:iso)}
                style={{aspectRatio:"1",borderRadius:8,border:sel?`2px solid ${P}`:"none",
                  background:sel?P:cnt>0?"#dcfce7":"transparent",
                  color:sel?"#fff":cnt>0?"#15803d":"#374151",
                  fontSize:12,fontWeight:cnt>0?700:400,cursor:"pointer",position:"relative"}}>
                {d}
                {cnt>0&&!sel&&<div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:"#15803d"}}/>}
              </button>
            );
          })}
        </div>
      </Card>

      {fechaSel && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>{fmt(fechaSel)}</p>
            <button onClick={()=>{setDispon(prev=>{const n={...prev};delete n[fechaSel];return n;});}}
              style={{background:"none",border:"1.5px solid #fecaca",borderRadius:8,padding:"4px 12px",fontSize:12,color:"#dc2626",cursor:"pointer",fontWeight:600}}>
              Limpiar día
            </button>
          </div>
          <div style={{background:"#f0f6fa",borderRadius:10,padding:"10px 14px"}}>
            <p style={{margin:0,fontSize:12,color:BL}}>
              <strong>Cómo usar:</strong> Tocá un bloque para agregarlo como <strong>individual</strong> → volvé a tocar para <strong>grupal</strong> → otra vez para <strong>ambas</strong> → una más para quitarlo
            </p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {HORAS_DIA.map(h=>{
              const tipo = bloquesHoy[h];
              const c = tipo?TIPO_COLOR[tipo]:{bg:"#f8fafc",col:"#94a3b8",icon:"+"};
              return (
                <button key={h} onClick={()=>toggleBloque(h)}
                  style={{padding:"14px 0",borderRadius:12,
                    border:`2px solid ${tipo?c.col+"55":"#e2e8f0"}`,
                    background:c.bg,color:c.col,
                    fontWeight:tipo?700:400,fontSize:13,cursor:"pointer",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all 0.15s"}}>
                  <span style={{fontSize:15}}>{c.icon}</span>
                  {h}
                  {tipo && <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",opacity:0.8}}>{tipo}</span>}
                </button>
              );
            })}
          </div>
          <Card style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",padding:12}}>
            <p style={{margin:0,fontSize:13,color:"#166534"}}>
              <strong>{Object.keys(bloquesHoy).length} bloques</strong> cargados ·{" "}
              👤 {indivCount} individuales · 👥 {grupalCount} grupales
            </p>
          </Card>
        </div>
      )}

      {!fechaSel && (
        <Card style={{padding:20,textAlign:"center"}}>
          <p style={{margin:0,fontSize:14,color:"#94a3b8"}}>👆 Seleccioná un día en el calendario para editar sus horarios</p>
        </Card>
      )}
    </div>
  );
}

// ── PANTALLA ALUMNOS ─────────────────────────────────────────────────────────
function Alumnos({ reservas, onDevolucion }) {
  const [alumnoSel, setAlumnoSel] = useState(null);

  const nombresUnicos = [...new Set(reservas.map(r=>r.alumno))];
  const alumnos = nombresUnicos.map(nombre=>{
    const clases = reservas.filter(r=>r.alumno===nombre).sort((a,b)=>b.fecha.localeCompare(a.fecha));
    const materias = [...new Set(clases.map(r=>r.materia))];
    const completadas = clases.filter(r=>r.devolucion).length;
    const pendientes = clases.filter(r=>r.fecha<HOY&&!r.devolucion).length;
    return { nombre, clases, totalClases:clases.length, completadas, pendientes, materias };
  });

  // Vista detalle de un alumno
  if (alumnoSel) {
    const a = alumnos.find(x=>x.nombre===alumnoSel);
    const pasadas = a.clases.filter(r=>r.fecha<HOY);
    const proximas = a.clases.filter(r=>r.fecha>=HOY);
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <button onClick={()=>setAlumnoSel(null)} style={{background:"none",border:"none",cursor:"pointer",textAlign:"left",fontSize:14,color:P,fontWeight:700,padding:0}}>
          ← Volver a alumnos
        </button>

        {/* Header alumno */}
        <Card>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <Av i={initialsProfe(a.nombre)} color={P} size={52}/>
            <div>
              <p style={{margin:0,fontWeight:800,fontSize:17,color:DK}}>{a.nombre}</p>
              <p style={{margin:"3px 0 0",fontSize:12,color:"#64748b"}}>{a.materias.join(" · ")}</p>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[
              {n:a.totalClases,l:"Total",bg:"#f8fafc",col:DK},
              {n:a.completadas,l:"Con feedback",bg:"#f0fdf4",col:"#15803d"},
              {n:a.pendientes,l:"Pendientes",bg:a.pendientes>0?PL:"#f8fafc",col:a.pendientes>0?P:"#94a3b8"},
            ].map(s=>(
              <div key={s.l} style={{background:s.bg,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                <p style={{margin:0,fontSize:20,fontWeight:800,color:s.col}}>{s.n}</p>
                <p style={{margin:0,fontSize:10,color:"#64748b",lineHeight:1.3}}>{s.l}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Próximas */}
        {proximas.length>0 && (
          <div>
            <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>Próximas clases</p>
            {proximas.map(r=>(
              <Card key={r.id} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.materia}</p>
                    <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{fmt(r.fecha)} · {r.hora} · {r.modalidad}</p>
                  </div>
                  <Badge bg={r.tipo==="grupal"?"#f0f6fa":PL} col={r.tipo==="grupal"?BL:P}>{r.tipo==="grupal"?"👥":"👤"}</Badge>
                </div>
                {r.necesidad && (
                  <div style={{background:"#f8fafc",borderRadius:8,padding:"8px 12px"}}>
                    <p style={{margin:"0 0 3px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Lo que necesita</p>
                    <p style={{margin:0,fontSize:13,color:"#374151"}}>{r.necesidad}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Historial con necesidades y devoluciones */}
        {pasadas.length>0 && (
          <div>
            <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>Historial de clases</p>
            {pasadas.map(r=>(
              <Card key={r.id} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div>
                    <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.materia}</p>
                    <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{fmt(r.fecha)} · {r.hora} · {r.modalidad}</p>
                  </div>
                  {r.devolucion
                    ? <Badge bg="#dcfce7" col="#15803d">✓ ok</Badge>
                    : <Badge bg="#fefce8" col="#92400e">⚠️ pendiente</Badge>
                  }
                </div>

                {/* Lo que pidió el alumno */}
                {r.necesidad && (
                  <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                    <p style={{margin:"0 0 3px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>💬 El alumno pidió</p>
                    <p style={{margin:0,fontSize:13,color:"#374151",lineHeight:1.5}}>{r.necesidad}</p>
                  </div>
                )}

                {/* Devolución o botón para cargar */}
                {r.devolucion ? (
                  <div style={{background:"#f0fdf4",borderRadius:8,padding:"10px 12px",border:"1px solid #bbf7d0"}}>
                    <p style={{margin:"0 0 3px",fontSize:11,fontWeight:700,color:"#166534",textTransform:"uppercase"}}>✍️ Tu devolución</p>
                    <p style={{margin:0,fontSize:13,color:"#374151",lineHeight:1.5}}>{r.devolucion}</p>
                  </div>
                ) : (
                  <Btn onClick={()=>onDevolucion(r)}>✍️ Cargar devolución</Btn>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Vista lista de alumnos
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Mis alumnos</h3>
      <p style={{margin:0,fontSize:13,color:"#64748b"}}>{alumnos.length} alumnos activos · Tocá uno para ver el detalle</p>
      {alumnos.map(a=>(
        <button key={a.nombre} onClick={()=>setAlumnoSel(a.nombre)}
          style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:16,padding:16,cursor:"pointer",textAlign:"left",boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
            <Av i={initialsProfe(a.nombre)} color={P} size={44}/>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:800,fontSize:15,color:DK}}>{a.nombre}</p>
              <p style={{margin:"3px 0 0",fontSize:12,color:"#64748b"}}>{a.materias.join(" · ")}</p>
            </div>
            <span style={{color:"#94a3b8",fontSize:18}}>›</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
            {[
              {n:a.totalClases,l:"Clases",bg:"#f8fafc",col:DK},
              {n:a.completadas,l:"Con feedback",bg:"#f0fdf4",col:"#15803d"},
              {n:a.pendientes,l:"Pendientes",bg:a.pendientes>0?PL:"#f8fafc",col:a.pendientes>0?P:"#94a3b8"},
            ].map(s=>(
              <div key={s.l} style={{background:s.bg,borderRadius:10,padding:"8px",textAlign:"center"}}>
                <p style={{margin:0,fontSize:18,fontWeight:800,color:s.col}}>{s.n}</p>
                <p style={{margin:0,fontSize:10,color:"#64748b",lineHeight:1.3}}>{s.l}</p>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {a.materias.map(m=><Badge key={m} bg={PL} col={P}>{m}</Badge>)}
          </div>
        </button>
      ))}
    </div>
  );
}


// ── PANTALLA INGRESOS ────────────────────────────────────────────────────────
function Ingresos({ reservas }) {
  const [mes, setMes] = useState(new Date().getMonth());
  const year = new Date().getFullYear();
  const nombresMes = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const realizadasMes = reservas.filter(r => {
    if (!r.realizada) return false;
    const [y,m] = r.fecha.split("-");
    return parseInt(m)-1 === mes && parseInt(y) === year;
  });

  const calcGanancia = (r) => calcPagoProfe(r);

  const totalHoras = realizadasMes.reduce((a,r)=>a+(r.horas||1),0);
  const totalNeto = realizadasMes.reduce((a,r)=>a+calcGanancia(r),0);

  // Acumulado todos los meses
  const todasRealizadas = reservas.filter(r=>r.realizada);
  const totalAcum = todasRealizadas.reduce((a,r)=>a+calcGanancia(r),0);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <h3 style={{margin:0,color:DK}}>Mis ingresos</h3>

      {/* Selector de mes */}
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
        {[4,5].map(m=>(
          <button key={m} onClick={()=>setMes(m)}
            style={{flexShrink:0,background:mes===m?P:PL,color:mes===m?"#fff":P,
              border:`1.5px solid ${mes===m?P:PB}`,borderRadius:99,
              padding:"6px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            {nombresMes[m]} {year}
          </button>
        ))}
      </div>

      {/* Resumen del mes */}
      <div style={{background:`linear-gradient(135deg,${DK},#3d3d3d)`,borderRadius:20,padding:"20px",color:"#fff"}}>
        <p style={{margin:"0 0 16px",fontSize:13,opacity:0.6,textTransform:"uppercase",letterSpacing:0.8}}>
          {nombresMes[mes]} {year}
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <div style={{background:"rgba(255,255,255,0.08)",borderRadius:12,padding:"14px"}}>
            <p style={{margin:0,fontSize:28,fontWeight:800}}>{totalHoras}</p>
            <p style={{margin:0,fontSize:12,opacity:0.6}}>horas dadas</p>
          </div>
          <div style={{background:"rgba(255,255,255,0.08)",borderRadius:12,padding:"14px"}}>
            <p style={{margin:0,fontSize:28,fontWeight:800}}>{realizadasMes.length}</p>
            <p style={{margin:0,fontSize:12,opacity:0.6}}>clases</p>
          </div>
        </div>
        <div style={{background:"rgba(217,79,61,0.3)",borderRadius:12,padding:"14px",marginBottom:10}}>
          <p style={{margin:"0 0 4px",fontSize:12,opacity:0.7}}>Lo que te corresponde cobrar</p>
          <p style={{margin:0,fontSize:32,fontWeight:800,color:"#fff"}}>${totalNeto.toLocaleString("es-AR")}</p>
          <p style={{margin:"4px 0 0",fontSize:11,opacity:0.5}}>{totalHoras}hs · {realizadasMes.length} clases realizadas</p>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,opacity:0.5}}>
          <span>Acumulado histórico</span>
          <span style={{fontWeight:700}}>${totalAcum.toLocaleString("es-AR")}</span>
        </div>
      </div>

      {/* Detalle de clases del mes */}
      {realizadasMes.length > 0 ? (
        <div>
          <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>
            Detalle de clases
          </p>
          {realizadasMes.map(r=>{
            const ganancia = calcGanancia(r);
            return (
              <Card key={r.id} style={{marginBottom:10,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.materia} — {r.alumno}</p>
                    <p style={{margin:"2px 0 4px",fontSize:12,color:"#64748b"}}>{fmt(r.fecha)} · {r.hora} · {r.horas}hs</p>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {r.tipo==="grupal"
                        ? <Badge bg="#f0f6fa" col={BL}>👥 {r.alumnosGrupo} alumnos × ${CFG.tarifaProfeGrp.toLocaleString("es-AR")}</Badge>
                        : <Badge bg={PL} col={P}>👤 Individual · ${CFG.tarifaProfeInd.toLocaleString("es-AR")}/hs</Badge>
                      }
                      <Badge bg="#f0f6fa" col={BL}>{r.modalidad}</Badge>
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
                    <p style={{margin:0,fontSize:18,fontWeight:800,color:P}}>${ganancia.toLocaleString("es-AR")}</p>
                    <p style={{margin:"2px 0 0",fontSize:11,color:"#94a3b8"}}>tu ingreso</p>
                  </div>
                </div>
                {r.marcadaEn && (
                  <p style={{margin:"8px 0 0",fontSize:11,color:"#94a3b8"}}>✓ Marcada realizada el {r.marcadaEn}</p>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card style={{padding:20,textAlign:"center"}}>
          <p style={{margin:0,fontSize:14,color:"#94a3b8"}}>Sin clases realizadas en {nombresMes[mes]}</p>
        </Card>
      )}
    </div>
  );
}

// ── MODAL DISPONIBILIDAD RECURRENTE (flujo conversacional) ───────────────────
function ModalRecurrente({ onCerrar, dispon, setDispon }) {
  const [paso, setPaso] = useState(1); // 1=días, 2=horarios, 3=tipo, 4=duración, 5=confirmar
  const [diasSel, setDiasSel] = useState([]);
  const [horasSel, setHorasSel] = useState([]);
  const [tipo, setTipo] = useState(null);
  const [semanas, setSemanas] = useState(4);

  const DIAS_SEMANA = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const TIPO_COLOR = {
    individual:{bg:PL,col:P,icon:"👤",desc:"Solo clases individuales"},
    grupal:{bg:"#f0f6fa",col:BL,icon:"👥",desc:"Solo clases grupales"},
    ambas:{bg:"#f0fdf4",col:"#15803d",icon:"✦",desc:"Ambas modalidades"},
  };

  const toggleDia = d => setDiasSel(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d]);
  const toggleHora = h => setHorasSel(prev=>prev.includes(h)?prev.filter(x=>x!==h):[...prev,h]);

  const aplicar = () => {
    const nuevaDispon = {...dispon};
    for (let sem=0; sem<semanas; sem++) {
      diasSel.forEach(dia => {
        // Calcular próxima ocurrencia de ese día
        const hoy = new Date();
        const diff = (dia - hoy.getDay() + 7) % 7 || 7;
        const fecha = new Date(hoy);
        fecha.setDate(hoy.getDate() + diff + sem*7);
        const iso = `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,"0")}-${String(fecha.getDate()).padStart(2,"0")}`;
        if (!nuevaDispon[iso]) nuevaDispon[iso] = {};
        horasSel.forEach(h => { nuevaDispon[iso][h] = tipo; });
      });
    }
    setDispon(nuevaDispon);
    setPaso(5);
  };

  const totalBloques = diasSel.length * horasSel.length * semanas;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>

        {/* Header fijo */}
        <div style={{padding:"20px 20px 0",position:"sticky",top:0,background:"#fff",zIndex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {paso>1 && paso<5 && (
                <button onClick={()=>setPaso(p=>p-1)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:P,padding:0}}>←</button>
              )}
              <h3 style={{margin:0,color:DK,fontSize:17}}>🔄 Disponibilidad recurrente</h3>
            </div>
            <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
          </div>
          {/* Barra de progreso */}
          {paso < 5 && (
            <div style={{display:"flex",gap:4,marginBottom:16}}>
              {[1,2,3,4].map(n=>(
                <div key={n} style={{flex:1,height:3,borderRadius:99,background:paso>=n?P:"#e2e8f0",transition:"background 0.3s"}}/>
              ))}
            </div>
          )}
        </div>

        <div style={{padding:"0 20px 44px",display:"flex",flexDirection:"column",gap:16}}>

          {/* PASO 1: ¿Qué días? */}
          {paso===1 && (
            <>
              <div>
                <p style={{margin:"0 0 4px",fontWeight:700,fontSize:16,color:DK}}>¿Qué días de la semana das clases?</p>
                <p style={{margin:0,fontSize:13,color:"#64748b"}}>Podés elegir más de uno.</p>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {DIAS_SEMANA.map((d,i)=>(
                  <button key={d} onClick={()=>toggleDia(i)}
                    style={{padding:"14px 0",borderRadius:12,display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                      background:diasSel.includes(i)?P:PL,
                      color:diasSel.includes(i)?"#fff":P,
                      border:`2px solid ${diasSel.includes(i)?P:PB}`,
                      fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s"}}>
                    {diasSel.includes(i) && <span style={{fontSize:10}}>✓</span>}
                    {d}
                  </button>
                ))}
              </div>
              {diasSel.length>0 && (
                <Card style={{background:PL,border:`1.5px solid ${PB}`,padding:12}}>
                  <p style={{margin:0,fontSize:13,color:P}}>
                    Días elegidos: <strong>{diasSel.map(d=>DIAS_SEMANA[d]).join(", ")}</strong>
                  </p>
                </Card>
              )}
              <Btn onClick={()=>setPaso(2)} disabled={diasSel.length===0}>Siguiente →</Btn>
            </>
          )}

          {/* PASO 2: ¿En qué horarios? */}
          {paso===2 && (
            <>
              <div>
                <p style={{margin:"0 0 4px",fontWeight:700,fontSize:16,color:DK}}>¿En qué horarios?</p>
                <p style={{margin:0,fontSize:13,color:"#64748b"}}>Tildá todos los bloques en que estás disponible.</p>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {HORAS_DIA.map(h=>(
                  <button key={h} onClick={()=>toggleHora(h)}
                    style={{padding:"14px 0",borderRadius:12,display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                      background:horasSel.includes(h)?P:PL,
                      color:horasSel.includes(h)?"#fff":P,
                      border:`2px solid ${horasSel.includes(h)?P:PB}`,
                      fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s"}}>
                    {horasSel.includes(h) && <span style={{fontSize:10}}>✓</span>}
                    {h}
                  </button>
                ))}
              </div>
              {horasSel.length>0 && (
                <Card style={{background:PL,border:`1.5px solid ${PB}`,padding:12}}>
                  <p style={{margin:0,fontSize:13,color:P}}>
                    <strong>{horasSel.length} horarios</strong> seleccionados: {horasSel.sort().join(" · ")}
                  </p>
                </Card>
              )}
              <Btn onClick={()=>setPaso(3)} disabled={horasSel.length===0}>Siguiente →</Btn>
            </>
          )}

          {/* PASO 3: ¿Qué tipo de clases? */}
          {paso===3 && (
            <>
              <div>
                <p style={{margin:"0 0 4px",fontWeight:700,fontSize:16,color:DK}}>¿Qué tipo de clases ofrecés en esos horarios?</p>
                <p style={{margin:0,fontSize:13,color:"#64748b"}}>Esto define qué ve el alumno al reservar.</p>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {Object.entries(TIPO_COLOR).map(([t,c])=>(
                  <button key={t} onClick={()=>setTipo(t)}
                    style={{background:tipo===t?c.col:c.bg,color:tipo===t?"#fff":c.col,
                      border:`2px solid ${tipo===t?c.col:c.col+"44"}`,borderRadius:14,
                      padding:"16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,transition:"all 0.15s"}}>
                    <span style={{fontSize:28}}>{c.icon}</span>
                    <div>
                      <p style={{margin:0,fontWeight:700,fontSize:15}}>{t.charAt(0).toUpperCase()+t.slice(1)}</p>
                      <p style={{margin:"2px 0 0",fontSize:12,opacity:0.8}}>{c.desc}</p>
                    </div>
                    {tipo===t && <span style={{marginLeft:"auto",fontSize:18}}>✓</span>}
                  </button>
                ))}
              </div>
              <Btn onClick={()=>setPaso(4)} disabled={!tipo}>Siguiente →</Btn>
            </>
          )}

          {/* PASO 4: ¿Por cuántas semanas? */}
          {paso===4 && (
            <>
              <div>
                <p style={{margin:"0 0 4px",fontWeight:700,fontSize:16,color:DK}}>¿Por cuántas semanas?</p>
                <p style={{margin:0,fontSize:13,color:"#64748b"}}>Se va a agregar automáticamente a tu calendario.</p>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  {n:2,l:"2 semanas",d:"Ideal para probar"},
                  {n:4,l:"4 semanas",d:"Un mes completo"},
                  {n:8,l:"8 semanas",d:"Dos meses"},
                  {n:12,l:"12 semanas",d:"Un trimestre"},
                ].map(s=>(
                  <button key={s.n} onClick={()=>setSemanas(s.n)}
                    style={{background:semanas===s.n?PL:"#f8fafc",border:`2px solid ${semanas===s.n?P:"#e2e8f0"}`,
                      borderRadius:12,padding:"14px",cursor:"pointer",textAlign:"left",transition:"all 0.15s"}}>
                    <p style={{margin:0,fontWeight:800,fontSize:18,color:semanas===s.n?P:DK}}>{s.l}</p>
                    <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{s.d}</p>
                  </button>
                ))}
              </div>

              {/* Resumen final antes de confirmar */}
              <Card style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",padding:16}}>
                <p style={{margin:"0 0 10px",fontWeight:700,fontSize:14,color:"#166534"}}>📋 Resumen</p>
                <div style={{display:"flex",flexDirection:"column",gap:6,fontSize:13,color:"#374151"}}>
                  <span>📅 Días: <strong>{diasSel.map(d=>DIAS_SEMANA[d]).join(", ")}</strong></span>
                  <span>🕐 Horarios: <strong>{horasSel.sort().join(", ")}</strong></span>
                  <span>{TIPO_COLOR[tipo]?.icon} Tipo: <strong>{tipo}</strong></span>
                  <span>📆 Duración: <strong>{semanas} semanas</strong></span>
                  <span>✦ Total bloques a agregar: <strong>{totalBloques}</strong></span>
                </div>
              </Card>

              <Btn onClick={aplicar}>Aplicar disponibilidad ✓</Btn>
            </>
          )}

          {/* PASO 5: Confirmación */}
          {paso===5 && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,textAlign:"center",padding:"20px 0"}}>
              <div style={{width:72,height:72,background:"#f0fdf4",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40}}>✅</div>
              <h3 style={{margin:0,color:DK,fontSize:20}}>¡Listo!</h3>
              <p style={{margin:0,fontSize:14,color:"#64748b",lineHeight:1.6}}>
                Se agregaron <strong>{totalBloques} bloques</strong> de disponibilidad.<br/>
                Todos los <strong>{diasSel.map(d=>DIAS_SEMANA[d]).join(", ")}</strong> por <strong>{semanas} semanas</strong>.
              </p>
              <Btn onClick={onCerrar}>Ver mi calendario →</Btn>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}


// ── PANTALLA PERFIL DEL PROFE ─────────────────────────────────────────────────
const MATERIAS_DISPONIBLES = [
  "Matemática","Álgebra","Análisis Matemático","Geometría",
  "Física","Química","Biología",
  "Lengua","Literatura","Historia","Geografía","Filosofía",
  "Inglés","Francés","Portugués",
  "Informática","Programación","Economía","Contabilidad",
];

const NIVELES = ["Primaria","Secundaria","Preuniversitario","Universitario","Adultos"];

function PerfilProfe({ onLogoutProfe, profeData }) {
  const [editando, setEditando] = useState(false);
  const [perfil, setPerfil] = useState({
    nombre: "",
    titulo: "",
    experiencia: "",
    sobreMi: "",
    materias: [],
    niveles: [],
    modalidad: ["Presencial","Virtual"],
    ubicacion: "",
    instagram: "",
    whatsapp: "",
  });
  useEffect(() => {
    if (!profeData) return;
    const updates = {
      nombre: profeData.profiles?.nombre || "",
      titulo: profeData.titulo || "",
      sobreMi: profeData.bio || "",
      materias: profeData.materias || [],
      modalidad: profeData.modalidad || profeData.modalidades || ["Presencial","Virtual"],
      experiencia: profeData["años_experiencia"]?.toString() || "",
      ubicacion: profeData.ubicacion || "",
      instagram: profeData.instagram || "",
      niveles: profeData.niveles || [],
    };
    setPerfil(prev => ({...prev, ...updates}));
    setDraft(prev => ({...prev, ...updates}));
  }, [profeData]);
  const [draft, setDraft] = useState(perfil);
  const [seccion, setSeccion] = useState("perfil"); // perfil | editar

  const toggleMateria = m => setDraft(p=>({...p,
    materias: p.materias.includes(m) ? p.materias.filter(x=>x!==m) : [...p.materias, m]
  }));
  const toggleNivel = n => setDraft(p=>({...p,
    niveles: p.niveles.includes(n) ? p.niveles.filter(x=>x!==n) : [...p.niveles, n]
  }));
  const toggleModal = m => setDraft(p=>({...p,
    modalidad: p.modalidad.includes(m) ? p.modalidad.filter(x=>x!==m) : [...p.modalidad, m]
  }));

  const guardar = async () => {
    await Promise.all([
      actualizarPerfil(profeData.id, { nombre: draft.nombre }),
      actualizarProfe(profeData.id, {
        titulo: draft.titulo,
        bio: draft.sobreMi,
        materias: draft.materias,
        modalidad: draft.modalidad,
        "años_experiencia": draft.experiencia ? parseInt(draft.experiencia, 10) : null,
        ubicacion: draft.ubicacion,
        instagram: draft.instagram,
        niveles: draft.niveles,
      }),
    ]).catch(err => console.error("Error al guardar perfil profe:", err));
    setPerfil(draft);
    setSeccion("perfil");
  };

  // ── VISTA PREVIA (como la ve el alumno) ──────────────────────────────────
  if (seccion === "preview") return (
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      <button onClick={()=>setSeccion("perfil")} style={{background:"none",border:"none",cursor:"pointer",textAlign:"left",fontSize:14,color:P,fontWeight:700,padding:"0 0 16px"}}>
        ← Volver a mi perfil
      </button>

      {/* Hero como lo ve el alumno */}
      <div style={{background:`linear-gradient(160deg,${DK},#3d3d3d)`,borderRadius:20,padding:"28px 20px",color:"#fff",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
          <div style={{width:72,height:72,borderRadius:"50%",background:P,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:800,color:"#fff",flexShrink:0}}>{initialsProfe(perfil.nombre)}</div>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800}}>{perfil.nombre}</h2>
            <p style={{margin:"4px 0 0",fontSize:13,opacity:0.7}}>{perfil.titulo}</p>
            <p style={{margin:"2px 0 0",fontSize:12,opacity:0.6}}>📍 {perfil.ubicacion}</p>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          {perfil.modalidad.map(m=>(
            <span key={m} style={{background:"rgba(255,255,255,0.15)",borderRadius:99,padding:"4px 14px",fontSize:12,fontWeight:600}}>{m}</span>
          ))}
          <span style={{background:"rgba(255,255,255,0.15)",borderRadius:99,padding:"4px 14px",fontSize:12,fontWeight:600}}>
            ⭐ {perfil.experiencia} años de exp.
          </span>
        </div>
      </div>

      <Card style={{marginBottom:12}}>
        <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Sobre mí</p>
        <p style={{margin:0,fontSize:14,color:"#374151",lineHeight:1.7}}>{perfil.sobreMi}</p>
      </Card>

      <Card style={{marginBottom:12}}>
        <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Materias</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {perfil.materias.map(m=><Badge key={m} bg={PL} col={P}>{m}</Badge>)}
        </div>
      </Card>

      <Card style={{marginBottom:12}}>
        <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Niveles que enseño</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {perfil.niveles.map(n=><Badge key={n} bg="#f0f6fa" col={BL}>{n}</Badge>)}
        </div>
      </Card>

      <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:14,padding:14}}>
        <p style={{margin:"0 0 4px",fontSize:12,fontWeight:700,color:"#166534",textTransform:"uppercase"}}>Así te ven los alumnos</p>
        <p style={{margin:0,fontSize:13,color:"#374151"}}>Esta es la vista pública de tu perfil. Los alumnos la ven antes de elegirte.</p>
      </div>
    </div>
  );

  // ── EDITOR DE PERFIL ──────────────────────────────────────────────────────
  if (seccion === "editar") return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={()=>{setSeccion("perfil");setDraft(perfil);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:P,padding:0}}>←</button>
        <h3 style={{margin:0,color:DK}}>Editar perfil</h3>
      </div>

      {/* Nombre y título */}
      {[
        {label:"Nombre completo",key:"nombre",placeholder:"Tu nombre y apellido"},
        {label:"Título / Formación",key:"titulo",placeholder:"Ej: Lic. en Matemática — UNMdP"},
        {label:"Años de experiencia",key:"experiencia",placeholder:"Ej: 8",type:"number"},
        {label:"Ubicación",key:"ubicacion",placeholder:"Ej: Mar del Plata, Buenos Aires"},
        {label:"Instagram (opcional)",key:"instagram",placeholder:"@tu.cuenta"},
      ].map(f=>(
        <div key={f.key} style={{display:"flex",flexDirection:"column",gap:6}}>
          <label style={{fontSize:13,fontWeight:600,color:DK}}>{f.label}</label>
          <input
            type={f.type||"text"}
            value={draft[f.key]}
            onChange={e=>setDraft(p=>({...p,[f.key]:e.target.value}))}
            placeholder={f.placeholder}
            style={{border:`2px solid ${draft[f.key]?P+"44":"#e2e8f0"}`,borderRadius:12,padding:"12px 16px",fontSize:14,outline:"none",fontFamily:"inherit",transition:"border 0.2s"}}
          />
        </div>
      ))}

      {/* Sobre mí */}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        <label style={{fontSize:13,fontWeight:600,color:DK}}>Sobre mí</label>
        <p style={{margin:0,fontSize:12,color:"#94a3b8"}}>Contale a los alumnos quién sos, tu método y tu experiencia. Esto genera confianza.</p>
        <textarea
          value={draft.sobreMi}
          onChange={e=>setDraft(p=>({...p,sobreMi:e.target.value}))}
          placeholder="Ej: Soy profe de matemática con 8 años de experiencia. Mi método se basa en..."
          style={{border:`2px solid ${draft.sobreMi?P+"44":"#e2e8f0"}`,borderRadius:12,padding:"12px 16px",fontSize:14,fontFamily:"inherit",minHeight:120,resize:"vertical",outline:"none",transition:"border 0.2s"}}
        />
        <p style={{margin:0,fontSize:11,color:"#94a3b8",textAlign:"right"}}>{draft.sobreMi.length} caracteres</p>
      </div>

      {/* Materias */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <label style={{fontSize:13,fontWeight:600,color:DK}}>Materias que das</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {MATERIAS_DISPONIBLES.map(m=>(
            <button key={m} onClick={()=>toggleMateria(m)}
              style={{background:draft.materias.includes(m)?P:PL,
                color:draft.materias.includes(m)?"#fff":P,
                border:`1.5px solid ${draft.materias.includes(m)?P:PB}`,
                borderRadius:99,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
              {draft.materias.includes(m)?"✓ ":""}{m}
            </button>
          ))}
        </div>
      </div>

      {/* Niveles */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <label style={{fontSize:13,fontWeight:600,color:DK}}>Niveles que enseñás</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {NIVELES.map(n=>(
            <button key={n} onClick={()=>toggleNivel(n)}
              style={{background:draft.niveles.includes(n)?BL:"#f0f6fa",
                color:draft.niveles.includes(n)?"#fff":BL,
                border:`1.5px solid ${draft.niveles.includes(n)?BL:"#a8d4e8"}`,
                borderRadius:99,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
              {draft.niveles.includes(n)?"✓ ":""}{n}
            </button>
          ))}
        </div>
      </div>

      {/* Modalidad */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <label style={{fontSize:13,fontWeight:600,color:DK}}>Modalidad</label>
        <div style={{display:"flex",gap:10}}>
          {["Presencial","Virtual"].map(m=>(
            <button key={m} onClick={()=>toggleModal(m)}
              style={{flex:1,background:draft.modalidad.includes(m)?"#f0fdf4":"#f8fafc",
                color:draft.modalidad.includes(m)?"#15803d":"#94a3b8",
                border:`2px solid ${draft.modalidad.includes(m)?"#15803d":"#e2e8f0"}`,
                borderRadius:12,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
              {draft.modalidad.includes(m)?"✓ ":""}{m}
            </button>
          ))}
        </div>
      </div>

      <Btn onClick={guardar} disabled={!draft.nombre.trim()||draft.materias.length===0}>
        Guardar cambios ✓
      </Btn>
    </div>
  );

  // ── VISTA MI PERFIL ───────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <h3 style={{margin:0,color:DK}}>Mi perfil</h3>
        <button onClick={()=>setSeccion("preview")}
          style={{background:"#f0f6fa",border:"none",borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:700,color:BL,cursor:"pointer"}}>
          👁 Ver como alumno
        </button>
      </div>

      {/* Tarjeta principal */}
      <Card>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
          <div style={{position:"relative"}}>
            <Av i="DG" size={64} color={P}/>
            <button onClick={()=>{setDraft(perfil);setSeccion("editar");}} title="Editar perfil" style={{position:"absolute",bottom:0,right:0,width:22,height:22,borderRadius:"50%",background:DK,border:"2px solid #fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,color:"#fff"}}>✎</button>
          </div>
          <div style={{flex:1}}>
            <p style={{margin:0,fontWeight:800,fontSize:18,color:DK}}>{perfil.nombre}</p>
            <p style={{margin:"3px 0 2px",fontSize:13,color:"#64748b"}}>{perfil.titulo}</p>
            <Badge bg={PL} col={P}>⭐ {perfil.experiencia} años de experiencia</Badge>
          </div>
        </div>

        {/* Completitud del perfil */}
        {(() => {
          const campos = [perfil.nombre,perfil.titulo,perfil.sobreMi,perfil.ubicacion];
          const completos = campos.filter(Boolean).length + (perfil.materias.length>0?1:0) + (perfil.niveles.length>0?1:0);
          const total = campos.length + 2;
          const pct = Math.round((completos/total)*100);
          return (
            <div style={{background:"#f8fafc",borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:13,fontWeight:600,color:DK}}>Completitud del perfil</span>
                <span style={{fontSize:13,fontWeight:700,color:pct===100?"#15803d":P}}>{pct}%</span>
              </div>
              <div style={{background:"#e2e8f0",borderRadius:99,height:6}}>
                <div style={{background:pct===100?"#15803d":P,borderRadius:99,height:6,width:`${pct}%`,transition:"width 0.4s"}}/>
              </div>
              {pct<100 && <p style={{margin:"6px 0 0",fontSize:12,color:"#64748b"}}>Completá tu perfil para generar más confianza en los alumnos.</p>}
            </div>
          );
        })()}
      </Card>

      {/* Sobre mí */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
          <p style={{margin:0,fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Sobre mí</p>
        </div>
        <p style={{margin:0,fontSize:14,color:"#374151",lineHeight:1.7}}>{perfil.sobreMi}</p>
      </Card>

      {/* Materias y niveles */}
      <Card>
        <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Materias</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:14}}>
          {perfil.materias.map(m=><Badge key={m} bg={PL} col={P}>{m}</Badge>)}
        </div>
        <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Niveles</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:14}}>
          {perfil.niveles.map(n=><Badge key={n} bg="#f0f6fa" col={BL}>{n}</Badge>)}
        </div>
        <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Modalidad</p>
        <div style={{display:"flex",gap:8}}>
          {perfil.modalidad.map(m=><Badge key={m} bg="#f0fdf4" col="#15803d">✓ {m}</Badge>)}
        </div>
      </Card>

      {/* Info de contacto */}
      <Card>
        <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Datos de contacto</p>
        {[
          {icon:"📍",val:perfil.ubicacion},
          {icon:"📱",val:perfil.whatsapp},
          {icon:"📸",val:perfil.instagram},
        ].filter(x=>x.val).map(x=>(
          <div key={x.icon} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <span style={{fontSize:18}}>{x.icon}</span>
            <span style={{fontSize:14,color:"#374151"}}>{x.val}</span>
          </div>
        ))}
      </Card>

      <Btn onClick={()=>{setDraft(perfil);setSeccion("editar");}}>
        ✎ Editar perfil
      </Btn>

      <button onClick={onLogoutProfe} style={{background:"none",border:`1.5px solid #fecaca`,borderRadius:12,padding:"13px",fontSize:14,fontWeight:700,color:"#dc2626",cursor:"pointer",width:"100%"}}>
        Cerrar sesión
      </button>
    </div>
  );
}


// ── PANTALLA CHAT (PROFE) ─────────────────────────────────────────────────────

function ChatProfe({ reservas, userId }) {
  const [reservaSel, setReservaSel] = useState(null);
  const [mensajes, setMensajes] = useState({});
  const [texto, setTexto] = useState("");

  const fmtHora = iso => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };

  const proximas = reservas.filter(r => r.fecha >= HOY);

  useEffect(() => {
    if (!reservaSel) return;
    getMensajes(reservaSel.id)
      .then(data => setMensajes(prev => ({...prev, [reservaSel.id]: data || []})))
      .catch(err => console.error("Error al cargar mensajes:", err));
  }, [reservaSel]);

  useEffect(() => {
    if (!reservaSel) return;
    let mounted = true;
    const canal = suscribirMensajes(reservaSel.id, msg => {
      if (mounted) setMensajes(prev => { const ya=prev[reservaSel.id]||[]; if(ya.some(m=>m.id===msg.id)) return prev; return {...prev,[reservaSel.id]:[...ya,msg]}; });
    });
    return () => { mounted = false; canal.unsubscribe(); };
  }, [reservaSel]);

  const enviar = () => {
    if (!texto.trim()) return;
    const t = texto.trim();
    setTexto("");
    enviarMensaje(reservaSel.id, "profe", userId, t)
      .then(msg => { if(msg?.id) setMensajes(prev=>{ const ya=prev[reservaSel.id]||[]; if(ya.some(m=>m.id===msg.id)) return prev; return {...prev,[reservaSel.id]:[...ya,msg]}; }); })
      .catch(err => { console.error("Error al enviar mensaje:", err); setTexto(t); });
  };

  const esContacto = (t) => {
    const regex = /(\d[\s.\-]?){7,}|@[a-z]/i;
    return regex.test(t) && !/^\d{1,2}[:h]\d{2}/.test(t);
  };

  if (reservaSel) {
    const msgs = mensajes[reservaSel.id] || [];
    return (
      <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 140px)"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexShrink:0}}>
          <button onClick={()=>setReservaSel(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:P,padding:0}}>←</button>
          <Av i={initialsProfe(reservaSel.alumno)} color={P} size={38}/>
          <div style={{flex:1}}>
            <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>{reservaSel.alumno}</p>
            <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{reservaSel.materia} · {fmt(reservaSel.fecha)} {reservaSel.hora}</p>
          </div>
          <Badge bg={reservaSel.tipo==="grupal"?"#f0f6fa":PL} col={reservaSel.tipo==="grupal"?BL:P}>
            {reservaSel.tipo==="grupal"?"👥":"👤"}
          </Badge>
        </div>

        <div style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:10,padding:"8px 12px",marginBottom:12,flexShrink:0}}>
          <p style={{margin:0,fontSize:11,color:"#92400e",textAlign:"center"}}>
            🔒 Chat solo para coordinar la clase. No está permitido compartir datos de contacto.
          </p>
        </div>

        {/* Mensajes */}
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:10,paddingBottom:8}}>
          {msgs.length === 0 && (
            <div style={{textAlign:"center",padding:"40px 20px"}}>
              <p style={{margin:0,fontSize:14,color:"#94a3b8"}}>Sin mensajes aún.<br/>Escribile al alumno sobre la clase.</p>
            </div>
          )}
          {msgs.map(m => {
            const esMio = m.emisor === "profe";
            return (
              <div key={m.id} style={{display:"flex",justifyContent:esMio?"flex-end":"flex-start",gap:8,alignItems:"flex-end"}}>
                {!esMio && <Av i={initialsProfe(reservaSel.alumno)} color={P} size={28}/>}
                <div style={{maxWidth:"75%"}}>
                  <div style={{
                    background: esMio ? P : "#fff",
                    color: esMio ? "#fff" : DK,
                    borderRadius: esMio ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    padding:"10px 14px",
                    boxShadow:"0 1px 4px rgba(0,0,0,0.08)",
                    fontSize:14, lineHeight:1.5,
                  }}>
                    {m.texto}
                  </div>
                  <p style={{margin:"3px 0 0",fontSize:10,color:"#94a3b8",textAlign:esMio?"right":"left"}}>{fmtHora(m.creado_en)}</p>
                </div>
                {esMio && <Av i="Yo" color={DK} size={28}/>}
              </div>
            );
          })}
        </div>

        {/* Input */}
        <div style={{flexShrink:0,paddingTop:12,borderTop:"1px solid #e2e8f0"}}>
          {esContacto(texto) && (
            <div style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:8,padding:"6px 12px",marginBottom:8}}>
              <p style={{margin:0,fontSize:12,color:"#dc2626"}}>⚠️ No podés compartir datos de contacto.</p>
            </div>
          )}
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea
              value={texto}
              onChange={e=>setTexto(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(!esContacto(texto))enviar();} }}
              placeholder="Escribí tu mensaje..."
              style={{flex:1,border:`2px solid ${texto?P+"44":"#e2e8f0"}`,borderRadius:12,padding:"10px 14px",fontSize:14,fontFamily:"inherit",resize:"none",outline:"none",minHeight:44,maxHeight:100,lineHeight:1.4,transition:"border 0.2s"}}
              rows={1}
            />
            <button onClick={()=>!esContacto(texto)&&enviar()} disabled={!texto.trim()||esContacto(texto)}
              style={{width:44,height:44,borderRadius:12,background:texto.trim()&&!esContacto(texto)?P:"#e2e8f0",border:"none",cursor:texto.trim()&&!esContacto(texto)?"pointer":"not-allowed",fontSize:18,flexShrink:0,transition:"background 0.2s"}}>
              ➤
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Lista de conversaciones
  const totalNoLeidos = proximas.filter(r => (mensajes[r.id]||[]).some(m=>m.emisor==="alumno")).length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <h3 style={{margin:0,color:DK}}>Mensajes</h3>
        {totalNoLeidos > 0 && <Badge bg={PL} col={P}>{totalNoLeidos} sin responder</Badge>}
      </div>
      <p style={{margin:0,fontSize:13,color:"#64748b"}}>Conversaciones con tus alumnos por clase.</p>

      {proximas.map(r => {
        const msgs = mensajes[r.id] || [];
        const ultimo = msgs[msgs.length-1];
        const tieneNoLeido = msgs.some(m=>m.emisor==="alumno");
        return (
          <button key={r.id} onClick={()=>setReservaSel(r)}
            style={{width:"100%",background:"#fff",border:`1.5px solid ${tieneNoLeido?P:"#e2e8f0"}`,borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",marginBottom:6,boxShadow:tieneNoLeido?"0 2px 12px rgba(217,79,61,0.15)":"0 2px 8px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{position:"relative"}}>
                <Av i={initialsProfe(r.alumno)} color={P} size={44}/>
                {tieneNoLeido && <div style={{position:"absolute",top:0,right:0,width:12,height:12,borderRadius:"50%",background:P,border:"2px solid #fff"}}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.alumno}</p>
                  {ultimo && <span style={{fontSize:11,color:"#94a3b8"}}>{fmtHora(ultimo.creado_en)}</span>}
                </div>
                <p style={{margin:0,fontSize:12,color:"#64748b"}}>{r.materia} · {fmt(r.fecha)} {r.hora}</p>
                {ultimo
                  ? <p style={{margin:"3px 0 0",fontSize:13,color:tieneNoLeido?DK:"#94a3b8",fontWeight:tieneNoLeido?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {ultimo.emisor==="profe"?"Vos: ":""}{ultimo.texto}
                    </p>
                  : <p style={{margin:"3px 0 0",fontSize:13,color:"#94a3b8",fontStyle:"italic"}}>Escribile sobre la clase →</p>
                }
              </div>
            </div>
          </button>
        );
      })}

      <Card style={{background:"#f0f6fa",border:"1.5px solid #a8d4e8",padding:14}}>
        <p style={{margin:0,fontSize:13,color:BL,lineHeight:1.5}}>
          💬 Los chats son privados y están ligados a cada clase.<br/>
          <span style={{fontSize:12,opacity:0.8}}>No está permitido compartir datos de contacto externos.</span>
        </p>
      </Card>
    </div>
  );
}


// ── TOOLTIP ONBOARDING PROFE ──────────────────────────────────────────────────
function OnboardingProfe({ onTerminar, profeNombre="" }) {
  const [paso, setPaso] = useState(0);
  const primerNombre = profeNombre.split(" ")[0] || "profe";
  const pasos = [
    { icon:"👋", titulo:`¡Bienvenido, ${primerNombre}!`, desc:"Este es tu panel de profe. Desde acá vas a gestionar tus clases, disponibilidad, alumnos e ingresos.", color:P },
    { icon:"🗓️", titulo:"Cargá tu disponibilidad", desc:"Andá a Horarios y marcá los bloques en que podés dar clases. Podés elegir si son individuales, grupales o ambas. También podés usar la recurrencia semanal.", color:BL },
    { icon:"📋", titulo:"Tus reservas", desc:"Cuando un alumno reserva una clase, te aparece acá. Podés ver qué necesita trabajar, marcar la clase como realizada y cargar la devolución después.", color:"#15803d" },
    { icon:"✍️", titulo:"Las devoluciones son clave", desc:"Después de cada clase, cargá la devolución del alumno. Los padres y alumnos la ven en su perfil. Genera confianza y fideliza.", color:"#92400e" },
  ];
  const p = pasos[paso];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"32px 24px 48px",width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:20}}>
        <div style={{display:"flex",justifyContent:"center",gap:8}}>
          {pasos.map((_,i)=>(
            <div key={i} style={{width:i===paso?24:8,height:8,borderRadius:99,background:i===paso?P:"#e2e8f0",transition:"all 0.3s"}}/>
          ))}
        </div>
        <div style={{textAlign:"center",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{width:72,height:72,borderRadius:"50%",background:p.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,margin:"0 auto"}}>{p.icon}</div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,color:DK}}>{p.titulo}</h2>
          <p style={{margin:0,fontSize:14,color:"#64748b",lineHeight:1.6}}>{p.desc}</p>
        </div>
        <button onClick={()=>{ if(paso<pasos.length-1) setPaso(paso+1); else onTerminar(); }}
          style={{background:p.color,color:"#fff",border:"none",borderRadius:14,padding:"15px",fontSize:15,fontWeight:800,cursor:"pointer"}}>
          {paso<pasos.length-1?"Siguiente →":"¡Empezar!"}
        </button>
        {paso<pasos.length-1 && (
          <button onClick={onTerminar} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",textDecoration:"underline",padding:0,textAlign:"center"}}>Saltar</button>
        )}
      </div>
    </div>
  );
}

// ── ALERTA DEVOLUCIONES VENCIDAS (> 24hs sin cargar) ─────────────────────────
function AlertaDevolucionesPendientes({ reservas, onVer }) {
  const HOY_ALERT = new Date().toISOString().slice(0,10);
  const pendientes = reservas.filter(r => {
    if (r.devolucion || r.fecha >= HOY_ALERT) return false;
    // Simular que pasaron más de 24hs desde la clase
    const fechaClase = new Date(r.fecha);
    const hoy = new Date(HOY_ALERT);
    const diff = (hoy - fechaClase) / (1000*60*60*24);
    return diff >= 1;
  });
  if (!pendientes.length) return null;
  return (
    <button onClick={onVer} style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:14,padding:"14px 16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,width:"100%"}}>
      <span style={{fontSize:28}}>⚠️</span>
      <div style={{flex:1}}>
        <p style={{margin:0,fontWeight:700,fontSize:14,color:"#dc2626"}}>{pendientes.length} clase{pendientes.length>1?"s":""} sin devolución hace más de 24hs</p>
        <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{pendientes.map(r=>(r.alumno||"?").split(" ")[0]).join(", ")} esperan tu feedback.</p>
      </div>
      <span style={{fontSize:12,fontWeight:700,color:"#dc2626",flexShrink:0}}>Cargar →</span>
    </button>
  );
}

// ── MODAL ALUMNO AUSENTE ──────────────────────────────────────────────────────
function ModalAusente({ reserva, onConfirmar, onCerrar }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#fff",borderRadius:20,padding:24,width:"100%",maxWidth:400,display:"flex",flexDirection:"column",gap:16}}>
        <h3 style={{margin:0,color:DK,fontSize:17}}>👤 Alumno ausente</h3>
        <p style={{margin:0,fontSize:14,color:"#374151",lineHeight:1.6}}>
          ¿Confirmar que <strong>{reserva.alumno}</strong> no se presentó a la clase de <strong>{reserva.materia}</strong> del {fmt(reserva.fecha)}?
        </p>
        <div style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:12,padding:"12px 14px"}}>
          <p style={{margin:0,fontSize:13,color:"#92400e"}}>
            ⚠️ Se descontará la hora completa del saldo del alumno.<br/>
            Vos cobrás el <strong>{CFG.penalizacionPct}% de tu tarifa</strong> ({reserva.tipo==="grupal"?`$${calcSeñaProfe(reserva).toLocaleString("es-AR")} ($${SEÑA_GRP.toLocaleString("es-AR")} × ${reserva.alumnosGrupo||1} alumno${(reserva.alumnosGrupo||1)>1?"s":""}${(reserva.horas||1)>1?` × ${reserva.horas} hs`:""})`:`$${calcSeñaProfe(reserva).toLocaleString("es-AR")}`}).
          </p>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCerrar} style={{flex:1,background:"#f1f5f9",border:"none",borderRadius:10,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",color:"#475569"}}>
            Cancelar
          </button>
          <button onClick={onConfirmar} style={{flex:1,background:"#dc2626",border:"none",borderRadius:10,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",color:"#fff"}}>
            Confirmar ausencia
          </button>
        </div>
      </div>
    </div>
  );
}

// ── APP PRINCIPAL ────────────────────────────────────────────────────────────
function AppProfeMain({ user, onLogout }) {
  const [screen,setScreen] = useState("inicio");
  const [reservas,setReservas] = useState([]);
  const [dispon,setDispon] = useState({});
  const [profeData,setProfeData] = useState(null);
  const [modalR,setModalR] = useState(null);
  const [modalRecurrente,setModalRecurrente] = useState(false);
  const [onboardingVisto,setOnboardingVisto] = useState(false);
  const [modalAusente,setModalAusente] = useState(null);
  const [modalReprogProfe,setModalReprogProfe] = useState(null);

  const normReserva = r => ({
    ...r,
    alumno: r.alumnos?.profiles?.nombre || r.alumno || "—",
    alumnosGrupo: r.alumnos_grupo ?? r.alumnosGrupo ?? null,
    realizada: r.estado === "realizada",
    alumnoAusente: r.estado === "ausente",
    marcadaEn: r.marcada_en || r.marcadaEn || null,
  });

  useEffect(() => {
    if (!user) return;
    getReservasProfe(user.id)
      .then(data => setReservas((data||[]).map(normReserva)))
      .catch(err => console.error("Error al cargar reservas del profe:", err));
    getDisponibilidad(user.id)
      .then(data => setDispon((data||[]).reduce((acc, b) => {
        if (!acc[b.fecha]) acc[b.fecha] = {};
        acc[b.fecha][b.hora] = b.tipo;
        return acc;
      }, {})))
      .catch(err => console.error("Error al cargar disponibilidad:", err));
    getProfesAdmin()
      .then(data => setProfeData((data||[]).find(p => p.id === user.id) || null))
      .catch(err => console.error("Error al cargar datos del profe:", err));
  }, [user]);

  const marcarAusente = async (reserva) => {
    try {
      await marcarReserva(reserva.id, "ausente");
      const ts = new Date().toLocaleString("es-AR");
      setReservas(prev=>prev.map(r=>r.id===reserva.id?{...r,alumnoAusente:true,realizada:false,marcadaEn:ts}:r));
    } catch(err) { console.error("Error al marcar ausente:", err); }
    setModalAusente(null);
  };

  const marcarRealizada = async (reserva) => {
    try {
      await marcarReserva(reserva.id, "realizada");
      const ahora = new Date();
      const ts = `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,"0")}-${String(ahora.getDate()).padStart(2,"0")} ${String(ahora.getHours()).padStart(2,"0")}:${String(ahora.getMinutes()).padStart(2,"0")}`;
      setReservas(prev=>prev.map(r=>r.id===reserva.id?{...r,realizada:true,marcadaEn:ts}:r));
    } catch(err) { console.error("Error al marcar realizada:", err); }
  };


  const nav = [
    {id:"inicio",icon:"🏠",label:"Inicio"},
    {id:"reservas",icon:"📋",label:"Reservas"},
    {id:"mensajes",icon:"💬",label:"Mensajes"},
    {id:"disponibilidad",icon:"🗓️",label:"Horarios"},
    {id:"ingresos",icon:"💰",label:"Ingresos"},
    {id:"perfil",icon:"👤",label:"Perfil"},
  ];

  const handleDisponChange = (updater) => {
    const next = typeof updater === 'function' ? updater(dispon) : updater;
    Object.entries(next).forEach(([fecha, horas]) => {
      Object.entries(horas).forEach(([hora, tipo]) => {
        if (dispon[fecha]?.[hora] !== tipo)
          setBloque(user.id, fecha, hora, tipo).catch(err => console.error("Error setBloque:", err));
      });
    });
    Object.entries(dispon).forEach(([fecha, horas]) => {
      Object.entries(horas).forEach(([hora]) => {
        if (!next[fecha]?.[hora])
          borrarBloque(user.id, fecha, hora).catch(err => console.error("Error borrarBloque:", err));
      });
    });
    setDispon(next);
  };

  const guardar = async (reserva, texto) => {
    try {
      await cargarDevolucion(reserva.id, texto, null);
      setReservas(prev=>prev.map(r=>r.id===reserva.id?{...r,devolucion:texto}:r));
    } catch(err) { console.error("Error al guardar devolución:", err); }
    setModalR(null);
  };

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto",position:"relative"}}>
      <div style={{background:DK,padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Logo size={28}/>
          <div>
            <span style={{fontWeight:800,fontSize:15,color:"#fff"}}>PuntoClases</span>
            <span style={{marginLeft:8,fontSize:11,color:"rgba(255,255,255,0.45)",fontWeight:500}}>/ Profe</span>
          </div>
        </div>
        <div onClick={()=>setScreen('perfil')} style={{cursor:'pointer'}}><Av i={initialsProfe(profeData?.profiles?.nombre||"")} size={32} color={P}/></div>
      </div>

      <div style={{flex:1,padding:"16px 16px 80px"}}>
        {!onboardingVisto && <OnboardingProfe onTerminar={()=>setOnboardingVisto(true)} profeNombre={profeData?.profiles?.nombre||""}/>}
        {screen==="inicio" && <ProfeInicioPanel onNav={setScreen} reservas={reservas} profeNombre={profeData?.profiles?.nombre||""}/>}
        {screen==="reservas" && <Reservas reservas={reservas} onDevolucion={r=>setModalR(r)} onMarcar={marcarRealizada} onAusente={r=>setModalAusente(r)} onReprogramar={r=>setModalReprogProfe(r)}/>}
        {screen==="disponibilidad" && <Disponibilidad dispon={dispon} setDispon={handleDisponChange} onRecurrente={()=>setModalRecurrente(true)}/>}
        {screen==="alumnos" && <Alumnos reservas={reservas} onDevolucion={r=>setModalR(r)}/>}
        {screen==="ingresos" && <Ingresos reservas={reservas}/>}
        {screen==="mensajes" && <ChatProfe reservas={reservas} userId={user?.id}/>}
        {screen==="perfil" && <PerfilProfe profeData={profeData} onLogoutProfe={onLogout}/>}
      </div>

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid #e2e8f0",display:"flex",padding:"8px 0 12px",zIndex:10}}>
        {nav.map(n=>(
          <button key={n.id} onClick={()=>setScreen(n.id)}
            style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>{n.icon}</span>
            <span style={{fontSize:10,fontWeight:screen===n.id?700:400,color:screen===n.id?P:"#94a3b8"}}>{n.label}</span>
            {screen===n.id && <div style={{width:4,height:4,borderRadius:"50%",background:P}}/>}
          </button>
        ))}
      </div>

      {modalR && <ModalDevolucion reserva={modalR} onGuardar={(t)=>guardar(modalR,t)} onCerrar={()=>setModalR(null)}/>}
      {modalRecurrente && <ModalRecurrente dispon={dispon} setDispon={handleDisponChange} onCerrar={()=>setModalRecurrente(false)}/>}
      {modalAusente && <ModalAusente reserva={modalAusente} onConfirmar={()=>marcarAusente(modalAusente)} onCerrar={()=>setModalAusente(null)}/>}
      {modalReprogProfe && <ModalReprogramarProfe
          reserva={modalReprogProfe}
          dispon={dispon}
          onActualizar={r => setReservas(prev => prev.map(x => x.id === r.id ? normReserva(r) : x))}
          onCerrar={()=>setModalReprogProfe(null)}
        />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PANEL ADMIN
// ════════════════════════════════════════════════════════════════════


const iniAdmin = n => n.split(" ").map(x=>x[0]).join("").slice(0,2);

// ── DATA ─────────────────────────────────────────────────────────────────────
// ── DATA — admin @seed ───────────────────────────────────────────────────────
// Tarifas — TODAS derivadas de CFG (fuente única). No duplicar números acá.
const PRECIO_IND = CFG.precioInd;            // alumno paga por clase individual
const PRECIO_GRP = precioGrpHora();          // alumno paga por clase grupal (por persona)
const TARIFA_PROFE_IND = CFG.tarifaProfeInd; // profe cobra por clase individual
const TARIFA_PROFE_GRP = CFG.tarifaProfeGrp; // profe cobra por alumno en grupal
const SEÑA_IND = Math.round(CFG.tarifaProfeInd * CFG.penalizacionPct / 100); // profe cobra si cancelan sin aviso (individual)
const SEÑA_GRP = Math.round(CFG.tarifaProfeGrp * CFG.penalizacionPct / 100); // profe cobra por alumno si cancelan sin aviso (grupal)

const ALUMNOS_DATA = [
  { id:1, nombre:"Lucía Fernández",  mail:"lucia@gmail.com",  saldo:6.5, vence:"2026-07-18", compras:344000, clases:10, activo:true,  suspendido:false },
  { id:2, nombre:"Tomás Rodríguez",  mail:"tomas@gmail.com",  saldo:2.0, vence:"2026-06-20", compras:136000, clases:4,  activo:true,  suspendido:false },
  { id:3, nombre:"Sofía Pérez",      mail:"sofia@gmail.com",  saldo:0,   vence:"2026-06-10", compras:208000, clases:6,  activo:false, suspendido:false },
  { id:4, nombre:"Martín López",     mail:"martin@gmail.com", saldo:4.0, vence:"2026-07-05", compras:72000,  clases:2,  activo:true,  suspendido:false },
  { id:5, nombre:"Valentina Cruz",   mail:"vale@gmail.com",   saldo:8.0, vence:"2026-07-22", compras:192000, clases:1,  activo:true,  suspendido:false },
];

const PROFES_DATA = [
  { id:1, nombre:"David González", mail:"david@puntoclases.com",
    materias:["Matemática","Física","Química","Álgebra"],
    clasesDadas:23, horasDadas:28, activo:true, suspendido:false, pagadoMes:false,
    monotributo:true },
];

const RESERVAS_DATA = [
  { id:1,  alumno:"Lucía Fernández",  materia:"Matemática", fecha:"2026-06-09", hora:"09:00", horas:1, modalidad:"Presencial", tipo:"individual", estado:"confirmada",  monto:20000, alumnosGrupo:null },
  { id:2,  alumno:"Lucía Fernández",  materia:"Física",     fecha:"2026-06-12", hora:"17:00", horas:1, modalidad:"Virtual",    tipo:"individual", estado:"confirmada",  monto:20000, alumnosGrupo:null },
  { id:3,  alumno:"Tomás Rodríguez",  materia:"Química",    fecha:"2026-06-09", hora:"11:00", horas:1, modalidad:"Presencial", tipo:"grupal",     estado:"confirmada",  monto:48000, alumnosGrupo:3 },
  { id:4,  alumno:"Lucía Fernández",  materia:"Matemática", fecha:"2026-05-28", hora:"10:00", horas:1, modalidad:"Presencial", tipo:"individual", estado:"realizada",   monto:20000, alumnosGrupo:null },
  { id:5,  alumno:"Sofía Pérez",      materia:"Física",     fecha:"2026-05-26", hora:"14:00", horas:2, modalidad:"Virtual",    tipo:"individual", estado:"realizada",   monto:40000, alumnosGrupo:null },
  { id:6,  alumno:"Tomás Rodríguez",  materia:"Álgebra",    fecha:"2026-05-22", hora:"10:00", horas:1, modalidad:"Presencial", tipo:"individual", estado:"realizada",   monto:20000, alumnosGrupo:null },
  { id:7,  alumno:"Sofía Pérez",      materia:"Química",    fecha:"2026-05-15", hora:"09:00", horas:1, modalidad:"Presencial", tipo:"grupal",     estado:"realizada",   monto:32000, alumnosGrupo:2 },
  { id:8,  alumno:"Martín López",     materia:"Física",     fecha:"2026-05-10", hora:"11:00", horas:2, modalidad:"Virtual",    tipo:"individual", estado:"realizada",   monto:40000, alumnosGrupo:null },
  { id:9,  alumno:"Valentina Cruz",   materia:"Matemática", fecha:"2026-06-19", hora:"15:00", horas:1, modalidad:"Virtual",    tipo:"individual", estado:"confirmada",  monto:20000, alumnosGrupo:null },
  { id:10, alumno:"Lucía Fernández",  materia:"Química",    fecha:"2026-06-02", hora:"14:00", horas:1, modalidad:"Presencial", tipo:"grupal",     estado:"realizada",   monto:64000, alumnosGrupo:4 },
  { id:11, alumno:"Martín López",     materia:"Matemática", fecha:"2026-06-20", hora:"16:00", horas:1, modalidad:"Virtual",    tipo:"individual", estado:"pendiente",   monto:20000, alumnosGrupo:null },
  { id:12, alumno:"Valentina Cruz",   materia:"Física",     fecha:"2026-05-30", hora:"10:00", horas:1, modalidad:"Presencial", tipo:"individual", estado:"cancelada",   monto:20000, alumnosGrupo:null },
  { id:13, alumno:"Sofía Pérez",      materia:"Álgebra",    fecha:"2026-06-18", hora:"11:00", horas:1, modalidad:"Virtual",    tipo:"individual", estado:"rechazada",   monto:20000, alumnosGrupo:null },
];

const CONFIG_INIT = {
  precioInd: CFG.precioInd,
  precioGrp: precioGrpHora(),
  factorGrupal: CFG.factorGrupal,
  tarifaProfeInd: CFG.tarifaProfeInd,
  tarifaProfeGrp: CFG.tarifaProfeGrp,
  vencimiento: CFG.vencimientoDias,
  penalizacionPct: CFG.penalizacionPct,
  coworkPorAlumno: CFG.coworkPorAlumno, // $ por alumno PRESENCIAL por clase
  packs: CFG.packs.map(p => ({ ...p, precio: precioPackTotal(p.horas, p.descuento) })),
};

// Mapeo DB row (snake_case) → cfg state; con fallback a CFG si la columna no existe
const normCfg = (row) => {
  const pi = row.precio_ind ?? CFG.precioInd;
  const fg = row.factor_grupal ?? CFG.factorGrupal;
  return {
    precioInd: pi,
    precioGrp: Math.round(pi * fg),
    factorGrupal: fg,
    tarifaProfeInd: row.tarifa_profe_ind ?? CFG.tarifaProfeInd,
    tarifaProfeGrp: row.tarifa_profe_grp ?? CFG.tarifaProfeGrp,
    vencimiento: row.vencimiento_dias ?? CFG.vencimientoDias,
    penalizacionPct: row.penalizacion_pct ?? CFG.penalizacionPct,
    coworkPorAlumno: row.cowork_por_alumno ?? CFG.coworkPorAlumno,
    packs: CONFIG_INIT.packs, // packs vienen de tabla separada (getPacks)
  };
};
// Mapeo cfg state → objeto para updateConfig (solo campos escalares del admin)
const cfgADB = (cfg) => ({
  precio_ind: cfg.precioInd,
  factor_grupal: cfg.factorGrupal,
  tarifa_profe_ind: cfg.tarifaProfeInd,
  tarifa_profe_grp: cfg.tarifaProfeGrp,
  vencimiento_dias: cfg.vencimiento,
  penalizacion_pct: cfg.penalizacionPct,
  cowork_por_alumno: cfg.coworkPorAlumno,
});

// ── HELPERS ──────────────────────────────────────────────────────────────────
const diasHasta = iso => { if (!iso) return 0; const [y,m,d]=iso.split("-"); const hoy=new Date(); hoy.setHours(0,0,0,0); return Math.ceil((new Date(+y,+m-1,+d)-hoy)/(1000*60*60*24)); };
const MESES_CORTO = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ════════════════════════════════════════════════════════════════════════════
// 1. DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function Dashboard({ alumnos, profes, reservas, cfg, onNav, onLogout }) {
  const realizadas = reservas.filter(r=>r.estado==="realizada");
  const bruto = realizadas.reduce((a,r)=>a+r.monto,0);
  const pagoProfe = sumPagoProfe(realizadas, cfg);
  // Cowork: $ fijo por alumno por clase, SOLO presenciales (las virtuales no usan el espacio).
  const costoCowork = sumCowork(realizadas, cfg);
  const neto = bruto - pagoProfe - costoCowork;

  // Alertas accionables
  const alertas = [];
  const profeSinPago = profes.filter(p=>!p.pagadoMes);
  if (profeSinPago.length) alertas.push({
    tipo:"danger", icon:"💸", titulo:`Pago pendiente a ${profeSinPago.length} profe${profeSinPago.length>1?"s":""}`,
    sub:"Liquidación del mes sin registrar", accion:()=>onNav("personas"), cta:"Ver profes"
  });
  const vencenProx = alumnos.filter(a=>{ const d=diasHasta(a.vence); return d<=10&&d>0&&a.saldo>0; });
  if (vencenProx.length) alertas.push({
    tipo:"warning", icon:"⏰", titulo:`${vencenProx.length} alumno${vencenProx.length>1?"s":""} con horas por vencer`,
    sub:vencenProx.map(a=>a.nombre.split(" ")[0]).join(", ")+" — oportunidad de venta",
    accion:()=>onNav("personas"), cta:"Ver alumnos"
  });
  const sinSaldo = alumnos.filter(a=>a.saldo===0&&a.activo);
  if (sinSaldo.length) alertas.push({
    tipo:"info", icon:"📦", titulo:`${sinSaldo.length} alumno${sinSaldo.length>1?"s":""} sin horas`,
    sub:"Podrían necesitar un nuevo pack", accion:()=>onNav("personas"), cta:"Contactar"
  });

  const porMes = [4,5].map(m=>({
    mes:MESES[m],
    val:realizadas.filter(r=>parseInt(r.fecha.split("-")[1])-1===m).reduce((a,r)=>a + r.monto - calcPagoProfe(r, cfg),0)
  }));
  const maxVal = Math.max(...porMes.map(m=>m.val),1);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* Hero financiero */}
      <div style={{background:`linear-gradient(135deg,${DK} 0%,#3a3a3a 100%)`,borderRadius:20,padding:"22px 20px",color:"#fff",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-30,right:-30,width:120,height:120,borderRadius:"50%",background:"rgba(217,79,61,0.15)"}}/>
        <p style={{margin:"0 0 4px",fontSize:11,opacity:0.5,textTransform:"uppercase",letterSpacing:1}}>Tu ganancia este mes</p>
        <p style={{margin:"0 0 16px",fontSize:34,fontWeight:800,color:neto>=0?"#fff":"#fca5a5"}}>${neto.toLocaleString("es-AR")}</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          {[
            {l:"Facturado",v:`$${(bruto/1000).toFixed(0)}k`,op:0.9},
            {l:"Pagos profes",v:`-$${(pagoProfe/1000).toFixed(0)}k`,op:0.65},
            {l:"Cowork",v:`-$${(costoCowork/1000).toFixed(0)}k`,op:0.65},
          ].map(x=>(
            <div key={x.l} style={{background:"rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
              <p style={{margin:0,fontSize:15,fontWeight:800,opacity:x.op}}>{x.v}</p>
              <p style={{margin:0,fontSize:10,opacity:0.5}}>{x.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas accionables */}
      {alertas.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <p style={{margin:0,fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>⚡ Requieren atención</p>
          {alertas.map((a,i)=>(
            <button key={i} onClick={a.accion} style={{
              background:a.tipo==="danger"?PL:a.tipo==="warning"?AML:"#f0f6fa",
              border:`1.5px solid ${a.tipo==="danger"?PB:a.tipo==="warning"?AMB:"#a8d4e8"}`,
              borderRadius:14,padding:"12px 14px",cursor:"pointer",textAlign:"left",
              display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:26,flexShrink:0}}>{a.icon}</span>
              <div style={{flex:1}}>
                <p style={{margin:0,fontWeight:700,fontSize:13,color:a.tipo==="danger"?P:a.tipo==="warning"?AM:BL}}>{a.titulo}</p>
                <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{a.sub}</p>
              </div>
              <span style={{fontSize:12,fontWeight:700,color:a.tipo==="danger"?P:a.tipo==="warning"?AM:BL,flexShrink:0}}>{a.cta} →</span>
            </button>
          ))}
        </div>
      )}

      {/* Stats del día */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[
          {icon:"👩‍🎓",label:"Alumnos activos",value:alumnos.filter(a=>a.activo).length,sub:`${alumnos.length} total`,bg:PL,col:P},
          {icon:"📚",label:"Clases realizadas",value:realizadas.length,sub:`${reservas.filter(r=>r.estado==="confirmada").length} confirmadas`,bg:GRL,col:GR},
          {icon:"👨‍🏫",label:"Profes activos",value:profes.filter(p=>p.activo).length,sub:"en el sistema",bg:"#fefce8",col:AM},
          {icon:"💬",label:"Clases este mes",value:realizadas.filter(r=>r.fecha.startsWith("2026-06")).length,sub:"Junio 2026",bg:"#f0f6fa",col:BL},
        ].map(s=>(
          <div key={s.label} style={{background:s.bg,borderRadius:14,padding:"14px 12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
              <span style={{fontSize:22}}>{s.icon}</span>
              <span style={{fontSize:24,fontWeight:800,color:s.col}}>{s.value}</span>
            </div>
            <p style={{margin:0,fontSize:12,fontWeight:600,color:DK}}>{s.label}</p>
            <p style={{margin:"2px 0 0",fontSize:11,color:"#94a3b8"}}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Mini gráfico ingresos netos */}
      <Card>
        <p style={{margin:"0 0 12px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:0.8}}>Ingreso neto por mes</p>
        <div style={{display:"flex",gap:10,alignItems:"flex-end",height:80}}>
          {porMes.map(m=>(
            <div key={m.mes} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <span style={{fontSize:11,fontWeight:700,color:P}}>${(m.val/1000).toFixed(0)}k</span>
              <div style={{width:"100%",background:PL,borderRadius:"6px 6px 0 0",height:`${Math.max((m.val/maxVal)*65,8)}px`,transition:"height 0.4s"}}/>
              <span style={{fontSize:12,color:"#64748b",fontWeight:600}}>{m.mes}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Accesos rápidos */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[
          {icon:"👥",label:"Gestionar personas",sc:"personas",bg:PL,border:PB},
          {icon:"📋",label:"Ver operaciones",sc:"operaciones",bg:GRL,border:GRB},
          {icon:"💰",label:"Finanzas",sc:"finanzas",bg:"#fefce8",border:AMB},
          {icon:"⚙️",label:"Configuración",sc:"config",bg:"#f0f6fa",border:"#a8d4e8"},
        ].map(a=>(
          <button key={a.sc} onClick={()=>onNav(a.sc)}
            style={{background:a.bg,border:`1.5px solid ${a.border}`,borderRadius:14,padding:"16px 12px",cursor:"pointer",textAlign:"left",display:"flex",flexDirection:"column",gap:6}}>
            <span style={{fontSize:24}}>{a.icon}</span>
            <span style={{fontSize:14,fontWeight:700,color:DK}}>{a.label}</span>
          </button>
        ))}
      </div>

      <button onClick={onLogout} style={{background:"none",border:"1.5px solid #fecaca",borderRadius:12,padding:"13px",fontSize:14,fontWeight:700,color:"#dc2626",cursor:"pointer",width:"100%",marginTop:4}}>
        Cerrar sesión
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. PERSONAS (Alumnos + Profes en tabs)
// ════════════════════════════════════════════════════════════════════════════
function Personas({ alumnos, setAlumnos, profes, setProfes, reservas }) {
  const [tab, setTab] = useState("alumnos");
  const [sel, setSel] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  const [confirmar, setConfirmar] = useState(null); // {accion, label, onOk}
  const [nuevoProfe, setNuevoProfe] = useState(null); // form de alta de profe

  const accionAlumno = (id, accion) => {
    if (accion === "addHoras") {
      addHorasAdmin(id)
        .then(saldoNuevo => {
          setAlumnos(prev => prev.map(a => a.id === id ? {...a, saldo: saldoNuevo} : a));
        })
        .catch(err => {
          console.error("Error addHoras:", err);
          alert("Error al agregar hora: " + (err.message || "intentá de nuevo"));
        });
      return;
    }
    setAlumnos(prev => prev.map(a => {
      if (a.id !== id) return a;
      if (accion === "suspender") {
        actualizarAlumno(id, {suspendido: !a.suspendido}).catch(err => console.error("Error suspender alumno:", err));
        return {...a, suspendido: !a.suspendido};
      }
      if (accion === "extenderVenc") {
        const nueva = new Date(); nueva.setDate(nueva.getDate() + 30);
        const iso = nueva.toISOString().slice(0, 10);
        actualizarAlumno(id, {vencimiento: iso}).catch(err => console.error("Error extenderVenc:", err));
        return {...a, vence: iso};
      }
      return a;
    }));
  };

  const accionProfe = (id, accion) => {
    setProfes(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (accion === "suspender") {
        actualizarProfe(id, {suspendido: !p.suspendido}).catch(err => console.error("Error suspender profe:", err));
        return {...p, suspendido: !p.suspendido};
      }
      if (accion === "pausar") {
        actualizarProfe(id, {activo: !p.activo}).catch(err => console.error("Error pausar profe:", err));
        return {...p, activo: !p.activo};
      }
      if (accion === "aprobar") {
        actualizarProfe(id, {activo: true}).catch(err => console.error("Error aprobar profe:", err));
        return {...p, activo: true};
      }
      if (accion === "pagar") {
        actualizarProfe(id, {pagado_mes: true}).catch(err => console.error("Error pagar profe:", err));
        return {...p, pagadoMes: true};
      }
      return p;
    }));
  };

  // ── Detalle alumno ──────────────────────────────────────────────────────
  if (sel && tab==="alumnos") {
    const a = alumnos.find(x=>x.id===sel);
    const dias = diasHasta(a.vence);
    return (
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {confirmar && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div style={{background:"#fff",borderRadius:20,padding:24,width:"100%",maxWidth:360}}>
              <p style={{margin:"0 0 8px",fontWeight:800,fontSize:16,color:DK}}>¿Confirmar acción?</p>
              <p style={{margin:"0 0 20px",fontSize:14,color:"#64748b"}}>{confirmar.label}</p>
              <div style={{display:"flex",gap:10}}>
                <Btn onClick={()=>setConfirmar(null)} variant="secondary" full style={{flex:1}}>Cancelar</Btn>
                <Btn onClick={()=>{confirmar.onOk();setConfirmar(null);}} variant="danger" full style={{flex:1}}>Confirmar</Btn>
              </div>
            </div>
          </div>
        )}
        <button onClick={()=>setSel(null)} style={{background:"none",border:"none",cursor:"pointer",textAlign:"left",fontSize:14,color:P,fontWeight:700,padding:0}}>← Alumnos</button>

        <Card>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <Av i={iniAdmin(a.nombre)} color={a.suspendido?"#94a3b8":P} size={52}/>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:800,fontSize:17,color:DK}}>{a.nombre}</p>
              <p style={{margin:"3px 0 6px",fontSize:13,color:"#64748b"}}>{a.mail}</p>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {a.suspendido && <Badge bg="#fff5f5" col="#dc2626">🚫 Suspendido</Badge>}
                {!a.suspendido && <Badge bg={a.activo?GRL:PL} col={a.activo?GR:P}>{a.activo?"Activo":"Inactivo"}</Badge>}
                <Badge bg={dias<=5?"#fff5f5":dias<=10?AML:GRL} col={dias<=5?"#dc2626":dias<=10?AM:GR}>
                  Vence en {dias}d
                </Badge>
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[
              {n:`${a.saldo}hs`,l:"Saldo",bg:a.saldo>0?GRL:PL,col:a.saldo>0?GR:P},
              {n:a.clases,l:"Clases",bg:"#f8fafc",col:DK},
              {n:`$${(a.compras/1000).toFixed(0)}k`,l:"Invertido",bg:"#fefce8",col:AM},
            ].map(s=>(
              <div key={s.l} style={{background:s.bg,borderRadius:10,padding:"10px",textAlign:"center"}}>
                <p style={{margin:0,fontSize:18,fontWeight:800,color:s.col}}>{s.n}</p>
                <p style={{margin:0,fontSize:10,color:"#64748b"}}>{s.l}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Acciones */}
        <Card>
          <p style={{margin:"0 0 12px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Acciones</p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <Btn variant="secondary" full onClick={()=>accionAlumno(a.id,"addHoras")}>➕ Agregar 1 hora al saldo</Btn>
            <Btn variant="secondary" full onClick={()=>accionAlumno(a.id,"extenderVenc")}>📅 Extender vencimiento 30 días</Btn>
            <Btn variant="warning" full onClick={()=>accionAlumno(a.id,"suspender")}>
              {a.suspendido?"🔓 Reactivar cuenta":"⏸ Suspender temporalmente"}
            </Btn>
            <Btn variant="danger" full onClick={()=>setConfirmar({
              label:`¿Dar de baja la cuenta de ${a.nombre}? Quedará inactiva y no podrá iniciar sesión.`,
              onOk:() => {
                actualizarAlumno(a.id, { activo: false })
                  .catch(err => console.error("Error al dar de baja alumno:", err));
                setAlumnos(prev => prev.filter(x => x.id !== a.id));
                setSel(null);
              }
            })}>🗑 Dar de baja cuenta</Btn>
          </div>
        </Card>
      </div>
    );
  }

  // ── Detalle profe ───────────────────────────────────────────────────────
  if (sel && tab==="profes") {
    const p = profes.find(x=>x.id===sel);
    const reservasProfe = reservas.filter(r=>r.estado==="realizada"&&r.profe_id===p.id);
    const porCobrar = sumPagoProfe(reservasProfe);
    return (
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <button onClick={()=>setSel(null)} style={{background:"none",border:"none",cursor:"pointer",textAlign:"left",fontSize:14,color:P,fontWeight:700,padding:0}}>← Profes</button>

        <Card>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <Av i={iniAdmin(p.nombre)} color={p.suspendido?"#94a3b8":P} size={52}/>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:800,fontSize:17,color:DK}}>{p.nombre}</p>
              <p style={{margin:"3px 0 6px",fontSize:13,color:"#64748b"}}>{p.mail}</p>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {p.suspendido && <Badge bg="#fff5f5" col="#dc2626">🚫 Suspendido</Badge>}
                {!p.suspendido && <Badge bg={p.activo?GRL:p.clasesDadas===0?"#f5f3ff":"#fefce8"} col={p.activo?GR:p.clasesDadas===0?"#7c3aed":AM}>{p.activo?"Activo":p.clasesDadas===0?"Pendiente de aprobación":"Pausado"}</Badge>}
                <Badge bg={p.monotributo?GRL:"#fff5f5"} col={p.monotributo?GR:"#dc2626"}>
                  {p.monotributo?"✓ Monotributista":"⚠️ Sin monotributo"}
                </Badge>
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[
              {n:p.clasesDadas,l:"Clases",bg:GRL,col:GR},
              {n:`${p.horasDadas}hs`,l:"Horas",bg:"#f0f6fa",col:BL},
              {n:`$${(porCobrar/1000).toFixed(0)}k`,l:"A cobrar",bg:PL,col:P},
            ].map(s=>(
              <div key={s.l} style={{background:s.bg,borderRadius:10,padding:"10px",textAlign:"center"}}>
                <p style={{margin:0,fontSize:18,fontWeight:800,color:s.col}}>{s.n}</p>
                <p style={{margin:0,fontSize:10,color:"#64748b"}}>{s.l}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Liquidación */}
        <Card style={{border:`1.5px solid ${p.pagadoMes?GRB:PB}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <p style={{margin:0,fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Liquidación junio</p>
            {p.pagadoMes && <Badge bg={GRL} col={GR}>✓ Pagado</Badge>}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>Total a transferir</p>
            <p style={{margin:0,fontWeight:800,fontSize:22,color:P}}>${porCobrar.toLocaleString("es-AR")}</p>
          </div>
          {!p.pagadoMes
            ? <Btn variant="success" full onClick={()=>accionProfe(p.id,"pagar")}>💸 Registrar pago</Btn>
            : <p style={{margin:0,fontSize:13,color:GR,textAlign:"center"}}>✓ Pago registrado este mes</p>
          }
        </Card>

        {/* Detalle de clases dadas */}
        <Card>
          <p style={{margin:"0 0 10px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Clases dadas ({reservasProfe.length} realizadas)</p>
          {reservasProfe.length===0 && <p style={{margin:0,fontSize:13,color:"#94a3b8"}}>Todavía no tiene clases realizadas.</p>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {reservasProfe.sort((a,b)=>b.fecha.localeCompare(a.fecha)).map(r=>(
              <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f8fafc",borderRadius:10,padding:"10px 12px"}}>
                <div style={{flex:1}}>
                  <p style={{margin:0,fontSize:13,fontWeight:700,color:DK}}>{r.materia} — {r.alumno}</p>
                  <p style={{margin:"2px 0 0",fontSize:11,color:"#64748b"}}>{fmt(r.fecha)} · {r.hora} · {r.horas}hs · {r.tipo==="grupal"?`👥 grupal (${r.alumnosGrupo})`:"👤 individual"}</p>
                </div>
                <span style={{fontSize:13,fontWeight:800,color:GR}}>${calcPagoProfe(r).toLocaleString("es-AR")}</span>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:12}}>
            {["realizada","confirmada","pendiente","cancelada","rechazada"].map(est=>{
              const n = reservas.filter(r=>r.estado===est).length;
              if(!n) return null;
              const c={realizada:[GRL,GR],confirmada:[PL,P],pendiente:["#fefce8","#92400e"],cancelada:["#f1f5f9","#64748b"],rechazada:["#fff5f5","#dc2626"]}[est];
              return <Badge key={est} bg={c[0]} col={c[1]}>{est}: {n}</Badge>;
            })}
          </div>
        </Card>

        {/* Acciones */}
        <Card>
          <p style={{margin:"0 0 12px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Acciones</p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {!p.activo && (
              <Btn variant="success" full onClick={()=>accionProfe(p.id,"aprobar")}>✅ Aprobar profe</Btn>
            )}
            <Btn variant="warning" full onClick={()=>accionProfe(p.id,"pausar")}>
              {p.activo?"⏸ Pausar disponibilidad (vacaciones)":"▶️ Reactivar disponibilidad"}
            </Btn>
            <Btn variant="warning" full onClick={()=>accionProfe(p.id,"suspender")}>
              {p.suspendido?"🔓 Levantar suspensión":"🚫 Suspender cuenta"}
            </Btn>
          </div>
        </Card>
      </div>
    );
  }

  // ── Lista ───────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Personas</h3>

      {/* Tabs */}
      <div style={{display:"flex",background:"#f1f5f9",borderRadius:12,padding:4,gap:4}}>
        {[{v:"alumnos",l:`👩‍🎓 Alumnos (${alumnos.length})`},{v:"profes",l:`👨‍🏫 Profes (${profes.length})`}].map(t=>(
          <button key={t.v} onClick={()=>{setTab(t.v);setSel(null);setFiltro("todos");}}
            style={{flex:1,background:tab===t.v?"#fff":"transparent",border:"none",borderRadius:10,padding:"10px",fontSize:13,fontWeight:700,color:tab===t.v?P:"#64748b",cursor:"pointer",boxShadow:tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* Filtros alumnos */}
      {tab==="alumnos" && (
        <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
          {[
            {v:"todos",l:"Todos"},
            {v:"conSaldo",l:"Con saldo"},
            {v:"sinSaldo",l:"Sin saldo"},
            {v:"vencen",l:"⏰ Vencen pronto"},
            {v:"suspendidos",l:"🚫 Suspendidos"},
          ].map(f=>(
            <button key={f.v} onClick={()=>setFiltro(f.v)}
              style={{flexShrink:0,background:filtro===f.v?P:PL,color:filtro===f.v?"#fff":P,border:`1.5px solid ${filtro===f.v?P:PB}`,borderRadius:99,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {f.l}
            </button>
          ))}
        </div>
      )}

      {/* Filtros profes */}
      {tab==="profes" && (
        <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
          {[
            {v:"todos",l:`Todos (${profes.length})`},
            {v:"activos",l:"Activos"},
            {v:"pendientes",l:`⏳ Pendientes (${profes.filter(p=>!p.activo).length})`},
          ].map(f=>(
            <button key={f.v} onClick={()=>setFiltro(f.v)}
              style={{flexShrink:0,background:filtro===f.v?P:PL,color:filtro===f.v?"#fff":P,border:`1.5px solid ${filtro===f.v?P:PB}`,borderRadius:99,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {f.l}
            </button>
          ))}
        </div>
      )}

      {/* Lista alumnos */}
      {tab==="alumnos" && alumnos
        .filter(a => a.activo !== false)
        .filter(a=>{
          if (filtro==="conSaldo") return a.saldo>0;
          if (filtro==="sinSaldo") return a.saldo===0;
          if (filtro==="vencen") { const d=diasHasta(a.vence); return d<=10&&d>0; }
          if (filtro==="suspendidos") return a.suspendido;
          return true;
        })
        .map(a=>{
          const dias = diasHasta(a.vence);
          return (
            <button key={a.id} onClick={()=>setSel(a.id)}
              style={{background:a.suspendido?"#f8fafc":"#fff",border:`1.5px solid ${a.suspendido?"#fecaca":dias<=10&&a.saldo>0?AMB:"#e2e8f0"}`,borderRadius:14,padding:"14px",cursor:"pointer",textAlign:"left",boxShadow:"0 1px 6px rgba(0,0,0,0.04)"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <Av i={iniAdmin(a.nombre)} color={a.suspendido?"#94a3b8":P} size={44}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <p style={{margin:0,fontWeight:700,fontSize:14,color:a.suspendido?"#94a3b8":DK}}>{a.nombre}</p>
                    <span style={{fontSize:18,color:"#94a3b8"}}>›</span>
                  </div>
                  <p style={{margin:"2px 0 6px",fontSize:12,color:"#94a3b8"}}>{a.mail}</p>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {a.suspendido && <Badge bg="#fff5f5" col="#dc2626">🚫 Suspendido</Badge>}
                    <Badge bg={a.saldo>0?GRL:PL} col={a.saldo>0?GR:P}>{a.saldo}hs</Badge>
                    <Badge bg={dias<=5?"#fff5f5":dias<=10?AML:"#f8fafc"} col={dias<=5?"#dc2626":dias<=10?AM:"#94a3b8"}>
                      vence {a.vence ? fmt(a.vence) : "—"}
                    </Badge>
                    <Badge bg="#f8fafc" col="#64748b">{a.clases} clases</Badge>
                  </div>
                </div>
              </div>
            </button>
          );
        })}

      {/* Lista profes */}
      {tab==="profes" && profes
        .filter(p=>{
          if (filtro==="activos") return p.activo;
          if (filtro==="pendientes") return !p.activo;
          return true;
        })
        .map(p=>{
        const porCobrar = sumPagoProfe(reservas.filter(r=>r.estado==="realizada"&&r.profe_id===p.id));
        return (
          <button key={p.id} onClick={()=>setSel(p.id)}
            style={{background:"#fff",border:`1.5px solid ${!p.activo?"#e9d5ff":!p.pagadoMes?PB:"#e2e8f0"}`,borderRadius:14,padding:"14px",cursor:"pointer",textAlign:"left",boxShadow:"0 1px 6px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              <Av i={iniAdmin(p.nombre)} color={p.suspendido?"#94a3b8":P} size={48}/>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <p style={{margin:0,fontWeight:800,fontSize:15,color:DK}}>{p.nombre}</p>
                  <span style={{fontSize:18,color:"#94a3b8"}}>›</span>
                </div>
                <p style={{margin:"2px 0 6px",fontSize:12,color:"#94a3b8"}}>{p.materias.join(" · ")}</p>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <Badge bg={p.activo?GRL:p.clasesDadas===0?"#f5f3ff":"#fefce8"} col={p.activo?GR:p.clasesDadas===0?"#7c3aed":AM}>{p.activo?"Activo":p.clasesDadas===0?"Pendiente":"Pausado"}</Badge>
                  {!p.pagadoMes && p.activo && <Badge bg={PL} col={P}>💸 Pago pendiente</Badge>}
                  <Badge bg={p.monotributo?GRL:"#fff5f5"} col={p.monotributo?GR:"#dc2626"}>{p.monotributo?"✓ Monotrib.":"⚠️ Sin monotrib."}</Badge>
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[
                {n:p.clasesDadas,l:"Clases",bg:GRL,col:GR},
                {n:`${p.horasDadas}hs`,l:"Horas",bg:"#f0f6fa",col:BL},
                {n:`$${(porCobrar/1000).toFixed(0)}k`,l:"A cobrar",bg:PL,col:P},
              ].map(s=>(
                <div key={s.l} style={{background:s.bg,borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <p style={{margin:0,fontSize:16,fontWeight:800,color:s.col}}>{s.n}</p>
                  <p style={{margin:0,fontSize:10,color:"#64748b"}}>{s.l}</p>
                </div>
              ))}
            </div>
          </button>
        );
      })}

      {tab==="profes" && (
        <Btn variant="secondary" full onClick={()=>setNuevoProfe({nombre:"",mail:"",materias:"",monotributo:false})}>➕ Agregar nuevo profe</Btn>
      )}

      {/* Modal alta de profe */}
      {nuevoProfe && (
        <div onClick={()=>setNuevoProfe(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:50}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,padding:22,maxWidth:380,width:"100%",display:"flex",flexDirection:"column",gap:12,maxHeight:"85vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h3 style={{margin:0,color:DK,fontSize:17}}>Nuevo profe</h3>
              <button onClick={()=>setNuevoProfe(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
            </div>
            {[
              {k:"nombre",label:"Nombre y apellido",ph:"Ej: Carla Méndez"},
              {k:"mail",label:"Email",ph:"profe@puntoclases.com"},
              {k:"materias",label:"Materias (separadas por coma)",ph:"Matemática, Física"},
            ].map(f=>(
              <div key={f.k}>
                <label style={{display:"block",fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{f.label}</label>
                <input value={nuevoProfe[f.k]} placeholder={f.ph} onChange={e=>setNuevoProfe(p=>({...p,[f.k]:e.target.value}))}
                  style={{width:"100%",boxSizing:"border-box",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"11px 12px",fontSize:14,color:DK,outline:"none"}}/>
              </div>
            ))}
            <label style={{display:"flex",alignItems:"center",gap:10,fontSize:14,color:DK,cursor:"pointer",background:"#f8fafc",borderRadius:10,padding:"11px 12px"}}>
              <input type="checkbox" checked={nuevoProfe.monotributo} onChange={e=>setNuevoProfe(p=>({...p,monotributo:e.target.checked}))} style={{width:18,height:18}}/>
              Monotributo activo (obligatorio para operar)
            </label>
            <Btn
              disabled={!nuevoProfe.nombre.trim() || !nuevoProfe.mail.trim() || !nuevoProfe.materias.trim() || !nuevoProfe.monotributo || nuevoProfe.guardando}
              onClick={async () => {
                setNuevoProfe(p => ({...p, guardando: true, error: null}));
                const tempPass = Math.random().toString(36).slice(2,8).toUpperCase() + Math.random().toString(36).slice(2,5) + "!3";
                const materiasArr = nuevoProfe.materias.split(",").map(s=>s.trim()).filter(Boolean);
                try {
                  const newUser = await registrarProfe({ mail: nuevoProfe.mail.trim(), pass: tempPass, nombre: nuevoProfe.nombre.trim(), tel: "" });
                  if (newUser?.id) {
                    await actualizarProfe(newUser.id, { materias: materiasArr, monotributo: nuevoProfe.monotributo }).catch(() => {});
                  }
                  setProfes(prev=>[...prev, {
                    id: newUser?.id || crypto.randomUUID(),
                    nombre: nuevoProfe.nombre.trim(),
                    mail: nuevoProfe.mail.trim(),
                    materias: materiasArr,
                    clasesDadas:0, horasDadas:0, activo:false, suspendido:false, pagadoMes:false,
                    monotributo: nuevoProfe.monotributo,
                  }]);
                  setNuevoProfe(p => ({...p, guardando: false, tempPass, creado: true}));
                } catch(err) {
                  setNuevoProfe(p => ({...p, guardando: false, error: err.message || "No se pudo crear el profe"}));
                }
              }}>
              {nuevoProfe.guardando ? "Creando..." : "Crear profe"}
            </Btn>
            {nuevoProfe.error && <p style={{margin:0,fontSize:12,color:"#dc2626",textAlign:"center"}}>{nuevoProfe.error}</p>}
            {nuevoProfe.creado && (
              <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:6}}>
                <p style={{margin:0,fontSize:13,fontWeight:700,color:"#15803d"}}>✓ Profe creado</p>
                <p style={{margin:0,fontSize:12,color:"#374151"}}>Contraseña temporal: <strong>{nuevoProfe.tempPass}</strong></p>
                <p style={{margin:0,fontSize:11,color:"#64748b"}}>Compartila con el profe. Recibirá un mail de confirmación de Supabase. Hasta confirmar, su cuenta aparece como "Pendiente".</p>
                <Btn onClick={()=>setNuevoProfe(null)}>Cerrar</Btn>
              </div>
            )}
            {!nuevoProfe.monotributo && !nuevoProfe.creado && <p style={{margin:0,fontSize:11,color:"#94a3b8",textAlign:"center"}}>El monotributo es obligatorio para dar de alta al profe.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. OPERACIONES (Reservas)
// ════════════════════════════════════════════════════════════════════════════
function Operaciones({ reservas }) {
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");

  const lista = reservas
    .filter(r=>filtro==="todas"||r.estado===filtro)
    .filter(r=>!busqueda||(r.alumno||"").toLowerCase().includes(busqueda.toLowerCase())||r.materia.toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a,b)=>b.fecha.localeCompare(a.fecha));

  const total = lista.reduce((a,r)=>a+r.monto,0);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <h3 style={{margin:0,color:DK}}>Operaciones</h3>

      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
        placeholder="🔍 Buscar alumno o materia..."
        style={{border:"2px solid #e2e8f0",borderRadius:12,padding:"11px 16px",fontSize:14,outline:"none",fontFamily:"inherit",width:"100%",boxSizing:"border-box"}}/>

      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
        {[{v:"todas",l:"Todas"},{v:"pendiente",l:"⏳ Pendientes"},{v:"confirmada",l:"✓ Confirmadas"},{v:"realizada",l:"⭐ Realizadas"},{v:"cancelada",l:"🚫 Canceladas"},{v:"rechazada",l:"✕ Rechazadas"}].map(f=>{
          const cnt = reservas.filter(r=>f.v==="todas"||r.estado===f.v).length;
          return (
            <button key={f.v} onClick={()=>setFiltro(f.v)}
              style={{flexShrink:0,background:filtro===f.v?P:PL,color:filtro===f.v?"#fff":P,border:`1.5px solid ${filtro===f.v?P:PB}`,borderRadius:99,padding:"5px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {f.l} ({cnt})
            </button>
          );
        })}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <p style={{margin:0,fontSize:13,color:"#64748b"}}>{lista.length} reservas</p>
        <p style={{margin:0,fontWeight:800,fontSize:15,color:P}}>${total.toLocaleString("es-AR")}</p>
      </div>

      {lista.map(r=>(
        <Card key={r.id} style={{padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div>
              <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>{r.alumno}</p>
              <p style={{margin:"2px 0 4px",fontSize:12,color:"#64748b"}}>{r.materia} · {fmt(r.fecha)} · {r.hora} · {r.horas}hs</p>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {(()=>{ const c={pendiente:["#fefce8","#92400e"],confirmada:[PL,P],realizada:[GRL,GR],cancelada:["#f1f5f9","#64748b"],rechazada:["#fff5f5","#dc2626"]}[r.estado]||[PL,P]; return <Badge bg={c[0]} col={c[1]}>{r.estado}</Badge>; })()}
                <Badge bg="#f0f6fa" col={BL}>{r.modalidad}</Badge>
                <Badge bg={r.tipo==="grupal"?"#f0f6fa":PL} col={r.tipo==="grupal"?BL:P}>{r.tipo}</Badge>
              </div>
            </div>
            <p style={{margin:0,fontWeight:800,fontSize:16,color:P,flexShrink:0,marginLeft:8}}>${r.monto.toLocaleString("es-AR")}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. FINANZAS (Reportes + Config)
// ════════════════════════════════════════════════════════════════════════════
function Finanzas({ reservas, cfg, setCfg }) {
  const [tab, setTab] = useState("reportes");
  const [guardado, setGuardado] = useState(false);

  const realizadas = reservas.filter(r=>r.estado==="realizada");
  const bruto = realizadas.reduce((a,r)=>a+r.monto,0);
  const pagoProfe = sumPagoProfe(realizadas, cfg);
  const presenciales = realizadas.filter(r=>r.modalidad==="Presencial");
  // Cowork: SOLO presenciales, $ por alumno (las virtuales no usan el espacio).
  const alumnosClaseCowork = presenciales.reduce((a,r)=>a+(r.alumnosGrupo||1)*(r.horas||1),0);
  const costoCowork = sumCowork(realizadas, cfg);
  const neto = bruto-pagoProfe-costoCowork;

  const porMateria = {};
  realizadas.forEach(r=>{
    if(!porMateria[r.materia]) porMateria[r.materia]={clases:0,monto:0};
    porMateria[r.materia].clases++;
    porMateria[r.materia].monto+=r.monto;
  });
  const materias = Object.entries(porMateria).sort((a,b)=>b[1].clases-a[1].clases);
  const maxCl = Math.max(...materias.map(m=>m[1].clases),1);

  const guardar = async () => {
    try {
      await updateConfig(cfgADB(cfg));
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    } catch(err) {
      console.error("Error al guardar config:", err);
      alert("Error al guardar: " + (err.message || "intente de nuevo"));
    }
  };

  const FInput = ({label,value,onChange,prefix,suffix}) => (
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>{label}</label>
      <div style={{display:"flex",alignItems:"center",border:"2px solid #e2e8f0",borderRadius:10,overflow:"hidden",background:"#fff"}}>
        {prefix && <span style={{background:"#f8fafc",padding:"11px 12px",fontSize:13,color:"#64748b",borderRight:"1px solid #e2e8f0",flexShrink:0}}>{prefix}</span>}
        <input type="number" value={value} onChange={e=>onChange(Number(e.target.value))}
          style={{flex:1,border:"none",padding:"11px 12px",fontSize:14,fontWeight:600,outline:"none",fontFamily:"inherit",color:DK,minWidth:0}}/>
        {suffix && <span style={{background:"#f8fafc",padding:"11px 12px",fontSize:13,color:"#64748b",borderLeft:"1px solid #e2e8f0",flexShrink:0}}>{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <h3 style={{margin:0,color:DK}}>Finanzas</h3>

      <div style={{display:"flex",background:"#f1f5f9",borderRadius:12,padding:4,gap:4}}>
        {[{v:"reportes",l:"📊 Reportes"},{v:"config",l:"⚙️ Configuración"}].map(t=>(
          <button key={t.v} onClick={()=>setTab(t.v)}
            style={{flex:1,background:tab===t.v?"#fff":"transparent",border:"none",borderRadius:10,padding:"10px",fontSize:13,fontWeight:700,color:tab===t.v?P:"#64748b",cursor:"pointer",boxShadow:tab===t.v?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
            {t.l}
          </button>
        ))}
      </div>

      {tab==="reportes" && (<>
        {/* P&L */}
        <Card style={{background:`linear-gradient(135deg,${DK},#3a3a3a)`,color:"#fff"}}>
          <p style={{margin:"0 0 14px",fontSize:11,opacity:0.5,textTransform:"uppercase",letterSpacing:0.8}}>Estado de resultados</p>
          {[
            {l:"📥 Facturado bruto",v:bruto,col:"#fff",bold:false},
            {l:"👨‍🏫 Pagos a profes (tarifa fija)",v:-pagoProfe,col:"#94a3b8",bold:false},
            {l:"🏢 Costo cowork",v:-costoCowork,col:"#94a3b8",bold:false},
            {l:"💰 Ganancia neta",v:neto,col:neto>=0?"#86efac":"#fca5a5",bold:true},
          ].map((x,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:i>0?"1px solid rgba(255,255,255,0.06)":undefined}}>
              <span style={{fontSize:13,color:x.col,opacity:0.85}}>{x.l}</span>
              <span style={{fontWeight:x.bold?800:600,fontSize:x.bold?18:14,color:x.col}}>
                {x.v>=0?"":"-"}${Math.abs(x.v).toLocaleString("es-AR")}
              </span>
            </div>
          ))}
        </Card>

        {/* Cowork breakdown */}
        <Card style={{border:`1.5px solid ${AMB}`,background:AML}}>
          <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:AM,textTransform:"uppercase"}}>🏢 Costo cowork — Bendito Pedro</p>
          <div style={{display:"flex",flexDirection:"column",gap:4,fontSize:13,color:"#374151"}}>
            <span>Tarifa: <strong>${cfg.coworkPorAlumno.toLocaleString("es-AR")} por alumno presencial por hora</strong></span>
            <span>Total alumno-horas presenciales: <strong>{alumnosClaseCowork}</strong></span>
            <span>Costo total: <strong>${costoCowork.toLocaleString("es-AR")}</strong></span>
          </div>
        </Card>

        {/* Por materia */}
        <Card>
          <p style={{margin:"0 0 12px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Clases por materia</p>
          {materias.map(([mat,d])=>(
            <div key={mat} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:13,fontWeight:600,color:DK}}>{mat}</span>
                <span style={{fontSize:12,color:"#64748b"}}>{d.clases} clases · ${d.monto.toLocaleString("es-AR")}</span>
              </div>
              <div style={{background:"#f1f5f9",borderRadius:99,height:7}}>
                <div style={{background:P,borderRadius:99,height:7,width:`${(d.clases/maxCl)*100}%`,transition:"width 0.5s"}}/>
              </div>
            </div>
          ))}
        </Card>

        {/* Presencial vs Virtual / Individual vs Grupal */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[
            {titulo:"Modalidad",items:[{l:"Presencial",n:presenciales.length,bg:PL,col:P},{l:"Virtual",n:realizadas.filter(r=>r.modalidad==="Virtual").length,bg:"#f0f6fa",col:BL}]},
            {titulo:"Tipo",items:[{l:"Individual",n:realizadas.filter(r=>r.tipo==="individual").length,bg:PL,col:P},{l:"Grupal",n:realizadas.filter(r=>r.tipo==="grupal").length,bg:"#f0f6fa",col:BL}]},
          ].map(g=>(
            <Card key={g.titulo} style={{padding:14}}>
              <p style={{margin:"0 0 10px",fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>{g.titulo}</p>
              {g.items.map(x=>(
                <div key={x.l} style={{background:x.bg,borderRadius:8,padding:"8px 12px",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,fontWeight:600,color:x.col}}>{x.l}</span>
                  <span style={{fontWeight:800,color:x.col}}>{x.n}</span>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </>)}

      {tab==="config" && (<>
        <Card>
          <p style={{margin:"0 0 14px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Precios al alumno</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <FInput label="Hora individual" prefix="$" value={cfg.precioInd} onChange={v=>setCfg(p=>({...p,precioInd:v}))}/>
            <FInput label="Hora grupal (por alumno)" prefix="$" value={cfg.precioGrp} onChange={v=>setCfg(p=>({...p,precioGrp:v}))}/>
          </div>
        </Card>

        <Card style={{background:"#f8fafc"}}>
          <p style={{margin:"0 0 12px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Tarifa fija al profe</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[
              {l:"Clase individual",v:TARIFA_PROFE_IND,icon:"👤"},
              {l:"Grupal / por alumno",v:TARIFA_PROFE_GRP,icon:"👥"},
              {l:"Seña individual",v:SEÑA_IND,icon:"⚠️"},
              {l:"Seña grupal / alumno",v:SEÑA_GRP,icon:"⚠️"},
            ].map(x=>(
              <div key={x.l} style={{background:"#fff",borderRadius:10,padding:"10px 12px",border:"1px solid #e2e8f0"}}>
                <p style={{margin:0,fontSize:11,color:"#64748b"}}>{x.icon} {x.l}</p>
                <p style={{margin:"4px 0 0",fontWeight:800,fontSize:17,color:DK}}>${x.v.toLocaleString("es-AR")}</p>
              </div>
            ))}
          </div>
          <p style={{margin:"10px 0 0",fontSize:11,color:"#94a3b8"}}>Para cambiar las tarifas del profe, editá el código o contactá al desarrollador.</p>
        </Card>

        <Card>
          <p style={{margin:"0 0 14px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Packs con descuento</p>
          <p style={{margin:"-6px 0 12px",fontSize:11,color:"#94a3b8"}}>El precio se calcula solo: horas × ${cfg.precioInd.toLocaleString("es-AR")} − descuento.</p>
          {cfg.packs.map((pk,i)=>{
            const precioCalc = precioPackTotal(pk.horas, pk.descuento, cfg);
            return (
            <div key={pk.id} style={{background:"#f8fafc",borderRadius:12,padding:12,marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>Pack {pk.horas}hs</p>
                <span style={{fontSize:13,fontWeight:800,color:P}}>${precioCalc.toLocaleString("es-AR")}</span>
              </div>
              <FInput label="Descuento" suffix="%" value={pk.descuento}
                onChange={v=>setCfg(p=>({...p,packs:p.packs.map((x,j)=>j===i?{...x,descuento:v,precio:precioPackTotal(x.horas,v,p)}:x)}))}/>
            </div>
          );})}
        </Card>

        <Card>
          <p style={{margin:"0 0 14px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>🏢 Costo cowork — Bendito Pedro</p>
          <FInput label="Costo por alumno presencial por hora" prefix="$" value={cfg.coworkPorAlumno} onChange={v=>setCfg(p=>({...p,coworkPorAlumno:v}))}/>
          <p style={{margin:"8px 0 0",fontSize:12,color:"#94a3b8"}}>Se aplica solo a clases presenciales, por cada alumno y por cada hora. Las virtuales no pagan cowork.</p>
        </Card>

        <Card>
          <p style={{margin:"0 0 14px",fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase"}}>Políticas</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <FInput label="Vencimiento de horas" suffix="días" value={cfg.vencimiento} onChange={v=>setCfg(p=>({...p,vencimiento:v}))}/>
            <FInput label="Penalización cancelación tardía (-24hs)" suffix="%" value={cfg.penalizacionPct} onChange={v=>setCfg(p=>({...p,penalizacionPct:v}))}/>
          </div>
          <p style={{margin:"8px 0 0",fontSize:11,color:"#94a3b8"}}>El alumno pierde ese % de la hora y el profe cobra ese % de su tarifa.</p>
        </Card>

        <button onClick={guardar}
          style={{background:guardado?GR:P,color:"#fff",border:"none",borderRadius:12,padding:"15px",fontSize:15,fontWeight:700,cursor:"pointer",transition:"background 0.3s",width:"100%"}}>
          {guardado?"✓ Guardado":"Guardar cambios"}
        </button>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════════════════════
function AppAdminMain({ onLogout }) {
  const [screen, setScreen] = useState("dashboard");
  const [alumnos, setAlumnos] = useState([]);
  const [profes, setProfes] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [cfg, setCfg] = useState(CONFIG_INIT);

  const normReservaAdmin = r => ({
    ...r,
    alumno: r.alumnos?.profiles?.nombre || r.alumno || "—",
    alumnosGrupo: r.alumnos_grupo ?? r.alumnosGrupo ?? null,
    monto: r.monto || 0,
  });
  const normAlumno = (a, reservs) => ({
    id: a.id,
    nombre: a.profiles?.nombre || "",
    mail: a.profiles?.mail || "",
    saldo: a.saldo || 0,
    vence: a.vencimiento || "",
    compras: 0,
    clases: reservs.filter(r => r.alumno_id === a.id).length,
    activo: a.activo !== false,
    suspendido: a.suspendido || false,
  });
  const normProfe = (p, reservs) => {
    const propias = reservs.filter(r => r.profe_id === p.id && r.estado === "realizada");
    return {
      id: p.id,
      nombre: p.profiles?.nombre || "",
      mail: p.profiles?.mail || "",
      materias: p.materias || [],
      clasesDadas: propias.length,
      horasDadas: propias.reduce((s, r) => s + (r.horas || 1), 0),
      activo: p.activo !== false,
      suspendido: p.suspendido || false,
      pagadoMes: p.pagado_mes || false,
      monotributo: p.monotributo || false,
    };
  };

  useEffect(() => {
    getConfig()
      .then(row => setCfg(prev => ({ ...prev, ...normCfg(row) })))
      .catch(err => console.error("Error al cargar config:", err));
    Promise.all([getAlumnos(), getProfesAdmin(), getTodasLasReservas()])
      .then(([alms, profs, reservs]) => {
        const normR = (reservs || []).map(normReservaAdmin);
        setReservas(normR);
        setAlumnos((alms || []).map(a => normAlumno(a, normR)));
        setProfes((profs || []).map(p => normProfe(p, normR)));
      })
      .catch(err => console.error("Error al cargar datos admin:", err));
  }, []);


  const nav = [
    {id:"dashboard",icon:"🏠",label:"Inicio"},
    {id:"personas",icon:"👥",label:"Personas"},
    {id:"operaciones",icon:"📋",label:"Operaciones"},
    {id:"finanzas",icon:"💰",label:"Finanzas"},
  ];

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
      <div style={{background:DK,padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Logo size={28}/>
          <div>
            <span style={{fontWeight:800,fontSize:15,color:"#fff"}}>PuntoClases</span>
            <span style={{marginLeft:8,fontSize:11,color:"rgba(255,255,255,0.4)"}}>/ Admin</span>
          </div>
        </div>
        <Badge bg={P} col="#fff">⚙️ Admin</Badge>
      </div>

      <div style={{flex:1,padding:"16px 16px 80px",overflowY:"auto"}}>
        {screen==="dashboard"   && <Dashboard alumnos={alumnos} profes={profes} reservas={reservas} cfg={cfg} onNav={setScreen} onLogout={onLogout}/>}
        {screen==="personas"    && <Personas alumnos={alumnos} setAlumnos={setAlumnos} profes={profes} setProfes={setProfes} reservas={reservas}/>}
        {screen==="operaciones" && <Operaciones reservas={reservas}/>}
        {screen==="finanzas"    && <Finanzas reservas={reservas} cfg={cfg} setCfg={setCfg}/>}
      </div>

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid #e2e8f0",display:"flex",padding:"8px 0 12px",zIndex:10}}>
        {nav.map(n=>(
          <button key={n.id} onClick={()=>setScreen(n.id)}
            style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>{n.icon}</span>
            <span style={{fontSize:10,fontWeight:screen===n.id?700:400,color:screen===n.id?P:"#94a3b8"}}>{n.label}</span>
            {screen===n.id && <div style={{width:4,height:4,borderRadius:"50%",background:P}}/>}
          </button>
        ))}
      </div>
    </div>
  );
}



// ── MODAL REPROGRAMAR PARA EL PROFE ──────────────────────────────────────────
function ModalReprogramarProfe({ reserva, dispon, onActualizar, onCerrar }) {
  const [accion, setAccion] = useState(null);
  const [confirmado, setConfirmado] = useState(false);
  const [nuevaFecha, setNuevaFecha] = useState(null);
  const [nuevaHora, setNuevaHora] = useState(null);
  const [mes, setMes] = useState(new Date().getMonth());
  const year = new Date().getFullYear();
  const dispProfe = dispon || {};

  const confirmarReprogramar = async () => {
    try {
      const r = await reprogramarReserva(reserva.id, nuevaFecha, nuevaHora);
      onActualizar?.(r);
      setConfirmado(true);
    } catch(err) { console.error("Error al reprogramar:", err); }
  };

  const confirmarCancelar = async () => {
    try {
      const r = await marcarReserva(reserva.id, "cancelada");
      onActualizar?.(r);
      setConfirmado(true);
    } catch(err) { console.error("Error al cancelar:", err); }
  };

  if (confirmado) return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#fff",borderRadius:20,padding:24,width:"100%",maxWidth:400,textAlign:"center",display:"flex",flexDirection:"column",gap:14,alignItems:"center"}}>
        <span style={{fontSize:48}}>{accion==="cancelar"?"❌":"✅"}</span>
        <h3 style={{margin:0,color:DK}}>{accion==="cancelar"?"Clase cancelada":"Clase reprogramada"}</h3>
        <p style={{margin:0,fontSize:13,color:"#64748b"}}>
          {accion==="cancelar"
            ? `El alumno fue notificado. Se descontó el ${CFG.penalizacionPct}% de su hora.`
            : `Nueva fecha: ${nuevaFecha?fmt(nuevaFecha):""} a las ${nuevaHora}`
          }
        </p>
        <button onClick={onCerrar} style={{background:P,color:"#fff",border:"none",borderRadius:12,padding:"13px",fontSize:14,fontWeight:700,cursor:"pointer",width:"100%"}}>
          Cerrar
        </button>
      </div>
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:14,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{margin:0,color:DK,fontSize:17}}>Gestionar clase</h3>
          <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>
        <div style={{background:"#f8fafc",borderRadius:12,padding:"12px 14px"}}>
          <p style={{margin:0,fontSize:13,color:"#374151"}}><strong>{reserva.materia}</strong> — {reserva.alumno}<br/>{fmt(reserva.fecha)} · {reserva.hora}</p>
        </div>
        <div style={{background:"#fefce8",border:`1.5px solid ${AMB}`,borderRadius:12,padding:"10px 14px"}}>
          <p style={{margin:0,fontSize:12,color:AM}}>⚠️ Al cancelar o reprogramar, el alumno pierde el {CFG.penalizacionPct}% de la hora. Vos cobrás el {CFG.penalizacionPct}% de tu tarifa.</p>
        </div>
        {!accion && (
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={()=>setAccion("reprogramar")}
              style={{background:GRL,border:"1.5px solid #bbf7d0",borderRadius:14,padding:"16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:28}}>🔄</span>
              <div>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:GR}}>Reprogramar</p>
                <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>Cambiar a otra fecha disponible</p>
              </div>
            </button>
            <button onClick={()=>setAccion("cancelar")}
              style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:14,padding:"16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:28}}>❌</span>
              <div>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:"#dc2626"}}>Cancelar clase</p>
                <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>El alumno pierde el 50% de la hora</p>
              </div>
            </button>
          </div>
        )}
        {accion==="reprogramar" && (<>
          <p style={{margin:0,fontWeight:700,fontSize:14,color:DK}}>Nueva fecha:</p>
          <div style={{background:"#f8fafc",borderRadius:14,padding:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <button onClick={()=>setMes(m=>Math.max(m-1,0))} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:P}}>‹</button>
              <span style={{fontWeight:700,fontSize:14,color:DK}}>{MESES[mes]} {year}</span>
              <button onClick={()=>setMes(m=>Math.min(m+1,11))} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:P}}>›</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,textAlign:"center"}}>
              {DIAS.map(d=><div key={d} style={{fontSize:10,color:"#94a3b8",fontWeight:600,paddingBottom:3}}>{d}</div>)}
              {Array(new Date(year,mes,1).getDay()).fill(null).map((_,i)=><div key={`e${i}`}/>)}
              {Array(new Date(year,mes+1,0).getDate()).fill(null).map((_,i)=>{
                const d=i+1, iso=`${year}-${String(mes+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                const tiene=!!(dispProfe[iso]&&Object.keys(dispProfe[iso]).length>0);
                const sel=nuevaFecha===iso;
                return <button key={d} disabled={!tiene} onClick={()=>{setNuevaFecha(iso);setNuevaHora(null);}}
                  style={{aspectRatio:"1",borderRadius:6,border:sel?`2px solid ${P}`:"none",background:sel?P:tiene?PL:"transparent",color:sel?"#fff":tiene?P:"#cbd5e1",fontSize:11,fontWeight:tiene?700:400,cursor:tiene?"pointer":"default"}}>{d}</button>;
              })}
            </div>
          </div>
          {nuevaFecha && (
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {Object.keys(dispProfe[nuevaFecha]||{}).sort().map(h=>(
                <button key={h} onClick={()=>setNuevaHora(h)}
                  style={{background:nuevaHora===h?P:PL,color:nuevaHora===h?"#fff":P,border:`1.5px solid ${nuevaHora===h?P:PB}`,borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {h}
                </button>
              ))}
            </div>
          )}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setAccion(null)} style={{flex:1,background:"#f1f5f9",border:"none",borderRadius:12,padding:"12px",fontSize:13,fontWeight:700,cursor:"pointer",color:"#475569"}}>← Volver</button>
            <button onClick={confirmarReprogramar} disabled={!nuevaFecha||!nuevaHora}
              style={{flex:2,background:nuevaFecha&&nuevaHora?GR:"#e2e8f0",color:nuevaFecha&&nuevaHora?"#fff":"#94a3b8",border:"none",borderRadius:12,padding:"12px",fontSize:13,fontWeight:700,cursor:nuevaFecha&&nuevaHora?"pointer":"not-allowed"}}>
              Confirmar nueva fecha ✓
            </button>
          </div>
        </>)}
        {accion==="cancelar" && (
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setAccion(null)} style={{flex:1,background:"#f1f5f9",border:"none",borderRadius:12,padding:"12px",fontSize:13,fontWeight:700,cursor:"pointer",color:"#475569"}}>← Volver</button>
            <button onClick={confirmarCancelar} style={{flex:1,background:"#dc2626",border:"none",borderRadius:12,padding:"12px",fontSize:13,fontWeight:700,cursor:"pointer",color:"#fff"}}>
              Confirmar cancelación
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ⭐ MODAL DE RESEÑA — aparece después de cada clase completada
// ════════════════════════════════════════════════════════════════════════════
function ModalResenia({ clase, onGuardar, onOmitir }) {
  const [estrellas, setEstrellas] = useState(0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviado, setEnviado] = useState(false);

  const labels = ["","Malo","Regular","Bueno","Muy bueno","Excelente"];

  if (enviado) return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"32px 24px 48px",width:"100%",maxWidth:480,textAlign:"center",display:"flex",flexDirection:"column",gap:16,alignItems:"center"}}>
        <div style={{width:72,height:72,background:"#fefce8",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40}}>⭐</div>
        <h3 style={{margin:0,color:DK,fontSize:20,fontWeight:800}}>¡Gracias por tu reseña!</h3>
        <p style={{margin:0,fontSize:14,color:"#64748b"}}>Tu opinión ayuda a otros alumnos a elegir y motiva a David a seguir mejorando.</p>
        <button onClick={onOmitir} style={{background:P,color:"#fff",border:"none",borderRadius:12,padding:"14px 32px",fontSize:15,fontWeight:700,cursor:"pointer",width:"100%"}}>
          Cerrar
        </button>
      </div>
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{margin:0,color:DK,fontSize:17}}>⭐ Calificá la clase</h3>
          <button onClick={onOmitir} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>

        <div style={{background:"#f8fafc",borderRadius:12,padding:"12px 14px"}}>
          <p style={{margin:0,fontSize:13,color:"#374151"}}><strong>{clase.materia}</strong> con {clase.profes?.profiles?.nombre?.split(" ")[0] || "el profe"} · {clase.fecha}</p>
        </div>

        {/* Estrellas */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
          <div style={{display:"flex",gap:8}}>
            {[1,2,3,4,5].map(n=>(
              <button key={n}
                onClick={()=>setEstrellas(n)}
                onMouseEnter={()=>setHover(n)}
                onMouseLeave={()=>setHover(0)}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:40,padding:4,transition:"transform 0.1s",transform:(hover||estrellas)>=n?"scale(1.15)":"scale(1)"}}>
                <span style={{color:(hover||estrellas)>=n?"#fbbf24":"#e2e8f0",transition:"color 0.15s"}}>★</span>
              </button>
            ))}
          </div>
          {(hover||estrellas)>0 && (
            <span style={{fontSize:14,fontWeight:700,color:(hover||estrellas)>=4?"#15803d":(hover||estrellas)>=3?"#92400e":P}}>
              {labels[hover||estrellas]}
            </span>
          )}
        </div>

        {/* Comentario */}
        {estrellas>0 && (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <label style={{fontSize:13,fontWeight:600,color:DK}}>Comentario (opcional)</label>
            <textarea value={comentario} onChange={e=>setComentario(e.target.value)}
              placeholder="¿Qué te pareció la clase? ¿Qué mejoraría David?"
              style={{border:`2px solid ${comentario?P+"44":"#e2e8f0"}`,borderRadius:12,padding:"12px",fontSize:14,fontFamily:"inherit",resize:"none",minHeight:80,outline:"none"}}/>
          </div>
        )}

        <button onClick={()=>{ if(estrellas>0) { onGuardar(estrellas, comentario); setEnviado(true); } }} disabled={estrellas===0}
          style={{background:estrellas>0?P:"#e2e8f0",color:estrellas>0?"#fff":"#94a3b8",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:estrellas>0?"pointer":"not-allowed",transition:"all 0.2s"}}>
          Enviar reseña
        </button>
        <button onClick={onOmitir} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",textDecoration:"underline",padding:0,textAlign:"center"}}>
          Omitir por ahora
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 🔄 MODAL RESERVA RECURRENTE (alumno)
// ════════════════════════════════════════════════════════════════════════════
function ModalRecurrenteAlumno({ onConfirmar, onCerrar, profes }) {
  const [paso, setPaso] = useState(1);
  const [diasSel, setDiasSel] = useState([]);
  const [horaSel, setHoraSel] = useState(null);
  const [semanas, setSemanas] = useState(4);
  const [materia, setMateria] = useState("");
  const [modalidad, setModalidad] = useState("");
  const [dispRaw, setDispRaw] = useState([]);

  const DIAS_SEMANA = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const profe = profes?.[0] || null;
  const dispProfe = dispRaw.reduce((acc, b) => {
    if (!acc[b.fecha]) acc[b.fecha] = {};
    acc[b.fecha][b.hora] = b.tipo;
    return acc;
  }, {});

  useEffect(() => {
    if (!profe?.id) return;
    getDisponibilidad(profe.id)
      .then(data => setDispRaw(data || []))
      .catch(() => {});
  }, [profe?.id]);

  const toggleDia = d => { setDiasSel(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d]); setHoraSel(null); };

  // Calcular qué días de la semana tiene disponibilidad David (al menos en 1 fecha futura)
  const diasConDispon = DIAS_SEMANA.map((nombre, idx) => {
    // Buscar si alguna fecha futura cae en ese día de la semana
    const tieneAlgo = Object.keys(dispProfe).some(iso => {
      const d = new Date(iso);
      return d.getDay() === idx && Object.keys(dispProfe[iso]).length > 0;
    });
    return { nombre, idx, disponible: tieneAlgo };
  });

  // Horarios disponibles para los días seleccionados (intersección)
  const horariosDisponibles = (() => {
    if (!diasSel.length) return [];
    const setsHoras = diasSel.map(diaIdx => {
      const horas = new Set();
      Object.keys(dispProfe).forEach(iso => {
        const d = new Date(iso);
        if (d.getDay() === diaIdx) {
          Object.keys(dispProfe[iso]).forEach(h => horas.add(h));
        }
      });
      return horas;
    });
    // Intersección de todos los días seleccionados
    const interseccion = [...setsHoras[0]].filter(h => setsHoras.every(s => s.has(h)));
    return interseccion.sort();
  })();

  // Verificar disponibilidad por semana
  const verificarPorSemana = () => {
    if (!horaSel || !diasSel.length) return [];
    const BASE = new Date(); BASE.setHours(0,0,0,0);
    const resultado = [];
    for (let sem = 0; sem < semanas; sem++) {
      const clasesSemana = [];
      for (const diaIdx of diasSel) {
        const d = new Date(BASE);
        const diffDias = (diaIdx - BASE.getDay() + 7) % 7 || 7;
        d.setDate(BASE.getDate() + diffDias + sem * 7);
        const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const disponible = !!(dispProfe[iso] && dispProfe[iso][horaSel]);
        clasesSemana.push({ iso, hora: horaSel, dia: DIAS_SEMANA[diaIdx], disponible });
      }
      resultado.push({ semana: sem + 1, clases: clasesSemana });
    }
    return resultado;
  };

  const semanasVerif = verificarPorSemana();
  const totalConfirmadas = semanasVerif.reduce((a, s) => a + s.clases.filter(c => c.disponible).length, 0);
  const totalPendientes = semanasVerif.reduce((a, s) => a + s.clases.filter(c => !c.disponible).length, 0);
  const totalClases = diasSel.length * semanas;

  const puedeAvanzar =
    paso === 1 ? diasSel.length > 0 && horaSel && totalConfirmadas > 0 :
    paso === 2 ? materia && modalidad : true;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>

        {/* Header fijo */}
        <div style={{padding:"20px 20px 0",position:"sticky",top:0,background:"#fff",zIndex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {paso>1 && <button onClick={()=>setPaso(p=>p-1)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:P,padding:0}}>←</button>}
              <h3 style={{margin:0,color:DK,fontSize:17}}>🔄 Reserva recurrente</h3>
            </div>
            <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
          </div>
          <div style={{display:"flex",gap:4,marginBottom:16}}>
            {[1,2,3].map(n=><div key={n} style={{flex:1,height:3,borderRadius:99,background:paso>=n?P:"#e2e8f0",transition:"background 0.3s"}}/>)}
          </div>
        </div>

        <div style={{padding:"0 20px 44px",display:"flex",flexDirection:"column",gap:16}}>

          {/* Card del profe siempre visible */}
          {profe && (
          <div style={{background:"#f8fafc",borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
            <Av i={(profe.nombre||"").split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase()||"P"} color={P} size={44}/>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:800,fontSize:15,color:DK}}>{profe.nombre||"Profe"}</p>
              <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>{(profe.materias||[]).slice(0,3).join(" · ")}</p>
            </div>
            <div style={{display:"flex",gap:4}}>
              {(profe.modalidad||profe.modalidades||["Presencial","Virtual"]).map(m=><Badge key={m} bg="#f0f6fa" col={BL}>{m}</Badge>)}
            </div>
          </div>
          )}

          {/* PASO 1 — Días con disponibilidad + horarios disponibles */}
          {paso===1 && (<>
            <div>
              <p style={{margin:"0 0 4px",fontWeight:700,fontSize:16,color:DK}}>¿Qué días querés tener clase?</p>
              <p style={{margin:0,fontSize:13,color:"#64748b"}}>Solo se muestran los días en que David tiene disponibilidad.</p>
            </div>

            {/* Grilla de días — estilo asientos */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              {diasConDispon.map(({nombre,idx,disponible})=>{
                const sel = diasSel.includes(idx);
                return (
                  <button key={nombre} onClick={()=>disponible&&toggleDia(idx)} disabled={!disponible}
                    style={{
                      padding:"14px 0",borderRadius:12,
                      background: sel?P : disponible?PL:"#f8fafc",
                      color: sel?"#fff" : disponible?P:"#cbd5e1",
                      border:`2px solid ${sel?P:disponible?PB:"#e2e8f0"}`,
                      fontWeight:700,fontSize:13,
                      cursor:disponible?"pointer":"not-allowed",
                      display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                      transition:"all 0.15s",
                      opacity:disponible?1:0.5,
                    }}>
                    {sel && <span style={{fontSize:10}}>✓</span>}
                    {!disponible && <span style={{fontSize:10}}>—</span>}
                    {nombre}
                    {disponible && !sel && <span style={{fontSize:8,opacity:0.7}}>libre</span>}
                  </button>
                );
              })}
            </div>

            {/* Horarios disponibles para los días elegidos */}
            {diasSel.length > 0 && (
              <>
                <div>
                  <p style={{margin:"0 0 4px",fontWeight:700,fontSize:14,color:DK}}>Horarios disponibles</p>
                  {horariosDisponibles.length === 0 ? (
                    <div style={{background:PL,borderRadius:10,padding:"10px 14px",border:`1px solid ${PB}`}}>
                      <p style={{margin:0,fontSize:13,color:P}}>⚠️ No hay horarios en común para los días seleccionados. Probá con otra combinación.</p>
                    </div>
                  ) : (
                    <p style={{margin:0,fontSize:12,color:"#64748b"}}>{horariosDisponibles.length} horarios disponibles para todos los días elegidos.</p>
                  )}
                </div>
                {horariosDisponibles.length > 0 && (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {horariosDisponibles.map(h=>(
                      <button key={h} onClick={()=>setHoraSel(h)}
                        style={{
                          padding:"12px 0",borderRadius:10,
                          background:horaSel===h?P:PL,
                          color:horaSel===h?"#fff":P,
                          border:`2px solid ${horaSel===h?P:PB}`,
                          fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s"
                        }}>
                        {horaSel===h?"✓ ":""}{h}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Selector de semanas */}
            {horaSel && (
              <>
                <p style={{margin:"4px 0 0",fontWeight:700,fontSize:14,color:DK}}>¿Por cuántas semanas?</p>
                <div style={{display:"flex",gap:8}}>
                  {[2,4,8,12].map(n=>(
                    <button key={n} onClick={()=>setSemanas(n)}
                      style={{flex:1,background:semanas===n?P:PL,color:semanas===n?"#fff":P,border:`1.5px solid ${semanas===n?P:PB}`,borderRadius:10,padding:"10px 0",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                      {n}sem
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Resumen de disponibilidad por semana */}
            {horaSel && semanasVerif.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <p style={{margin:0,fontWeight:700,fontSize:13,color:DK}}>Disponibilidad semana a semana:</p>
                {semanasVerif.map(s => {
                  const todas = s.clases.every(c=>c.disponible);
                  const ninguna = s.clases.every(c=>!c.disponible);
                  return (
                    <div key={s.semana} style={{
                      background:todas?"#f0fdf4":ninguna?"#fff5f5":"#fefce8",
                      borderRadius:10,padding:"10px 12px",
                      border:`1px solid ${todas?"#bbf7d0":ninguna?"#fecaca":AMB}`,
                      display:"flex",justifyContent:"space-between",alignItems:"center"
                    }}>
                      <span style={{fontSize:13,fontWeight:600,color:DK}}>Semana {s.semana}</span>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                        {s.clases.map(c=>(
                          <span key={c.iso} style={{
                            fontSize:11,fontWeight:700,
                            color:c.disponible?"#15803d":"#dc2626",
                            background:c.disponible?"#dcfce7":"#fee2e2",
                            borderRadius:6,padding:"2px 8px"
                          }}>
                            {c.disponible?"✓":"✗"} {c.dia} {c.hora}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Resumen final */}
                <div style={{
                  background:totalPendientes===0?PL:"#fefce8",
                  border:`1.5px solid ${totalPendientes===0?PB:AMB}`,
                  borderRadius:12,padding:"12px 14px"
                }}>
                  <p style={{margin:0,fontSize:13,color:totalPendientes===0?P:AM,fontWeight:700}}>
                    {totalPendientes===0
                      ? `✓ ${totalConfirmadas} clases confirmadas`
                      : `✓ ${totalConfirmadas} confirmadas · ⏳ ${totalPendientes} quedan pendientes`
                    }
                  </p>
                  {totalPendientes > 0 && (
                    <p style={{margin:"4px 0 0",fontSize:11,color:"#64748b"}}>Las pendientes se confirmarán cuando David cargue disponibilidad para esas fechas.</p>
                  )}
                </div>
              </div>
            )}
          </>)}

          {/* PASO 2 — Materia y modalidad */}
          {paso===2 && (<>
            <div>
              <p style={{margin:"0 0 4px",fontWeight:700,fontSize:16,color:DK}}>¿Qué materia?</p>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {profe.materias.map(m=>(
                <button key={m} onClick={()=>setMateria(m)}
                  style={{background:materia===m?P:PL,color:materia===m?"#fff":P,border:`1.5px solid ${materia===m?P:PB}`,borderRadius:99,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                  {materia===m?"✓ ":""}{m}
                </button>
              ))}
            </div>
            <div>
              <p style={{margin:"0 0 10px",fontWeight:700,fontSize:14,color:DK}}>¿Cómo?</p>
              <div style={{display:"flex",gap:10}}>
                {(profe?.modalidad||profe?.modalidades||["Presencial","Virtual"]).map(m=>(
                  <button key={m} onClick={()=>setModalidad(m)}
                    style={{flex:1,background:modalidad===m?P:PL,color:modalidad===m?"#fff":P,border:`2px solid ${modalidad===m?P:PB}`,borderRadius:12,padding:"14px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
                    {modalidad===m?"✓ ":""}{m}
                  </button>
                ))}
              </div>
            </div>
          </>)}

          {/* PASO 3 — Resumen final */}
          {paso===3 && (
            <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:14,padding:16}}>
              <p style={{margin:"0 0 12px",fontWeight:700,fontSize:14,color:"#166534"}}>📋 Resumen de tu reserva recurrente</p>
              <div style={{fontSize:13,color:"#374151",display:"flex",flexDirection:"column",gap:6}}>
                <span>👨‍🏫 <strong>{profe.nombre}</strong></span>
                <span>📅 Días: <strong>{diasSel.map(d=>DIAS_SEMANA[d]).join(", ")}</strong></span>
                <span>🕐 Hora: <strong>{horaSel}</strong></span>
                <span>📚 Materia: <strong>{materia}</strong></span>
                <span>📍 Modalidad: <strong>{modalidad}</strong></span>
                <span>📆 <strong>{semanas} semanas</strong></span>
                <span>✓ Confirmadas: <strong>{totalConfirmadas} clases</strong></span>
                {totalPendientes>0 && <span>⏳ Pendientes: <strong>{totalPendientes} clases</strong></span>}
                <span>⏱ Saldo a usar: <strong>{totalConfirmadas} hs</strong></span>
              </div>
            </div>
          )}

          <button
            onClick={()=>{ if(paso<3) setPaso(p=>p+1); else { onConfirmar({diasSel,horaSel,semanas,materia,modalidad,totalConfirmadas}); onCerrar(); }}}
            disabled={!puedeAvanzar}
            style={{background:puedeAvanzar?P:"#e2e8f0",color:puedeAvanzar?"#fff":"#94a3b8",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:puedeAvanzar?"pointer":"not-allowed",transition:"all 0.2s"}}>
            {paso<3?"Continuar →":"Confirmar reservas recurrentes ✓"}
          </button>
        </div>
      </div>
    </div>
  );
}
// ════════════════════════════════════════════════════════════════════════════
// REGISTRO DEL ALUMNO — alta de cuenta nueva
// ════════════════════════════════════════════════════════════════════════════
function OnboardingRegistroAlumno({ onTerminar }) {
  const [paso, setPaso] = useState(1); // 1=datos, 2=términos, 3=listo
  const [form, setForm] = useState({
    nombre:"", mail:"", tel:"", nivel:"", pass:"", pass2:"",
    terminos:false,
  });
  const [errReg, setErrReg] = useState("");
  const [cargandoReg, setCargandoReg] = useState(false);
  const NIVELES = ["Primario","Secundario","Universitario / Terciario","Adulto / Otro"];
  const set = (k,v)=>setForm(p=>({...p,[k]:v}));
  const mailOk = /^\S+@\S+\.\S+$/.test(form.mail);

  const puedeAvanzar = () => {
    if (paso===1) return form.nombre.trim() && mailOk && form.nivel && form.pass.length>=8 && form.pass===form.pass2;
    if (paso===2) return form.terminos;
    return true;
  };

  const handleCrearCuenta = async () => {
    setErrReg("");
    setCargandoReg(true);
    try {
      await registrarAlumno({ mail: form.mail.toLowerCase().trim(), pass: form.pass, nombre: form.nombre, tel: form.tel, nivel: form.nivel });
      setPaso(3);
    } catch (e) {
      setErrReg(e.message || "No se pudo crear la cuenta. Intentá de nuevo.");
    } finally {
      setCargandoReg(false);
    }
  };

  const inputStyle = {width:"100%",boxSizing:"border-box",border:"1.5px solid #e2e8f0",borderRadius:10,padding:"12px",fontSize:14,color:DK,background:"#fff",outline:"none",fontFamily:"inherit"};
  const labelStyle = {display:"block",fontSize:12,color:"#64748b",fontWeight:600,marginBottom:5};

  if (paso === 3) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:20,padding:"40px 24px",textAlign:"center",background:BG,minHeight:"100vh",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <div style={{width:90,height:90,background:PL,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:48}}>🎓</div>
      <h2 style={{margin:0,color:DK,fontSize:22,fontWeight:800}}>¡Bienvenido/a, {form.nombre.split(" ")[0]}!</h2>
      <p style={{margin:0,fontSize:15,color:"#64748b",lineHeight:1.6}}>Tu cuenta está creada. Como alumno nuevo tenés <strong style={{color:AM}}>{CFG.packPrueba.descuento}% OFF en tus primeras {CFG.packPrueba.horas} horas</strong>.</p>
      <div style={{background:"#fff",borderRadius:14,padding:16,width:"100%",maxWidth:360,textAlign:"left",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        {[
          {icon:"👤",l:"Nombre",v:form.nombre},
          {icon:"✉️",l:"Email",v:form.mail},
          {icon:"🎓",l:"Nivel",v:form.nivel},
          {icon:"🎁",l:"Beneficio de bienvenida",v:`Pack prueba ${CFG.packPrueba.horas}hs · ${CFG.packPrueba.descuento}% OFF`},
        ].map(x=>(
          <div key={x.l} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
            <span style={{fontSize:18,flexShrink:0}}>{x.icon}</span>
            <div>
              <p style={{margin:0,fontSize:11,color:"#94a3b8",textTransform:"uppercase",fontWeight:600}}>{x.l}</p>
              <p style={{margin:0,fontSize:13,color:DK}}>{x.v}</p>
            </div>
          </div>
        ))}
      </div>
      <button onClick={()=>onTerminar(form)} style={{background:P,color:"#fff",border:"none",borderRadius:14,padding:"16px 32px",fontSize:16,fontWeight:800,cursor:"pointer",width:"100%",maxWidth:360}}>
        Empezar →
      </button>
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
      <div style={{background:DK,padding:"14px 20px",display:"flex",alignItems:"center",gap:12}}>
        <Logo size={28}/>
        <div>
          <p style={{margin:0,fontSize:14,fontWeight:800,color:"#fff"}}>PuntoClases</p>
          <p style={{margin:0,fontSize:11,color:"rgba(255,255,255,0.5)"}}>Crear cuenta de alumno — paso {paso} de 2</p>
        </div>
      </div>
      <div style={{display:"flex",gap:0}}>
        {[1,2].map(n=>(<div key={n} style={{flex:1,height:4,background:paso>=n?P:"#e2e8f0",transition:"background 0.3s"}}/>))}
      </div>

      <div style={{flex:1,padding:"20px 20px 100px",overflowY:"auto"}}>
        <h2 style={{margin:"0 0 6px",color:DK,fontSize:20,fontWeight:800}}>{paso===1?"Tus datos":"Casi listo"}</h2>

        {paso===1 && (
          <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:12}}>
            <div>
              <label style={labelStyle}>Nombre y apellido</label>
              <input value={form.nombre} onChange={e=>set("nombre",e.target.value)} placeholder="Ej: Juan Pérez" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={form.mail} onChange={e=>set("mail",e.target.value)} placeholder="tu@email.com" style={{...inputStyle,borderColor:form.mail&&!mailOk?"#fecaca":"#e2e8f0"}}/>
              {form.mail && !mailOk && <p style={{margin:"4px 0 0",fontSize:11,color:"#dc2626"}}>Email no válido</p>}
            </div>
            <div>
              <label style={labelStyle}>Teléfono <span style={{color:"#94a3b8",fontWeight:400}}>(opcional)</span></label>
              <input type="tel" value={form.tel} onChange={e=>set("tel",e.target.value)} placeholder="223 456-7890" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Nivel educativo</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {NIVELES.map(n=>(
                  <button key={n} onClick={()=>set("nivel",n)}
                    style={{background:form.nivel===n?P:"#f1f5f9",color:form.nivel===n?"#fff":"#475569",border:"none",borderRadius:99,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Contraseña</label>
              <input type="password" value={form.pass} onChange={e=>set("pass",e.target.value)} placeholder="Mínimo 8 caracteres" style={inputStyle}/>
              {form.pass.length>0 && form.pass.length<8 && <p style={{margin:"4px 0 0",fontSize:11,color:"#dc2626"}}>La contraseña necesita al menos 8 caracteres</p>}
            </div>
            <div>
              <label style={labelStyle}>Repetir contraseña</label>
              <input type="password" value={form.pass2} onChange={e=>set("pass2",e.target.value)} placeholder="Repetí la contraseña" style={{...inputStyle,borderColor:form.pass2&&form.pass!==form.pass2?"#fecaca":"#e2e8f0"}}/>
              {form.pass2 && form.pass!==form.pass2 && <p style={{margin:"4px 0 0",fontSize:11,color:"#dc2626"}}>Las contraseñas no coinciden</p>}
            </div>
          </div>
        )}

        {paso===2 && (
          <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:12}}>
            <p style={{margin:0,fontSize:14,color:"#64748b"}}>Revisá cómo funciona y aceptá los términos para crear tu cuenta.</p>
            <div style={{background:"#fff",borderRadius:12,padding:16,fontSize:13,color:"#374151",lineHeight:1.6,boxShadow:"0 1px 6px rgba(0,0,0,0.05)",display:"flex",flexDirection:"column",gap:8}}>
              <p style={{margin:0}}>• Comprás <strong>packs de horas</strong> que se descuentan de tu saldo al reservar.</p>
              <p style={{margin:0}}>• Clase individual descuenta 1hs · grupal {CFG.factorGrupal}hs.</p>
              <p style={{margin:0}}>• Las horas vencen a los <strong>{CFG.vencimientoDias} días</strong>.</p>
              <p style={{margin:0}}>• Cancelación con menos de 24hs: se retiene el <strong>{CFG.penalizacionPct}%</strong> de la hora.</p>
              <p style={{margin:0}}>• Las clases virtuales son individuales; las grupales son presenciales.</p>
            </div>
            <label style={{display:"flex",alignItems:"flex-start",gap:10,fontSize:13,color:DK,cursor:"pointer",background:"#f8fafc",borderRadius:10,padding:"12px"}}>
              <input type="checkbox" checked={form.terminos} onChange={e=>set("terminos",e.target.checked)} style={{width:18,height:18,marginTop:2,flexShrink:0}}/>
              <span>Acepto los <strong>Términos y condiciones</strong> y la <strong>Política de privacidad</strong> de PuntoClases.</span>
            </label>
          </div>
        )}
      </div>

      <div style={{position:"fixed",bottom:0,left:0,right:0,maxWidth:480,margin:"0 auto",background:"#fff",borderTop:"1px solid #e2e8f0",padding:"14px 20px",display:"flex",gap:10}}>
        <Btn variant="secondary" onClick={()=>paso===1?onTerminar(null):setPaso(1)} style={{flex:1}}>
          {paso===1?"Cancelar":"← Volver"}
        </Btn>
        {paso<2
          ? <Btn disabled={!puedeAvanzar()} onClick={()=>setPaso(paso+1)} style={{flex:2}}>Continuar →</Btn>
          : <Btn disabled={!puedeAvanzar()||cargandoReg} onClick={handleCrearCuenta} style={{flex:2}}>
              {cargandoReg?"Creando cuenta...":"Crear cuenta ✓"}
            </Btn>
        }
        {errReg && <p style={{margin:"4px 0 0",fontSize:12,color:"#dc2626",width:"100%"}}>{errReg}</p>}
      </div>
    </div>
  );
}
// ════════════════════════════════════════════════════════════════════════════
// ONBOARDING DEL PROFE — Registro + Términos + Monotributo
// ════════════════════════════════════════════════════════════════════════════
function OnboardingRegistroProfe({ onTerminar }) {
  const [paso, setPaso] = useState(1); // 1=datos, 2=materias, 3=terminos, 4=monotributo, 5=listo
  const [form, setForm] = useState({
    nombre:"", mail:"", tel:"", titulo:"", experiencia:"",
    pass:"", pass2:"",
    materias:[], niveles:[], modalidad:[],
    monotributo:false, categoriaMonotributo:"",
    terminosAceptados:false, politicaAceptada:false,
  });
  const [errReg, setErrReg] = useState("");
  const [cargandoReg, setCargandoReg] = useState(false);

  const MATERIAS = ["Matemática","Álgebra","Análisis Matemático","Física","Química","Biología","Lengua","Literatura","Historia","Inglés","Informática","Economía"];
  const NIVELES_REG = ["Primaria","Secundaria","Preuniversitario","Universitario"];
  const CATEGORIAS_MT = ["A","B","C","D","E","F","G","H"];

  const toggle = (field, val) => setForm(p=>({
    ...p, [field]: p[field].includes(val) ? p[field].filter(x=>x!==val) : [...p[field], val]
  }));

  const puedeAvanzar = () => {
    if (paso===1) return form.nombre && form.mail && form.tel && form.titulo && form.pass.length>=8 && form.pass===form.pass2;
    if (paso===2) return form.materias.length > 0 && form.niveles.length > 0 && form.modalidad.length > 0;
    if (paso===3) return form.terminosAceptados && form.politicaAceptada;
    if (paso===4) return form.monotributo && form.categoriaMonotributo;
    return true;
  };

  const pasosTitulos = ["Tus datos","Qué enseñás","Términos","Monotributo","¡Listo!"];

  if (paso === 5) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:20,padding:"40px 24px",textAlign:"center",background:BG,minHeight:"100vh",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <div style={{width:90,height:90,background:"#f0fdf4",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:48}}>🎉</div>
      <h2 style={{margin:0,color:DK,fontSize:22,fontWeight:800}}>¡Bienvenido, {form.nombre.split(" ")[0]}!</h2>
      <p style={{margin:0,fontSize:15,color:"#64748b",lineHeight:1.6}}>Tu perfil está listo. Ya podés cargar tu disponibilidad y empezar a recibir reservas.</p>
      <div style={{background:"#fff",borderRadius:14,padding:16,width:"100%",maxWidth:360,textAlign:"left",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        {[
          {icon:"📚",l:"Materias",v:form.materias.slice(0,3).join(", ")+(form.materias.length>3?"...":"")},
          {icon:"🎓",l:"Niveles",v:form.niveles.join(", ")},
          {icon:"📍",l:"Modalidad",v:form.modalidad.join(" y ")},
          {icon:"💰",l:"Tu tarifa",v:`$${CFG.tarifaProfeInd.toLocaleString("es-AR")}/hs individual · $${CFG.tarifaProfeGrp.toLocaleString("es-AR")}/hs por alumno grupal`},
          {icon:"✓",l:"Monotributo",v:`Categoría ${form.categoriaMonotributo} activo`},
        ].map(x=>(
          <div key={x.l} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
            <span style={{fontSize:18,flexShrink:0}}>{x.icon}</span>
            <div>
              <p style={{margin:0,fontSize:11,color:"#94a3b8",textTransform:"uppercase",fontWeight:600}}>{x.l}</p>
              <p style={{margin:0,fontSize:13,color:DK}}>{x.v}</p>
            </div>
          </div>
        ))}
      </div>
      <button onClick={onTerminar} style={{background:P,color:"#fff",border:"none",borderRadius:14,padding:"16px 32px",fontSize:16,fontWeight:800,cursor:"pointer",width:"100%",maxWidth:360}}>
        Ir a mi panel →
      </button>
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
      {/* Header */}
      <div style={{background:DK,padding:"14px 20px",display:"flex",alignItems:"center",gap:12}}>
        <Logo size={28}/>
        <div>
          <p style={{margin:0,fontSize:14,fontWeight:800,color:"#fff"}}>PuntoClases</p>
          <p style={{margin:0,fontSize:11,color:"rgba(255,255,255,0.5)"}}>Registro de profe — paso {paso} de 4</p>
        </div>
      </div>

      {/* Barra progreso */}
      <div style={{display:"flex",gap:0}}>
        {[1,2,3,4].map(n=>(
          <div key={n} style={{flex:1,height:4,background:paso>=n?P:"#e2e8f0",transition:"background 0.3s"}}/>
        ))}
      </div>

      <div style={{flex:1,padding:"20px 20px 100px",overflowY:"auto"}}>
        <h2 style={{margin:"0 0 6px",color:DK,fontSize:20,fontWeight:800}}>{pasosTitulos[paso-1]}</h2>

        {/* PASO 1 — Datos personales */}
        {paso===1 && (
          <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:16}}>
            <p style={{margin:0,fontSize:13,color:"#64748b"}}>Completá tus datos para crear tu perfil de profe.</p>
            {[
              {label:"Nombre completo *",key:"nombre",placeholder:"Ej: David González",type:"text"},
              {label:"Mail *",key:"mail",placeholder:"tu@mail.com",type:"email"},
              {label:"Teléfono / WhatsApp *",key:"tel",placeholder:"223 456-7890",type:"tel"},
              {label:"Título o formación *",key:"titulo",placeholder:"Ej: Lic. en Matemática — UNMdP",type:"text"},
              {label:"Años de experiencia",key:"experiencia",placeholder:"Ej: 8",type:"number"},
            ].map(f=>(
              <div key={f.key} style={{display:"flex",flexDirection:"column",gap:5}}>
                <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>{f.label}</label>
                <input type={f.type} value={form[f.key]}
                  onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                  placeholder={f.placeholder}
                  style={{border:`2px solid ${form[f.key]?P+"44":"#e2e8f0"}`,borderRadius:12,padding:"12px 16px",fontSize:14,outline:"none",background:"#fff",color:DK,fontFamily:"inherit",transition:"border 0.2s"}}/>
              </div>
            ))}
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Contraseña *</label>
              <input type="password" value={form.pass} onChange={e=>setForm(p=>({...p,pass:e.target.value}))}
                placeholder="Mínimo 8 caracteres"
                style={{border:`2px solid ${form.pass.length>0&&form.pass.length<8?"#fca5a5":"#e2e8f0"}`,borderRadius:12,padding:"12px 16px",fontSize:14,outline:"none",background:"#fff",color:DK,fontFamily:"inherit"}}/>
              {form.pass.length>0 && form.pass.length<8 && <p style={{margin:"2px 0 0",fontSize:11,color:"#dc2626"}}>La contraseña necesita al menos 8 caracteres</p>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Repetir contraseña *</label>
              <input type="password" value={form.pass2} onChange={e=>setForm(p=>({...p,pass2:e.target.value}))}
                placeholder="Repetí la contraseña"
                style={{border:`2px solid ${form.pass2&&form.pass!==form.pass2?"#fca5a5":"#e2e8f0"}`,borderRadius:12,padding:"12px 16px",fontSize:14,outline:"none",background:"#fff",color:DK,fontFamily:"inherit"}}/>
              {form.pass2 && form.pass!==form.pass2 && <p style={{margin:"2px 0 0",fontSize:11,color:"#dc2626"}}>Las contraseñas no coinciden</p>}
            </div>
          </div>
        )}

        {/* PASO 2 — Materias y modalidad */}
        {paso===2 && (
          <div style={{display:"flex",flexDirection:"column",gap:16,marginTop:16}}>
            <div>
              <p style={{margin:"0 0 10px",fontWeight:700,fontSize:14,color:DK}}>¿Qué materias das?</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {MATERIAS.map(m=>(
                  <button key={m} onClick={()=>toggle("materias",m)}
                    style={{background:form.materias.includes(m)?P:PL,color:form.materias.includes(m)?"#fff":P,border:`1.5px solid ${form.materias.includes(m)?P:PB}`,borderRadius:99,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
                    {form.materias.includes(m)?"✓ ":""}{m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{margin:"0 0 10px",fontWeight:700,fontSize:14,color:DK}}>¿Qué niveles enseñás?</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {NIVELES_REG.map(n=>(
                  <button key={n} onClick={()=>toggle("niveles",n)}
                    style={{background:form.niveles.includes(n)?BL:"#f0f6fa",color:form.niveles.includes(n)?"#fff":BL,border:`1.5px solid ${form.niveles.includes(n)?BL:"#a8d4e8"}`,borderRadius:99,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                    {form.niveles.includes(n)?"✓ ":""}{n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{margin:"0 0 10px",fontWeight:700,fontSize:14,color:DK}}>¿Cómo das las clases?</p>
              <div style={{display:"flex",gap:10}}>
                {["Presencial","Virtual"].map(m=>(
                  <button key={m} onClick={()=>toggle("modalidad",m)}
                    style={{flex:1,background:form.modalidad.includes(m)?"#f0fdf4":"#f8fafc",color:form.modalidad.includes(m)?"#15803d":"#94a3b8",border:`2px solid ${form.modalidad.includes(m)?"#15803d":"#e2e8f0"}`,borderRadius:12,padding:"14px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
                    {form.modalidad.includes(m)?"✓ ":""}{m}
                  </button>
                ))}
              </div>
            </div>
            {/* Tarifa informativa */}
            <div style={{background:PL,border:`1.5px solid ${PB}`,borderRadius:14,padding:14}}>
              <p style={{margin:"0 0 8px",fontWeight:700,fontSize:13,color:P}}>💰 Tu tarifa en PuntoClases</p>
              <div style={{display:"flex",flexDirection:"column",gap:4,fontSize:13,color:"#374151"}}>
                <span>👤 Clase individual: <strong>${CFG.tarifaProfeInd.toLocaleString("es-AR")} por hora</strong></span>
                <span>👥 Clase grupal: <strong>${CFG.tarifaProfeGrp.toLocaleString("es-AR")} por alumno</strong></span>
                <span style={{fontSize:11,color:"#94a3b8",marginTop:4}}>Tarifa fija garantizada. PuntoClases se encarga del cobro y te transfiere tu parte mensualmente.</span>
              </div>
            </div>
          </div>
        )}

        {/* PASO 3 — Términos y condiciones */}
        {paso===3 && (
          <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:16}}>
            <p style={{margin:0,fontSize:13,color:"#64748b",lineHeight:1.6}}>Antes de continuar, leé y aceptá los siguientes documentos.</p>

            {/* Términos y condiciones */}
            <div style={{background:"#fff",borderRadius:14,border:"1.5px solid #e2e8f0",overflow:"hidden"}}>
              <div style={{background:DK,padding:"12px 16px"}}>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:"#fff"}}>📄 Términos y condiciones del profe</p>
              </div>
              <div style={{padding:16,maxHeight:200,overflowY:"auto",fontSize:13,color:"#374151",lineHeight:1.7}}>
                <p><strong>1. Relación comercial independiente</strong><br/>El profe actúa como prestador independiente de servicios educativos. No existe relación de dependencia laboral con PuntoClases. El profe fija libremente su disponibilidad y puede prestar servicios en otras plataformas.</p>
                <p><strong>2. Facturación</strong><br/>El profe debe estar inscripto en el régimen de monotributo vigente y emitir comprobante fiscal por los pagos recibidos. PuntoClases se reserva el derecho de suspender el pago si no se cumple este requisito.</p>
                <p><strong>3. Tarifas y pagos</strong><br/>La tarifa es de ${CFG.tarifaProfeInd.toLocaleString("es-AR")}/hs para clases individuales y ${CFG.tarifaProfeGrp.toLocaleString("es-AR")} por alumno para grupales. Los pagos se realizan mensualmente por transferencia bancaria, previa liquidación detallada.</p>
                <p><strong>4. Cancelaciones</strong><br/>Si un alumno cancela con menos de 24hs, el profe recibe el {CFG.penalizacionPct}% de su tarifa. Si el alumno no se presenta, el profe recibe el {CFG.penalizacionPct}%. El profe debe marcar la clase como realizada o registrar la ausencia en la app.</p>
                <p><strong>5. Confidencialidad y no competencia</strong><br/>Está prohibido contactar alumnos por fuera de la plataforma con fines comerciales durante la vigencia del acuerdo y 6 meses después. El chat interno es el único canal autorizado.</p>
                <p><strong>6. Devoluciones</strong><br/>El profe se compromete a cargar la devolución de cada clase dentro de las 24hs posteriores a su realización.</p>
                <p><strong>7. Suspensión</strong><br/>PuntoClases puede suspender la cuenta ante incumplimiento de estos términos, con pérdida del saldo pendiente de liquidación si la suspensión es por causa grave.</p>
              </div>
            </div>

            <button onClick={()=>setForm(p=>({...p,terminosAceptados:!p.terminosAceptados}))}
              style={{display:"flex",alignItems:"center",gap:12,background:"none",border:"none",cursor:"pointer",padding:0,textAlign:"left"}}>
              <div style={{width:24,height:24,borderRadius:6,border:`2px solid ${form.terminosAceptados?P:"#e2e8f0"}`,background:form.terminosAceptados?P:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}}>
                {form.terminosAceptados && <span style={{color:"#fff",fontSize:14,fontWeight:800}}>✓</span>}
              </div>
              <span style={{fontSize:13,color:"#374151"}}>Leí y acepto los Términos y condiciones</span>
            </button>

            {/* Política de privacidad */}
            <div style={{background:"#f0f6fa",borderRadius:12,padding:14,border:"1.5px solid #a8d4e8"}}>
              <p style={{margin:"0 0 8px",fontWeight:700,fontSize:13,color:BL}}>🔒 Política de privacidad</p>
              <p style={{margin:0,fontSize:12,color:"#374151",lineHeight:1.6}}>Tus datos personales son utilizados exclusivamente para gestionar tu cuenta y liquidaciones. No son compartidos con terceros. Podés solicitar la eliminación de tu cuenta en cualquier momento.</p>
            </div>

            <button onClick={()=>setForm(p=>({...p,politicaAceptada:!p.politicaAceptada}))}
              style={{display:"flex",alignItems:"center",gap:12,background:"none",border:"none",cursor:"pointer",padding:0,textAlign:"left"}}>
              <div style={{width:24,height:24,borderRadius:6,border:`2px solid ${form.politicaAceptada?P:"#e2e8f0"}`,background:form.politicaAceptada?P:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}}>
                {form.politicaAceptada && <span style={{color:"#fff",fontSize:14,fontWeight:800}}>✓</span>}
              </div>
              <span style={{fontSize:13,color:"#374151"}}>Acepto la Política de privacidad</span>
            </button>
          </div>
        )}

        {/* PASO 4 — Monotributo */}
        {paso===4 && (
          <div style={{display:"flex",flexDirection:"column",gap:16,marginTop:16}}>
            <p style={{margin:0,fontSize:13,color:"#64748b",lineHeight:1.6}}>Para poder pagarte, necesitamos confirmar que tenés monotributo activo. Esto también te protege legalmente.</p>

            <div style={{background:"#fefce8",border:"1.5px solid #fde68a",borderRadius:14,padding:14}}>
              <p style={{margin:"0 0 8px",fontWeight:700,fontSize:13,color:"#92400e"}}>⚖️ ¿Por qué es obligatorio?</p>
              <p style={{margin:0,fontSize:12,color:"#374151",lineHeight:1.6}}>
                PuntoClases te contrata como prestador independiente. Sin monotributo, el vínculo podría interpretarse como relación de dependencia, lo que generaría obligaciones laborales para ambas partes. El monotributo te protege a vos y a nosotros.
              </p>
            </div>

            <button onClick={()=>setForm(p=>({...p,monotributo:!p.monotributo}))}
              style={{display:"flex",alignItems:"center",gap:12,background:form.monotributo?"#f0fdf4":"#fff",border:`2px solid ${form.monotributo?"#15803d":"#e2e8f0"}`,borderRadius:14,padding:"16px",cursor:"pointer",textAlign:"left",transition:"all 0.2s"}}>
              <div style={{width:26,height:26,borderRadius:6,border:`2px solid ${form.monotributo?"#15803d":"#e2e8f0"}`,background:form.monotributo?"#15803d":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {form.monotributo && <span style={{color:"#fff",fontSize:15,fontWeight:800}}>✓</span>}
              </div>
              <div>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:form.monotributo?"#15803d":DK}}>Confirmo que tengo monotributo activo</p>
                <p style={{margin:"2px 0 0",fontSize:12,color:"#64748b"}}>Podés verificarlo en mi.afip.gob.ar</p>
              </div>
            </button>

            {form.monotributo && (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Categoría de monotributo</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {["A","B","C","D","E","F","G","H"].map(cat=>(
                    <button key={cat} onClick={()=>setForm(p=>({...p,categoriaMonotributo:cat}))}
                      style={{width:48,height:48,borderRadius:10,background:form.categoriaMonotributo===cat?P:PL,color:form.categoriaMonotributo===cat?"#fff":P,border:`2px solid ${form.categoriaMonotributo===cat?P:PB}`,fontWeight:800,fontSize:16,cursor:"pointer"}}>
                      {cat}
                    </button>
                  ))}
                </div>
                <p style={{margin:"4px 0 0",fontSize:11,color:"#94a3b8"}}>La categoría figura en tu constancia de inscripción AFIP.</p>
              </div>
            )}

            <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:14,padding:14}}>
              <p style={{margin:"0 0 6px",fontWeight:700,fontSize:13,color:"#15803d"}}>📋 Qué pasa una vez registrado</p>
              <div style={{fontSize:12,color:"#374151",lineHeight:1.8,display:"flex",flexDirection:"column",gap:2}}>
                <span>✓ Podés cargar tu disponibilidad de inmediato</span>
                <span>✓ Los alumnos pueden reservar tus clases</span>
                <span>✓ Recibís la liquidación mensual por transferencia</span>
                <span>✓ Tenés acceso a historial de clases e ingresos</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Botón siguiente */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid #e2e8f0",padding:"14px 20px"}}>
        <button
          disabled={!puedeAvanzar()||cargandoReg}
          onClick={async ()=>{
            if (paso<4) { setPaso(p=>p+1); return; }
            setErrReg("");
            setCargandoReg(true);
            try {
              await registrarProfe({ mail: form.mail.toLowerCase().trim(), pass: form.pass, nombre: form.nombre, tel: form.tel });
              setPaso(5);
            } catch(e) {
              setErrReg(e.message || "No se pudo crear la cuenta. Intentá de nuevo.");
            } finally {
              setCargandoReg(false);
            }
          }}
          style={{width:"100%",background:puedeAvanzar()&&!cargandoReg?P:"#e2e8f0",color:puedeAvanzar()&&!cargandoReg?"#fff":"#94a3b8",border:"none",borderRadius:12,padding:"15px",fontSize:16,fontWeight:800,cursor:puedeAvanzar()&&!cargandoReg?"pointer":"not-allowed",transition:"all 0.2s"}}>
          {cargandoReg?"Creando cuenta...":(paso<4?"Continuar →":"Finalizar registro ✓")}
        </button>
        {errReg && <p style={{margin:"6px 0 0",fontSize:12,color:"#dc2626",textAlign:"center"}}>{errReg}</p>}
        {paso>1 && <button onClick={()=>setPaso(p=>p-1)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",marginTop:8,textDecoration:"underline"}}>← Volver</button>}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// MODAL REPROGRAMAR / CANCELAR — Panel del Alumno
// ════════════════════════════════════════════════════════════════════════════
function ModalReprogramar({ reserva, onCerrar, onConfirmar, onCancelar, cfg }) {
  const [accion, setAccion] = useState(null); // "reprogramar" | "cancelar"
  const [paso, setPaso] = useState(1); // 1=elegir acción, 2=confirmar
  const [nuevaFecha, setNuevaFecha] = useState(null);
  const [nuevaHora, setNuevaHora] = useState(null);
  const [mes, setMes] = useState(new Date().getMonth());
  const [confirmado, setConfirmado] = useState(false);
  const year = new Date().getFullYear();

  // Calcular si la clase es en menos de 24hs (simulado)
  const fechaClase = new Date(`${reserva.fecha}T${reserva.hora}`);
  const ahora = new Date();
  const horasRestantes = (fechaClase - ahora) / (1000*60*60);
  const conCosto = horasRestantes < 24;
  // Lo que pierde el ALUMNO al cancelar tarde: penalización % de la hora.
  // En grupal el saldo se mide sobre 0.8hs, así que pierde 0.8 × % .
  const saldoPerdido = +(((reserva.tipo === "grupal" ? CFG.factorGrupal : 1) * CFG.penalizacionPct / 100).toFixed(2)); // hs (0.5 ind / 0.4 grupal)
  const costoSeña = Math.round(saldoPerdido * CFG.precioInd); // $ que pierde el alumno ($10.000 ind / $8.000 grupal)

  const [dispProfe, setDispProfe] = useState({});
  useEffect(() => {
    if (!reserva?.profe_id) return;
    getDisponibilidad(reserva.profe_id)
      .then(data => {
        const map = (data||[]).reduce((acc, b) => {
          if (!acc[b.fecha]) acc[b.fecha] = {};
          acc[b.fecha][b.hora] = b.tipo;
          return acc;
        }, {});
        setDispProfe(map);
      })
      .catch(err => console.error("Error al cargar disponibilidad:", err));
  }, [reserva?.profe_id]);

  if (confirmado) return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"32px 24px 48px",width:"100%",maxWidth:480,textAlign:"center",display:"flex",flexDirection:"column",gap:16,alignItems:"center"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:accion==="cancelar"?"#fff5f5":"#f0fdf4",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40}}>
          {accion==="cancelar"?"❌":"✅"}
        </div>
        <h3 style={{margin:0,color:DK,fontSize:20,fontWeight:800}}>
          {accion==="cancelar"?"Clase cancelada":"¡Clase reprogramada!"}
        </h3>
        <p style={{margin:0,fontSize:14,color:"#64748b",lineHeight:1.6}}>
          {accion==="cancelar"
            ? conCosto
              ? `Se descontó el ${CFG.penalizacionPct}% (${saldoPerdido}hs) de tu saldo como seña.`
              : "La hora volvió a tu saldo sin costo."
            : `Nueva clase: ${nuevaFecha ? fmt(nuevaFecha) : ""} a las ${nuevaHora}`
          }
        </p>
        <button onClick={onCerrar} style={{background:P,color:"#fff",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer",width:"100%"}}>
          Entendido
        </button>
      </div>
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:16,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {paso===2 && <button onClick={()=>setPaso(1)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:P,padding:0}}>←</button>}
            <h3 style={{margin:0,color:DK,fontSize:17}}>Gestionar reserva</h3>
          </div>
          <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>

        {/* Clase actual */}
        <div style={{background:"#f8fafc",borderRadius:12,padding:"12px 14px"}}>
          <p style={{margin:0,fontSize:13,color:"#374151"}}>
            <strong>{reserva.materia}</strong> · {fmt(reserva.fecha)} a las {reserva.hora} · {reserva.modalidad}
          </p>
        </div>

        {/* Aviso de costo si es menos de 24hs */}
        {conCosto && (
          <div style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:12,padding:"12px 14px"}}>
            <p style={{margin:0,fontWeight:700,fontSize:13,color:"#dc2626"}}>⚠️ Menos de 24hs de anticipación</p>
            <p style={{margin:"4px 0 0",fontSize:12,color:"#374151"}}>
              Cancelar o reprogramar ahora implica perder <strong>el {CFG.penalizacionPct}% de la hora</strong> ({saldoPerdido}hs de saldo = ${costoSeña.toLocaleString("es-AR")}).
            </p>
          </div>
        )}

        {/* PASO 1: Elegir acción */}
        {paso===1 && (<>
          <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>¿Qué querés hacer?</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={()=>{setAccion("reprogramar");setPaso(2);}}
              style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:14,padding:"16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:28}}>🔄</span>
              <div>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:"#15803d"}}>Reprogramar clase</p>
                <p style={{margin:"3px 0 0",fontSize:12,color:"#64748b"}}>
                  {conCosto ? `Costo: ${saldoPerdido}hs de saldo` : "Sin costo con +24hs de anticipación"}
                </p>
              </div>
            </button>
            <button onClick={()=>{setAccion("cancelar");setPaso(2);}}
              style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:14,padding:"16px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:28}}>❌</span>
              <div>
                <p style={{margin:0,fontWeight:700,fontSize:14,color:"#dc2626"}}>Cancelar clase</p>
                <p style={{margin:"3px 0 0",fontSize:12,color:"#64748b"}}>
                  {conCosto ? `Perdés ${saldoPerdido}hs de saldo ($${costoSeña.toLocaleString("es-AR")})` : "La hora vuelve a tu saldo"}
                </p>
              </div>
            </button>
          </div>
        </>)}

        {/* PASO 2A: Reprogramar — elegir nuevo horario */}
        {paso===2 && accion==="reprogramar" && (<>
          <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>Elegí el nuevo horario</p>

          {/* Calendario */}
          <div style={{background:"#f8fafc",borderRadius:14,padding:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <button onClick={()=>setMes(m=>Math.max(m-1,0))} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:P}}>‹</button>
              <span style={{fontWeight:700,fontSize:14,color:DK}}>{MESES[mes]} {year}</span>
              <button onClick={()=>setMes(m=>Math.min(m+1,11))} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:P}}>›</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,textAlign:"center"}}>
              {DIAS.map(d=><div key={d} style={{fontSize:10,color:"#94a3b8",fontWeight:600,paddingBottom:3}}>{d}</div>)}
              {Array(new Date(year,mes,1).getDay()).fill(null).map((_,i)=><div key={`e${i}`}/>)}
              {Array(new Date(year,mes+1,0).getDate()).fill(null).map((_,i)=>{
                const d=i+1;
                const iso=`${year}-${String(mes+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                const tieneDispon = !!(dispProfe[iso] && Object.keys(dispProfe[iso]).length>0);
                const sel = nuevaFecha===iso;
                return (
                  <button key={d} disabled={!tieneDispon} onClick={()=>{setNuevaFecha(iso);setNuevaHora(null);}}
                    style={{aspectRatio:"1",borderRadius:6,border:sel?`2px solid ${P}`:"none",background:sel?P:tieneDispon?PL:"transparent",color:sel?"#fff":tieneDispon?P:"#cbd5e1",fontSize:11,fontWeight:tieneDispon?700:400,cursor:tieneDispon?"pointer":"default"}}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Horarios */}
          {nuevaFecha && (
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {Object.keys(dispProfe[nuevaFecha]||{}).sort().map(h=>(
                <button key={h} onClick={()=>setNuevaHora(h)}
                  style={{background:nuevaHora===h?P:PL,color:nuevaHora===h?"#fff":P,border:`1.5px solid ${nuevaHora===h?P:PB}`,borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {h}
                </button>
              ))}
            </div>
          )}

          {nuevaFecha && nuevaHora && (
            <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:12,padding:"12px 14px"}}>
              <p style={{margin:0,fontSize:13,color:"#166534"}}>
                Nueva fecha: <strong>{fmt(nuevaFecha)} a las {nuevaHora}</strong>
                {conCosto && <span style={{color:"#92400e"}}> · Se descuentan {saldoPerdido}hs de seña</span>}
              </p>
            </div>
          )}

          <button onClick={async ()=>{
            await reprogramarReserva(reserva.id, nuevaFecha, nuevaHora).catch(err=>console.error("Error al reprogramar:",err));
            onConfirmar(nuevaFecha, nuevaHora);
            setConfirmado(true);
          }} disabled={!nuevaFecha||!nuevaHora}
            style={{background:nuevaFecha&&nuevaHora?P:"#e2e8f0",color:nuevaFecha&&nuevaHora?"#fff":"#94a3b8",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:nuevaFecha&&nuevaHora?"pointer":"not-allowed"}}>
            Confirmar reprogramación ✓
          </button>
        </>)}

        {/* PASO 2B: Cancelar — confirmar */}
        {paso===2 && accion==="cancelar" && (<>
          <p style={{margin:0,fontWeight:700,fontSize:15,color:DK}}>¿Confirmás la cancelación?</p>
          <div style={{background:"#f8fafc",borderRadius:12,padding:"14px"}}>
            <div style={{fontSize:13,color:"#374151",display:"flex",flexDirection:"column",gap:4}}>
              <span>📚 {reserva.materia} · {fmt(reserva.fecha)} {reserva.hora}</span>
              {conCosto
                ? <span style={{color:"#dc2626"}}>❌ Perdés <strong>{saldoPerdido}hs</strong> de saldo (${costoSeña.toLocaleString("es-AR")} de seña)</span>
                : <span style={{color:"#15803d"}}>✓ La hora vuelve completa a tu saldo</span>
              }
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setPaso(1)} style={{flex:1,background:"#f1f5f9",border:"none",borderRadius:12,padding:"13px",fontSize:14,fontWeight:700,cursor:"pointer",color:"#475569"}}>
              Volver
            </button>
            <button onClick={async ()=>{
              try {
                const result = await devolverHoras(
                  reserva.id,
                  cfg?.factorGrupal ?? CFG.factorGrupal,
                  cfg?.penalizacionPct ?? CFG.penalizacionPct
                );
                onCancelar(result.saldo_nuevo);
                setConfirmado(true);
              } catch (err) {
                console.error("Error al cancelar:", err);
                alert("No se pudo cancelar: " + (err.message || "intentá de nuevo"));
              }
            }} style={{flex:1,background:"#dc2626",border:"none",borderRadius:12,padding:"13px",fontSize:14,fontWeight:700,cursor:"pointer",color:"#fff"}}>
              Sí, cancelar
            </button>
          </div>
        </>)}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// MODAL REPROGRAMAR / CANCELAR — Panel del Alumno

// ════════════════════════════════════════════════════════════════════════════
// LOGIN UNIFICADO
// ════════════════════════════════════════════════════════════════════════════

function CambiarPasswordScreen({ onTerminar }) {
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(false);
  const puedeGuardar = pass.length>=8 && pass===pass2;
  const inputSt = {border:"2px solid #e2e8f0",borderRadius:12,padding:"12px 16px",fontSize:14,outline:"none",background:"#fff",color:DK,fontFamily:"inherit",width:"100%",boxSizing:"border-box"};
  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",maxWidth:480,margin:"0 auto",padding:"32px 24px",display:"flex",flexDirection:"column",gap:20}}>
      <div style={{textAlign:"center"}}>
        <span style={{fontSize:44}}>🔒</span>
        <h2 style={{margin:"10px 0 4px",color:DK,fontSize:20,fontWeight:800}}>Nueva contraseña</h2>
        <p style={{margin:0,fontSize:13,color:"#64748b"}}>Elegí una contraseña nueva para tu cuenta.</p>
      </div>
      {ok ? (
        <div style={{background:"#f0fdf4",borderRadius:14,padding:20,textAlign:"center",border:"1.5px solid #bbf7d0",display:"flex",flexDirection:"column",gap:12}}>
          <span style={{fontSize:36}}>✅</span>
          <p style={{margin:0,fontWeight:700,color:"#166534"}}>¡Contraseña actualizada!</p>
          <button onClick={onTerminar} style={{background:P,color:"#fff",border:"none",borderRadius:12,padding:"13px",fontSize:15,fontWeight:700,cursor:"pointer"}}>Ir al login →</button>
        </div>
      ) : (<>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Nueva contraseña</label>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Mínimo 8 caracteres" style={inputSt}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Repetir contraseña</label>
          <input type="password" value={pass2} onChange={e=>setPass2(e.target.value)} placeholder="Repetí la contraseña"
            style={{...inputSt,borderColor:pass2&&pass!==pass2?"#fca5a5":"#e2e8f0"}}/>
          {pass2 && pass!==pass2 && <p style={{margin:"2px 0 0",fontSize:11,color:"#dc2626"}}>Las contraseñas no coinciden</p>}
        </div>
        {err && <p style={{margin:0,fontSize:12,color:"#dc2626"}}>{err}</p>}
        <button onClick={async()=>{
          setErr(""); setCargando(true);
          try { await actualizarPassword(pass); setOk(true); }
          catch(e) { setErr(e.message||"No se pudo actualizar. Intentá de nuevo."); }
          finally { setCargando(false); }
        }} disabled={!puedeGuardar||cargando}
          style={{background:puedeGuardar&&!cargando?P:"#e2e8f0",color:puedeGuardar&&!cargando?"#fff":"#94a3b8",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:puedeGuardar&&!cargando?"pointer":"not-allowed"}}>
          {cargando?"Guardando...":"Guardar contraseña"}
        </button>
      </>)}
    </div>
  );
}

function LoginScreen({ onLogin, onRegistroProfe, onRegistroAlumno }) {
  const [mail, setMail]       = useState("");
  const [pass, setPass]       = useState("");
  const [verPass, setVerPass] = useState(false);
  const [error, setError]     = useState("");
  const [cargando, setCargando] = useState(false);
  const [recuperar, setRecuperar] = useState(false);
  const [recMail, setRecMail] = useState("");
  const [recOk, setRecOk]     = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!mail || !pass) { setError("Completá todos los campos."); return; }
    setCargando(true);
    try {
      await login(mail.toLowerCase().trim(), pass);
      const usuario = await getUsuarioActual();
      onLogin(usuario);
    } catch (e) {
      setError("Mail o contraseña incorrectos.");
      setCargando(false);
    }
  };

  if (recuperar) return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",maxWidth:480,margin:"0 auto",padding:"32px 24px",display:"flex",flexDirection:"column",gap:20}}>
      <button onClick={()=>{setRecuperar(false);setRecOk(false);}} style={{background:"none",border:"none",cursor:"pointer",textAlign:"left",fontSize:14,color:P,fontWeight:700,padding:0}}>← Volver</button>
      <div style={{textAlign:"center"}}>
        <span style={{fontSize:44}}>🔑</span>
        <h2 style={{margin:"10px 0 4px",color:DK,fontSize:20,fontWeight:800}}>Recuperar contraseña</h2>
        <p style={{margin:0,fontSize:13,color:"#64748b"}}>Te enviamos un link para resetearla.</p>
      </div>
      {!recOk ? (<>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Tu mail</label>
          <input type="email" value={recMail} onChange={e=>setRecMail(e.target.value)} placeholder="tu@mail.com"
            style={{border:"2px solid #e2e8f0",borderRadius:12,padding:"12px 16px",fontSize:14,outline:"none",background:"#fff",color:DK,fontFamily:"inherit"}}/>
        </div>
        <button onClick={async()=>{ try { await enviarRecuperacion(recMail.toLowerCase().trim()); } catch {} setRecOk(true); }} disabled={!recMail}
          style={{background:recMail?P:"#ccc",color:"#fff",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:recMail?"pointer":"not-allowed"}}>
          Enviar link
        </button>
      </>) : (
        <div style={{background:"#f0fdf4",borderRadius:14,padding:20,textAlign:"center",border:"1.5px solid #bbf7d0"}}>
          <span style={{fontSize:36}}>✉️</span>
          <p style={{margin:"8px 0 0",fontWeight:700,color:"#166534"}}>¡Revisá tu mail!</p>
          <p style={{margin:"6px 0 0",fontSize:13,color:"#374151"}}>Si {recMail} está registrado, te llegará un link en breve.</p>
        </div>
      )}
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:BG,minHeight:"100vh",maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column"}}>
      {/* Hero */}
      <div style={{background:`linear-gradient(160deg,${DK} 0%,#3d3d3d 100%)`,padding:"52px 24px 44px",display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
        <Logo size={60}/>
        <div style={{textAlign:"center",color:"#fff"}}>
          <h1 style={{margin:0,fontSize:28,fontWeight:800,letterSpacing:-0.5}}>PuntoClases</h1>
          <p style={{margin:"6px 0 0",fontSize:14,opacity:0.55}}>Clases de apoyo, cuando las necesitás</p>
        </div>
      </div>

      {/* Form */}
      <div style={{padding:"28px 24px 40px",display:"flex",flexDirection:"column",gap:16}}>
        <h2 style={{margin:0,fontSize:20,fontWeight:800,color:DK}}>Iniciar sesión</h2>

        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Mail</label>
          <input type="email" value={mail} onChange={e=>{setMail(e.target.value);setError("");}}
            placeholder="tu@mail.com" onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            style={{border:`2px solid ${error?"#fca5a5":"#e2e8f0"}`,borderRadius:12,padding:"13px 16px",fontSize:15,outline:"none",background:"#fff",color:DK,fontFamily:"inherit"}}/>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <label style={{fontSize:12,fontWeight:700,color:"#64748b"}}>Contraseña</label>
          <div style={{position:"relative"}}>
            <input type={verPass?"text":"password"} value={pass} onChange={e=>{setPass(e.target.value);setError("");}}
              placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              style={{width:"100%",border:`2px solid ${error?"#fca5a5":"#e2e8f0"}`,borderRadius:12,padding:"13px 48px 13px 16px",fontSize:15,outline:"none",background:"#fff",color:DK,fontFamily:"inherit",boxSizing:"border-box"}}/>
            <button onClick={()=>setVerPass(!verPass)} style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#94a3b8"}}>
              {verPass?"🙈":"👁️"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{background:"#fff5f5",border:"1.5px solid #fecaca",borderRadius:10,padding:"10px 14px"}}>
            <p style={{margin:0,fontSize:13,color:"#dc2626"}}>⚠️ {error}</p>
          </div>
        )}

        <button onClick={handleLogin} disabled={cargando}
          style={{background:cargando?"#e2e8f0":P,color:cargando?"#94a3b8":"#fff",border:"none",borderRadius:12,padding:"15px",fontSize:16,fontWeight:700,cursor:cargando?"not-allowed":"pointer",marginTop:4}}>
          {cargando?"Ingresando...":"Ingresar →"}
        </button>

        <button onClick={()=>setRecuperar(true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:P,fontWeight:600,textDecoration:"underline",padding:0,textAlign:"center"}}>
          Olvidé mi contraseña
        </button>



        <div style={{borderTop:"1px solid #e2e8f0",margin:"4px 0 0",paddingTop:14,display:"flex",flexDirection:"column",gap:8}}>
          <button onClick={onRegistroAlumno} style={{background:PL,border:`1.5px solid ${PB}`,borderRadius:12,padding:"13px",cursor:"pointer",color:P,fontWeight:800,fontSize:14}}>
            🎓 Crear cuenta de alumno
          </button>
          <p style={{margin:0,fontSize:12,color:"#94a3b8",textAlign:"center",lineHeight:1.5}}>
            ¿Querés sumar como profe?{" "}
            <button onClick={onRegistroProfe} style={{background:"none",border:"none",cursor:"pointer",color:P,fontWeight:700,fontSize:12,textDecoration:"underline",padding:0}}>
              Registrate acá
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// APP ROOT — routing por rol
// ════════════════════════════════════════════════════════════════════════════
export default function PuntoClasesApp() {
  const [user, setUser] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [registrandoProfe, setRegistrandoProfe] = useState(false);
  const [registrandoAlumno, setRegistrandoAlumno] = useState(false);
  const [modoRecuperar, setModoRecuperar] = useState(false);

  // Al cargar: revisar si ya hay sesión abierta en Supabase, y escuchar cambios
  useEffect(() => {
    getUsuarioActual().then((u) => { setUser(u); setCargandoSesion(false); }).catch(()=>setCargandoSesion(false));
    const { data } = onAuthChange(async (u) => {
      try { setUser(u ? await getUsuarioActual() : null); } catch { setUser(null); }
    });
    const { data: recData } = onPasswordRecovery(() => setModoRecuperar(true));
    return () => { data.subscription.unsubscribe(); recData.subscription.unsubscribe(); };
  }, []);

  const handleLogin = (u) => {
    setUser(u);
    setRegistrandoProfe(false);
    setRegistrandoAlumno(false);
  };

  const handleLogout = async () => { await logout(); setUser(null); };

  
  // Registro nuevo alumno
  if (registrandoAlumno) return (
    <OnboardingRegistroAlumno onTerminar={()=>setRegistrandoAlumno(false)}/>
  );

  // Registro nuevo profe
  if (registrandoProfe) return (
    <OnboardingRegistroProfe onTerminar={()=>setRegistrandoProfe(false)}/>
  );

  // Cambio de contraseña (link de recuperación)
  if (modoRecuperar) return <CambiarPasswordScreen onTerminar={()=>setModoRecuperar(false)}/>;

  // Login
  if (!user) return (
    <LoginScreen
      onLogin={handleLogin}
      onRegistroProfe={()=>setRegistrandoProfe(true)}
      onRegistroAlumno={()=>setRegistrandoAlumno(true)}
    />
  );

  // Profe nuevo → onboarding
  if (user.rol==="profe" && user.esNuevo) return (
    <OnboardingRegistroProfe onTerminar={()=>setUser({...user, esNuevo:false})}/>
  );

  // Routing por rol
  if (user.rol==="alumno") return <AppAlumno user={user} onLogout={handleLogout}/>;
  if (user.rol==="profe")  return <AppProfeMain user={user} onLogout={handleLogout}/>;
  if (user.rol==="admin")  return <AppAdminMain onLogout={handleLogout}/>;

  return null;
}

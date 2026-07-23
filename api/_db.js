import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

// Conexión directa a Postgres vía el pooler de Supabase (Supavisor, modo
// transacción — puerto 6543). No usa supabase-js ni SUPABASE_SERVICE_ROLE_KEY:
// el rol `postgres` de DATABASE_URL ya es owner/EXECUTE de todas las RPC.
let pool;
export function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 1, // serverless: una conexión corta por invocación
    });
  }
  return pool;
}

// Cliente liviano solo para validar el JWT del usuario contra Supabase Auth.
// La anon key es pública — no reemplaza a la service_role key ni la necesita.
const authClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

export async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return null;
  const { data: { user }, error } = await authClient.auth.getUser(jwt);
  if (error || !user) return null;
  return user;
}

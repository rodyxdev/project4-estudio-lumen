/* =========================================================
   Cliente de Supabase — SOLO servidor.

   Se usa la SERVICE ROLE KEY, que salta cualquier política RLS y tiene acceso
   total al proyecto. Por eso:
     - nunca debe llegar al frontend (public/ no la ve en ningún momento),
     - nunca debe imprimirse en un log ni en un mensaje de error,
     - nunca debe commitearse: vive en .env y en las env vars de Vercel.
   La anon key no sirve aquí: estos endpoints escriben en tablas que el cliente
   no debe poder tocar directamente.
   ========================================================= */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* ---------------------------------------------------------------------------
   Firma de la función RPC de rate limiting.

   ⚠ AJUSTAR SI HACE FALTA: PostgREST pasa los argumentos por NOMBRE, así que
   estas tres cadenas tienen que coincidir exactamente con los nombres de los
   parámetros del CREATE FUNCTION increment_rate_limit que ya está en Supabase.
   Si la función se declaró sin el prefijo `p_` (es decir, `bucket`,
   `window_start`, `max_hits`), basta con cambiar los valores de aquí abajo:
   no hay ninguna otra referencia a esos nombres en el resto del código.
--------------------------------------------------------------------------- */
export const RATE_LIMIT_RPC = {
  fn: 'increment_rate_limit',
  args: {
    bucket: 'p_bucket',
    windowStart: 'p_window_start',
    limit: 'p_limit',
  },
};

let client = null;

/** ¿Hay configuración suficiente para hablar con Supabase? */
export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

/**
 * Cliente único (lazy). En serverless el módulo se reutiliza entre
 * invocaciones calientes, así que crear el cliente una sola vez ahorra trabajo.
 */
export function getSupabase() {
  if (client) return client;

  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase sin configurar: faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.'
    );
  }

  client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      // Código de servidor: no hay sesión de usuario que persistir ni refrescar.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

/**
 * Convierte un error de Supabase en algo logueable.
 * Nunca incluye la key ni la URL completa del proyecto.
 */
export function describeSupabaseError(error) {
  if (!error) return 'error desconocido';
  const partes = [];
  if (error.code) partes.push(`code=${error.code}`);
  if (error.details) partes.push(`details=${error.details}`);
  if (error.hint) partes.push(`hint=${error.hint}`);
  partes.push(`message=${error.message}`);
  return partes.join(' ');
}

/**
 * Incrementa un contador de rate limiting y devuelve cuántos golpes lleva
 * esa ventana. La cuenta la lleva Postgres de forma atómica: en serverless no
 * hay memoria compartida entre invocaciones, así que un Map local no serviría.
 *
 * @param {{ bucket: string, windowStart: Date|string, limit: number }} opciones
 * @returns {Promise<number>} número de golpes tras incluir esta petición
 * @throws si la RPC falla — quien llama decide qué hacer (aquí, fail-open)
 */
export async function incrementRateLimit({ bucket, windowStart, limit }) {
  const { args, fn } = RATE_LIMIT_RPC;

  const payload = {
    [args.bucket]: bucket,
    [args.windowStart]: windowStart instanceof Date ? windowStart.toISOString() : windowStart,
    [args.limit]: limit,
  };

  const { data, error } = await getSupabase().rpc(fn, payload);

  if (error) {
    // PGRST202 = PostgREST no encuentra la función con esa firma. Es el error
    // que aparece si los nombres de RATE_LIMIT_RPC.args no coinciden con el DDL.
    if (error.code === 'PGRST202') {
      throw new Error(
        `La función ${fn} no existe con los parámetros (${Object.values(args).join(', ')}). ` +
          'Revisa RATE_LIMIT_RPC.args en src/supabase.js contra el CREATE FUNCTION real. ' +
          describeSupabaseError(error)
      );
    }
    throw new Error(describeSupabaseError(error));
  }

  // La función puede devolver un entero suelto o una fila; aceptamos ambos.
  if (typeof data === 'number') return data;
  if (Array.isArray(data) && data.length) {
    const fila = data[0];
    if (typeof fila === 'number') return fila;
    const valor = fila.hits ?? fila.count ?? fila.increment_rate_limit;
    if (typeof valor === 'number') return valor;
  }
  if (data && typeof data === 'object') {
    const valor = data.hits ?? data.count ?? data.increment_rate_limit;
    if (typeof valor === 'number') return valor;
  }

  throw new Error(`Respuesta inesperada de ${fn}: ${JSON.stringify(data)}`);
}

/** Inicio de la ventana de un minuto que contiene a `ahora`. */
export function truncateToMinute(ahora = new Date()) {
  const d = new Date(ahora);
  d.setUTCSeconds(0, 0);
  return d;
}

/** Inicio de la ventana de una hora que contiene a `ahora`. */
export function truncateToHour(ahora = new Date()) {
  const d = new Date(ahora);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

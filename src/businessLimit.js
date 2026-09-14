/* =========================================================
   Capa 2 — límite de negocio.

   Se consume MANUALMENTE dentro del handler, después de que la validación
   pasó y justo antes del insert. Esa colocación es el punto entero de esta
   capa y NO cambia con la migración: equivocarse rellenando un formulario
   devuelve 400 y no gasta cuota; solo cuenta lo que de verdad iba a
   convertirse en una fila.

   El contador vive en Postgres (RPC increment_rate_limit), ventana de una hora.

   FAIL-OPEN: si la RPC falla se deja pasar el envío y se registra como
   ADVERTENCIA. Aquí el riesgo es menor que en la capa 1 (el envío ya pasó
   validación y honeypot, y la capa 1 sigue delante), pero significa que
   durante la incidencia alguien podría superar los 3/hora.
   ========================================================= */
import { incrementRateLimit, truncateToHour, isSupabaseConfigured } from './supabase.js';

const MAX = Number(process.env.BUSINESS_LIMIT_MAX) || 3;

/** Igual que en la capa 1: la IP forma parte del bucket, si no sería global. */
function bucketDe(endpoint, ip) {
  return `business:${endpoint}:${ip}`;
}

/**
 * Intenta consumir una unidad de cuota.
 * @param {string} endpoint  p.ej. 'cotizacion'
 * @param {string} ip
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterSeconds: number }>}
 */
export async function consumeBusinessLimit(endpoint, ip) {
  if (!isSupabaseConfigured()) {
    console.warn(
      `[business-limit] FAIL-OPEN — Supabase sin configurar, no se aplica cuota a ${endpoint}.`
    );
    return { allowed: true, remaining: MAX, retryAfterSeconds: 0 };
  }

  const inicioVentana = truncateToHour();

  let hits;
  try {
    hits = await incrementRateLimit({
      bucket: bucketDe(endpoint, ip),
      windowStart: inicioVentana,
      limit: MAX,
    });
  } catch (err) {
    console.warn(
      `[business-limit] FAIL-OPEN — no se pudo contabilizar el envío de ${ip} en ${endpoint}. ` +
        `Se acepta sin aplicar la cuota de ${MAX}/hora.\n` +
        `                 ${err.message}`
    );
    return { allowed: true, remaining: MAX, retryAfterSeconds: 0 };
  }

  if (hits > MAX) {
    // Segundos que faltan para que empiece la siguiente ventana horaria.
    const finVentana = inicioVentana.getTime() + 60 * 60 * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((finVentana - Date.now()) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  return { allowed: true, remaining: Math.max(0, MAX - hits), retryAfterSeconds: 0 };
}

export const BUSINESS_LIMIT_CONFIG = { windowMs: 60 * 60 * 1000, max: MAX };

/* =========================================================
   Capa 2 — límite de negocio.

   Se consume MANUALMENTE dentro del handler, después de que la validación
   pasó y justo antes del insert. Esa colocación es el punto entero de esta
   capa: equivocarse rellenando un formulario devuelve 400 y NO gasta cuota;
   solo cuenta lo que de verdad iba a convertirse en una fila.

   Ventana deslizante en memoria por (endpoint + IP). Al ser en memoria,
   el contador se reinicia si se reinicia el proceso y no se comparte entre
   instancias — suficiente para un solo servidor, no para varios.
   ========================================================= */

const WINDOW_MS = Number(process.env.BUSINESS_LIMIT_WINDOW_MS) || 60 * 60 * 1000; // 1 hora
const MAX = Number(process.env.BUSINESS_LIMIT_MAX) || 3;

/** @type {Map<string, number[]>} clave → timestamps de los envíos válidos */
const hits = new Map();

function prune(timestamps, cutoff) {
  return timestamps.filter((t) => t > cutoff);
}

/**
 * Intenta consumir una unidad de cuota.
 * @param {string} endpoint  p.ej. 'cotizacion'
 * @param {string} ip
 * @returns {{ allowed: boolean, remaining: number, retryAfterSeconds: number }}
 */
export function consumeBusinessLimit(endpoint, ip) {
  const key = `${endpoint}:${ip}`;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const timestamps = prune(hits.get(key) || [], cutoff);

  if (timestamps.length >= MAX) {
    hits.set(key, timestamps);
    const retryAfterSeconds = Math.max(1, Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return { allowed: true, remaining: MAX - timestamps.length, retryAfterSeconds: 0 };
}

/** Cuota consumida sin tocarla (para tests y diagnóstico). */
export function peekBusinessLimit(endpoint, ip) {
  const timestamps = prune(hits.get(`${endpoint}:${ip}`) || [], Date.now() - WINDOW_MS);
  return { used: timestamps.length, remaining: Math.max(0, MAX - timestamps.length) };
}

/** Vacía el contador (tests). */
export function resetBusinessLimit() {
  hits.clear();
}

// Barrido periódico: sin esto el Map crece con una entrada por IP para siempre.
const sweep = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of hits) {
    const vivos = prune(timestamps, cutoff);
    if (vivos.length === 0) hits.delete(key);
    else hits.set(key, vivos);
  }
}, Math.min(WINDOW_MS, 10 * 60 * 1000));

// No debe mantener vivo el proceso.
if (typeof sweep.unref === 'function') sweep.unref();

export const BUSINESS_LIMIT_CONFIG = { windowMs: WINDOW_MS, max: MAX };

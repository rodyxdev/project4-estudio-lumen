/* =========================================================
   Capa 1 — antiflood.

   Middleware puro, montado ANTES de la validación: cuenta toda petición que
   toque el endpoint, tenga el cuerpo que tenga. Su trabajo es frenar al bot
   que dispara basura sin parar, no juzgar el contenido.

   El contador vive ahora en Postgres (RPC increment_rate_limit) en vez de en
   memoria: en Vercel cada invocación puede caer en una instancia distinta, así
   que un Map local no contaría nada útil.

   FAIL-OPEN: si la RPC falla (red, Supabase pausado, función mal desplegada) se
   deja pasar la petición y se registra como ERROR. Preferimos aceptar spam
   durante una caída de infraestructura antes que tirar el formulario entero
   para todo el mundo. Ver el reporte de decisiones.
   ========================================================= */
import { incrementRateLimit, truncateToMinute, isSupabaseConfigured } from './supabase.js';

const MAX = Number(process.env.ANTIFLOOD_MAX) || 20;

/**
 * El bucket incluye la IP: sin ella el contador sería global y 20 peticiones
 * por minuto entre TODOS los visitantes dejaría el sitio inservible en cuanto
 * pasara alguien más. El prefijo se mantiene para poder filtrar por tipo.
 */
function bucketDe(ip) {
  return `antiflood:${ip}`;
}

export async function antiflood(req, res, next) {
  if (!isSupabaseConfigured()) {
    console.error('[antiflood] Supabase sin configurar: no se aplica límite (fail-open).');
    return next();
  }

  let hits;
  try {
    hits = await incrementRateLimit({
      bucket: bucketDe(req.ip),
      windowStart: truncateToMinute(),
      limit: MAX,
    });
  } catch (err) {
    // Fail-open deliberado. Se registra como error porque significa que el
    // sitio está temporalmente sin protección de capa 1.
    console.error(
      `[antiflood] FAIL-OPEN — no se pudo contabilizar la petición de ${req.ip} ` +
        `en ${req.method} ${req.originalUrl}. La petición SIGUE ADELANTE sin límite.\n` +
        `           ${err.message}`
    );
    return next();
  }

  if (hits > MAX) {
    console.warn(`[antiflood] ${req.ip} bloqueado en ${req.method} ${req.originalUrl} (${hits}/${MAX})`);
    res.set('Retry-After', '60');
    return res.status(429).json({
      ok: false,
      error: 'TooManyRequests',
      message: 'Demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.',
    });
  }

  return next();
}

export const ANTIFLOOD_CONFIG = { windowMs: 60 * 1000, max: MAX };

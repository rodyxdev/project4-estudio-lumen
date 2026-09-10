/* =========================================================
   Capa 1 — antiflood.

   Middleware puro, montado ANTES de la validación: cuenta toda petición que
   toque el endpoint, tenga el cuerpo que tenga. Su trabajo es frenar al bot
   que dispara basura sin parar, no juzgar el contenido.

   El límite es deliberadamente generoso: un humano que se pelea con un
   formulario nunca debería acercarse. El límite estrecho vive en la capa 2,
   y ese solo cuenta envíos que ya pasaron la validación.
   ========================================================= */
import { rateLimit } from 'express-rate-limit';

const WINDOW_MS = Number(process.env.ANTIFLOOD_WINDOW_MS) || 60 * 1000;
const MAX = Number(process.env.ANTIFLOOD_MAX) || 20;

export const antiflood = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX,
  standardHeaders: 'draft-7', // RateLimit / RateLimit-Policy
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[antiflood] ${req.ip} bloqueado en ${req.method} ${req.originalUrl}`);
    res.status(429).json({
      ok: false,
      error: 'TooManyRequests',
      message: 'Demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.',
    });
  },
});

export const ANTIFLOOD_CONFIG = { windowMs: WINDOW_MS, max: MAX };

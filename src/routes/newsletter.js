import express from 'express';
import { validateNewsletter } from '../validation.js';
import { subscribeEmail } from '../subscribers.js';
import { consumeBusinessLimit } from '../businessLimit.js';
import { isHoneypotTriggered, logHoneypot } from '../honeypot.js';

const router = express.Router();

const ENDPOINT = 'newsletter';

// Misma respuesta para alta nueva, reactivación, email ya suscrito y honeypot:
// ni el cliente ni un bot deben poder deducir qué pasó por dentro.
const EXITO_STATUS = 200;
const EXITO_BODY = {
  ok: true,
  message: 'Suscripción confirmada. Recibirás un correo al mes.',
};

// POST /api/newsletter
router.post('/', async (req, res, next) => {
  // 1. Señuelo.
  if (isHoneypotTriggered(req.body)) {
    logHoneypot(req, ENDPOINT);
    return res.status(EXITO_STATUS).json(EXITO_BODY);
  }

  // 2. Validación.
  const { valid, errors, value } = validateNewsletter(req.body);
  if (!valid) {
    return res.status(400).json({
      ok: false,
      error: 'ValidationError',
      message: 'Revisa el correo introducido e inténtalo de nuevo.',
      fields: errors,
    });
  }

  // 3. Capa 2.
  const cuota = await consumeBusinessLimit(ENDPOINT, req.ip);
  if (!cuota.allowed) {
    console.warn(`[business-limit] ${req.ip} agotó la cuota de ${ENDPOINT}`);
    res.set('Retry-After', String(cuota.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: 'TooManyRequests',
      message: 'Has enviado varias suscripciones en poco tiempo. Inténtalo de nuevo más tarde.',
    });
  }

  try {
    const { id, status } = await subscribeEmail(value.email);
    // El detalle solo se registra en servidor.
    console.log(`[newsletter] ${value.email} → ${status} (subscriber #${id})`);
    return res.status(EXITO_STATUS).json(EXITO_BODY);
  } catch (err) {
    return next(err);
  }
});

export default router;

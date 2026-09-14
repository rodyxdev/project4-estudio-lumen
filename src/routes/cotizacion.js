import express from 'express';
import { validateCotizacion } from '../validation.js';
import { saveAndNotify } from '../inquiryService.js';
import { consumeBusinessLimit } from '../businessLimit.js';
import { isHoneypotTriggered, logHoneypot } from '../honeypot.js';

const router = express.Router();

const ENDPOINT = 'cotizacion';

// Misma respuesta para el camino legítimo y para el honeypot.
const EXITO_STATUS = 201;
const EXITO_BODY = {
  ok: true,
  message: 'Solicitud recibida. Te respondemos en un máximo de 48 horas hábiles.',
};

// POST /api/cotizacion
router.post('/', async (req, res, next) => {
  // 1. Señuelo.
  if (isHoneypotTriggered(req.body)) {
    logHoneypot(req, ENDPOINT);
    return res.status(EXITO_STATUS).json(EXITO_BODY);
  }

  // 2. Validación (incluye la whitelist de project_type y budget_range).
  const { valid, errors, value } = validateCotizacion(req.body);
  if (!valid) {
    return res.status(400).json({
      ok: false,
      error: 'ValidationError',
      message: 'Revisa los campos marcados e inténtalo de nuevo.',
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
      message: 'Has enviado varias solicitudes en poco tiempo. Inténtalo de nuevo más tarde.',
    });
  }

  try {
    await saveAndNotify(value);
    return res.status(EXITO_STATUS).json(EXITO_BODY);
  } catch (err) {
    return next(err);
  }
});

export default router;

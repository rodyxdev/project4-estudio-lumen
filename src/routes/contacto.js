import express from 'express';
import { validateContacto } from '../validation.js';
import { saveAndNotify } from '../inquiryService.js';
import { consumeBusinessLimit } from '../businessLimit.js';
import { isHoneypotTriggered, logHoneypot } from '../honeypot.js';

const router = express.Router();

const ENDPOINT = 'contacto';

// Respuesta de éxito. Se usa tal cual en el camino legítimo y en el del
// honeypot, para que un bot no pueda distinguirlos por status ni por cuerpo.
const EXITO_STATUS = 201;
const EXITO_BODY = {
  ok: true,
  message: 'Mensaje recibido. Te respondemos en horario de oficina.',
};

// POST /api/contacto
router.post('/', async (req, res, next) => {
  // 1. Señuelo: fuera antes de tocar nada.
  if (isHoneypotTriggered(req.body)) {
    logHoneypot(req, ENDPOINT);
    return res.status(EXITO_STATUS).json(EXITO_BODY);
  }

  // 2. Validación. Un 400 aquí no consume cuota de negocio.
  const { valid, errors, value } = validateContacto(req.body);
  if (!valid) {
    return res.status(400).json({
      ok: false,
      error: 'ValidationError',
      message: 'Revisa los campos marcados e inténtalo de nuevo.',
      fields: errors,
    });
  }

  // 3. Capa 2: solo llegan aquí los envíos con formato correcto.
  const cuota = await consumeBusinessLimit(ENDPOINT, req.ip);
  if (!cuota.allowed) {
    console.warn(`[business-limit] ${req.ip} agotó la cuota de ${ENDPOINT}`);
    res.set('Retry-After', String(cuota.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: 'TooManyRequests',
      message: 'Has enviado varios mensajes en poco tiempo. Inténtalo de nuevo más tarde.',
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

/* =========================================================
   Honeypot.

   Los tres formularios llevan un campo señuelo escondido por CSS (no
   type="hidden": los bots lo reconocen). Un navegador real nunca lo rellena
   porque no lo ve; un bot que autocompleta todo lo que encuentra, sí.

   Si llega con contenido: se responde EXACTAMENTE lo mismo que en un envío
   legítimo — mismo status y mismo cuerpo — para no darle al bot la señal de
   que ha sido detectado, pero no se toca ni la base ni el correo.
   ========================================================= */

/** Nombre del campo señuelo. Suena a campo de negocio real a propósito. */
export const HONEYPOT_FIELD = 'company_website';

/** ¿Viene el señuelo con algo dentro? */
export function isHoneypotTriggered(body = {}) {
  const value = body[HONEYPOT_FIELD];
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

/**
 * Registra el intento. Solo en servidor: la respuesta al cliente no cambia.
 * @param {import('express').Request} req
 * @param {string} endpoint
 */
export function logHoneypot(req, endpoint) {
  console.warn(
    `[honeypot] intento bloqueado — ip=${req.ip} endpoint=${endpoint} ` +
      `campo=${HONEYPOT_FIELD} ua="${req.get('user-agent') || 'n/a'}"`
  );
}

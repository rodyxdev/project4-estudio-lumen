/* =========================================================
   Validación server-side, manual y sin dependencias.

   Contrato único: los nombres de campo en inglés que envía public/js/main.js
   (name, email, phone, project_type, budget_range, message). No hay alias.

   Devuelve siempre { valid, errors, value }:
     - errors: { campo: 'motivo legible' }
     - value:  objeto ya normalizado (trim + email en minúsculas)
   ========================================================= */

// Regex razonable: algo@algo.tld, sin espacios y con TLD de 2+ caracteres.
// No pretende cubrir el RFC 5322 entero; el correo real se valida enviando.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export const LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  message: 2000,
};

/* Valores admitidos en /api/cotizacion. Deben coincidir con los <option>
   de #cot-tipo y #cot-presupuesto en public/index.html: si allí se añade
   una opción, hay que añadirla aquí o el servidor la rechazará con 400. */
export const PROJECT_TYPES = Object.freeze([
  'residencial',
  'comercial',
  'remodelacion',
  'asesoria',
  'otro',
]);

export const BUDGET_RANGES = Object.freeze([
  'lt-5k',
  '5k-15k',
  '15k-30k',
  '30k-60k',
  'gt-60k',
  'por-definir',
]);

/* Caracteres de control C0 (mas DEL), excepto tab, LF y CR, que si son
   legitimos dentro de un textarea. Se eliminan siempre: Postgres rechaza el
   byte nulo en columnas `text`, y sin ese filtro un byte nulo en cualquier
   campo hacia fallar el INSERT y devolvia un 500 por basura del cliente. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Convierte cualquier entrada en string recortado ('' si no es texto usable). */
function str(value) {
  if (typeof value === 'string') return value.replace(CONTROL_CHARS, '').trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/* Campos de una sola línea: un salto de línea ahí no aporta nada y es la forma
   clásica de intentar inyectar cabeceras en el correo de notificación.
   Nodemailer ya lo neutraliza por su cuenta; esto es defensa en profundidad. */
function oneLine(value) {
  return str(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function checkRequired(errors, field, value, label, max) {
  if (!value) {
    errors[field] = `${label} es obligatorio.`;
    return false;
  }
  if (value.length > max) {
    errors[field] = `${label} no puede superar los ${max} caracteres.`;
    return false;
  }
  return true;
}

function checkEmail(errors, value) {
  if (!value) {
    errors.email = 'El correo electrónico es obligatorio.';
    return false;
  }
  if (value.length > LIMITS.email) {
    errors.email = `El correo no puede superar los ${LIMITS.email} caracteres.`;
    return false;
  }
  if (!EMAIL_RE.test(value)) {
    errors.email = 'El correo electrónico no tiene un formato válido.';
    return false;
  }
  return true;
}

/** Campo opcional: si viene, solo se comprueba la longitud. */
function checkOptional(errors, field, value, label, max) {
  if (value && value.length > max) {
    errors[field] = `${label} no puede superar los ${max} caracteres.`;
    return false;
  }
  return true;
}

/** Obligatorio y además dentro de una lista cerrada de valores. */
function checkEnum(errors, field, value, label, allowed) {
  if (!value) {
    errors[field] = `${label} es obligatorio.`;
    return false;
  }
  if (!allowed.includes(value)) {
    errors[field] = `${label} no es una opción válida.`;
    return false;
  }
  return true;
}

/** POST /api/contacto — name, email, message. */
export function validateContacto(body = {}) {
  const errors = {};
  const name = oneLine(body.name);
  const email = oneLine(body.email).toLowerCase();
  const message = str(body.message);

  checkRequired(errors, 'name', name, 'El nombre', LIMITS.name);
  checkEmail(errors, email);
  checkRequired(errors, 'message', message, 'El mensaje', LIMITS.message);

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { type: 'contacto', name, email, phone: null, project_type: null, budget_range: null, message },
  };
}

/** POST /api/cotizacion — name, email, project_type, budget_range, message (phone opcional). */
export function validateCotizacion(body = {}) {
  const errors = {};
  const name = oneLine(body.name);
  const email = oneLine(body.email).toLowerCase();
  const phone = oneLine(body.phone);
  const projectType = oneLine(body.project_type);
  const budgetRange = oneLine(body.budget_range);
  const message = str(body.message);

  checkRequired(errors, 'name', name, 'El nombre', LIMITS.name);
  checkEmail(errors, email);
  checkOptional(errors, 'phone', phone, 'El teléfono', LIMITS.phone);
  checkEnum(errors, 'project_type', projectType, 'El tipo de proyecto', PROJECT_TYPES);
  checkEnum(errors, 'budget_range', budgetRange, 'El rango de presupuesto', BUDGET_RANGES);
  checkRequired(errors, 'message', message, 'El mensaje', LIMITS.message);

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      type: 'cotizacion',
      name,
      email,
      phone: phone || null,
      project_type: projectType,
      budget_range: budgetRange,
      message,
    },
  };
}

/** POST /api/newsletter — solo email. */
export function validateNewsletter(body = {}) {
  const errors = {};
  const email = oneLine(body.email).toLowerCase();
  checkEmail(errors, email);

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { email },
  };
}

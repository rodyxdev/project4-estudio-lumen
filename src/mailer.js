/* =========================================================
   Correo — Nodemailer contra Mailtrap sandbox.

   Regla de la fase 2: el correo es best-effort. La fuente de verdad es el
   INSERT en SQLite; si el envío falla, se registra el error y la petición
   del usuario sigue siendo un éxito. Por eso nada de aquí debe lanzar
   hacia el handler de la ruta sin que este lo capture.
   ========================================================= */
import nodemailer from 'nodemailer';

let transporter = null;
let transporterKey = '';

/** Lee la config SMTP del entorno en cada llamada (permite cambiarla en caliente en pruebas). */
function readConfig() {
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 2525,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Estudio Lumen <no-reply@estudiolumen.example>',
    to: process.env.ADMIN_NOTIFY_EMAIL || '',
  };
}

export function isMailEnabled() {
  const { host, user, pass, to } = readConfig();
  return Boolean(host && user && pass && to);
}

function getTransporter(config) {
  // Se recrea solo si cambió alguna credencial (útil al simular fallos de SMTP).
  const key = `${config.host}:${config.port}:${config.user}:${config.pass}`;
  if (transporter && transporterKey === key) return transporter;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: false, // Mailtrap sandbox usa STARTTLS en 2525/587
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  transporterKey = key;
  return transporter;
}

const ETIQUETAS = {
  contacto: 'Contacto general',
  cotizacion: 'Solicitud de cotización',
};

function buildBody(inquiry) {
  const filas = [
    ['Tipo', ETIQUETAS[inquiry.type] || inquiry.type],
    ['Nombre', inquiry.name],
    ['Email', inquiry.email],
    ['Teléfono', inquiry.phone || '—'],
    ['Tipo de proyecto', inquiry.project_type || '—'],
    ['Presupuesto', inquiry.budget_range || '—'],
    ['ID interno', `#${inquiry.id}`],
  ];

  const text =
    filas.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nMensaje:\n${inquiry.message}\n`;

  const escape = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#2b2420;line-height:1.6">
      <h2 style="font-family:Georgia,serif;color:#b75e3c;margin:0 0 16px">
        ${escape(ETIQUETAS[inquiry.type] || inquiry.type)}
      </h2>
      <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
        ${filas
          .map(
            ([k, v]) =>
              `<tr><td style="color:#6f645b">${escape(k)}</td><td><strong>${escape(v)}</strong></td></tr>`
          )
          .join('')}
      </table>
      <p style="margin-top:20px;font-size:14px"><strong>Mensaje</strong></p>
      <p style="white-space:pre-wrap;font-size:14px;background:#faf6f1;padding:12px;border-radius:8px">${escape(
        inquiry.message
      )}</p>
    </div>`;

  return { text, html };
}

/**
 * Envía la notificación interna de una consulta.
 * Lanza si el SMTP falla — quien llama debe capturarlo y continuar.
 */
export async function sendInquiryNotification(inquiry) {
  const config = readConfig();

  if (!isMailEnabled()) {
    throw new Error(
      'SMTP sin configurar (faltan SMTP_HOST, SMTP_USER, SMTP_PASS o ADMIN_NOTIFY_EMAIL)'
    );
  }

  const { text, html } = buildBody(inquiry);
  const etiqueta = ETIQUETAS[inquiry.type] || inquiry.type;

  const info = await getTransporter(config).sendMail({
    from: config.from,
    to: config.to,
    replyTo: `${inquiry.name} <${inquiry.email}>`,
    subject: `[Lumen] ${etiqueta} #${inquiry.id} — ${inquiry.name}`,
    text,
    html,
  });

  return info;
}

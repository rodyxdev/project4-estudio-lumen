/* =========================================================
   Orquestación de una consulta: guardar primero, notificar después.

   Contrato de la fase 2:
   - El INSERT es la fuente de verdad. Si falla, el usuario ve un error real.
   - El correo es best-effort. Si falla, se registra con detalle y la
     respuesta al usuario sigue siendo un éxito: el dato ya está a salvo.
   ========================================================= */
import { insertInquiry } from './db.js';
import { sendInquiryNotification, isMailEnabled } from './mailer.js';

/**
 * @returns {Promise<{ saved: object, mailStatus: 'sent'|'failed'|'disabled' }>}
 * @throws  si falla el INSERT (y solo si falla el INSERT)
 */
export async function saveAndNotify(inquiry) {
  // 1. Persistencia — si esto revienta, la excepción sube y la ruta responde 500.
  const saved = insertInquiry(inquiry);

  // 2. Notificación — cualquier fallo se queda aquí dentro.
  if (!isMailEnabled()) {
    console.warn(
      `[mail] mailStatus=disabled — notificación omitida para inquiry #${saved.id}: ` +
        'SMTP no configurado. El registro está guardado en SQLite.'
    );
    return { saved, mailStatus: 'disabled' };
  }

  try {
    const info = await sendInquiryNotification(saved);
    console.log(
      `[mail] mailStatus=sent — notificación enviada para inquiry #${saved.id} ` +
        `(messageId: ${info.messageId})`
    );
    return { saved, mailStatus: 'sent' };
  } catch (err) {
    console.error(
      `[mail] mailStatus=failed — FALLO al notificar inquiry #${saved.id}. El registro SÍ está guardado en SQLite, ` +
        'revisar y reenviar manualmente.\n' +
        `        tipo=${inquiry.type} email=${inquiry.email}\n` +
        `        code=${err.code || 'n/a'} command=${err.command || 'n/a'} responseCode=${err.responseCode || 'n/a'}\n` +
        `        message=${err.message}`
    );
    return { saved, mailStatus: 'failed' };
  }
}

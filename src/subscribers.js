/* =========================================================
   Suscriptores del boletín.

   Antes vivía en src/db.js con una transacción de SQLite. Con Supabase el
   "buscar y luego escribir" se hace en dos viajes, así que la carrera se cubre
   apoyándose en la restricción UNIQUE de la columna email: si dos peticiones
   simultáneas intentan crear la misma dirección, una recibe 23505 y se trata
   como si la fila ya existiera.

   El contrato público no cambia: created | already_active | reactivated.
   ========================================================= */
import { getSupabase, describeSupabaseError } from './supabase.js';

/** Código de Postgres para violación de UNIQUE. */
const UNIQUE_VIOLATION = '23505';

/**
 * Alta idempotente de suscriptor. El email debe llegar ya normalizado
 * en minúsculas.
 *
 * @param {string} email
 * @returns {Promise<{ id: number, status: 'created'|'already_active'|'reactivated' }>}
 */
export async function subscribeEmail(email) {
  const db = getSupabase();

  const { data: existente, error: errorBusqueda } = await db
    .from('subscribers')
    .select('id, unsubscribed_at')
    .eq('email', email)
    .maybeSingle();

  if (errorBusqueda) {
    throw new Error(`No se pudo consultar el suscriptor: ${describeSupabaseError(errorBusqueda)}`);
  }

  // Caso 1: no existe → alta nueva.
  if (!existente) {
    const { data: creado, error: errorAlta } = await db
      .from('subscribers')
      .insert({ email })
      .select('id')
      .single();

    if (!errorAlta) {
      return { id: creado.id, status: 'created' };
    }

    // Carrera: otra petición lo creó entre el SELECT y el INSERT.
    // No es un fallo — se resuelve releyendo la fila.
    if (errorAlta.code === UNIQUE_VIOLATION) {
      return resolverExistente(db, email);
    }

    throw new Error(`No se pudo dar de alta al suscriptor: ${describeSupabaseError(errorAlta)}`);
  }

  // Caso 2: existe y sigue activo → no se toca nada.
  if (existente.unsubscribed_at === null) {
    return { id: existente.id, status: 'already_active' };
  }

  // Caso 3: existe pero estaba dado de baja → se reactiva.
  const { error: errorReactivar } = await db
    .from('subscribers')
    .update({ unsubscribed_at: null, subscribed_at: new Date().toISOString() })
    .eq('id', existente.id);

  if (errorReactivar) {
    throw new Error(`No se pudo reactivar al suscriptor: ${describeSupabaseError(errorReactivar)}`);
  }

  return { id: existente.id, status: 'reactivated' };
}

/** Relee una fila que apareció por una carrera y decide su estado. */
async function resolverExistente(db, email) {
  const { data, error } = await db
    .from('subscribers')
    .select('id, unsubscribed_at')
    .eq('email', email)
    .single();

  if (error) {
    throw new Error(`No se pudo releer el suscriptor: ${describeSupabaseError(error)}`);
  }

  if (data.unsubscribed_at === null) {
    return { id: data.id, status: 'already_active' };
  }

  const { error: errorReactivar } = await db
    .from('subscribers')
    .update({ unsubscribed_at: null, subscribed_at: new Date().toISOString() })
    .eq('id', data.id);

  if (errorReactivar) {
    throw new Error(`No se pudo reactivar al suscriptor: ${describeSupabaseError(errorReactivar)}`);
  }

  return { id: data.id, status: 'reactivated' };
}

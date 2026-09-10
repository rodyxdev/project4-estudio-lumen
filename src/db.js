/* =========================================================
   Capa de datos — SQLite vía better-sqlite3 (API síncrona).
   El archivo y el esquema se crean en el primer arranque si no existen.
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inquiries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL CHECK(type IN ('contacto','cotizacion')),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  project_type  TEXT,
  budget_range  TEXT,
  message       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  subscribed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_type ON inquiries(type);
`;

let db = null;
let statements = null;

/** Ruta absoluta del archivo SQLite a partir de DB_PATH (relativa a la raíz del proyecto). */
export function resolveDbPath() {
  const configured = process.env.DB_PATH || './data/lumen.sqlite';
  return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
}

/** Abre la conexión (idempotente) y garantiza el esquema. */
export function getDb() {
  if (db) return db;

  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  statements = {
    insertInquiry: db.prepare(`
      INSERT INTO inquiries (type, name, email, phone, project_type, budget_range, message)
      VALUES (@type, @name, @email, @phone, @project_type, @budget_range, @message)
    `),
    findSubscriber: db.prepare('SELECT id, unsubscribed_at FROM subscribers WHERE email = ?'),
    insertSubscriber: db.prepare('INSERT INTO subscribers (email) VALUES (?)'),
    reactivateSubscriber: db.prepare(`
      UPDATE subscribers
         SET unsubscribed_at = NULL,
             subscribed_at = datetime('now')
       WHERE id = ?
    `),
  };

  console.log(`[db] SQLite listo en ${file}`);
  return db;
}

/** Inserta una consulta (contacto o cotización) y devuelve la fila creada. */
export function insertInquiry(inquiry) {
  getDb();
  const info = statements.insertInquiry.run(inquiry);
  return { id: Number(info.lastInsertRowid), ...inquiry };
}

/**
 * Alta idempotente de suscriptor. El email debe llegar ya normalizado en minúsculas.
 * Devuelve { id, status } con status: 'created' | 'already_active' | 'reactivated'.
 * Va en transacción para que el "buscar y luego escribir" no se parta por la mitad.
 */
export function subscribeEmail(email) {
  const database = getDb();

  const run = database.transaction((addr) => {
    const existing = statements.findSubscriber.get(addr);

    if (!existing) {
      const info = statements.insertSubscriber.run(addr);
      return { id: Number(info.lastInsertRowid), status: 'created' };
    }

    if (existing.unsubscribed_at === null) {
      return { id: existing.id, status: 'already_active' };
    }

    statements.reactivateSubscriber.run(existing.id);
    return { id: existing.id, status: 'reactivated' };
  });

  return run(email);
}

/** Cierra la conexión (tests y apagado limpio). */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
    statements = null;
  }
}

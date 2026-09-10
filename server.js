import 'dotenv/config';
import { createApp } from './src/app.js';
import { getDb, closeDb, resolveDbPath } from './src/db.js';
import { isMailEnabled } from './src/mailer.js';

const PORT = Number(process.env.PORT) || 3000;

// Abrir la base antes de escuchar: si el esquema no se puede crear, es mejor
// no arrancar que aceptar formularios que no se van a poder guardar.
try {
  getDb();
} catch (err) {
  console.error(`[db] No se pudo abrir la base en ${resolveDbPath()}:`, err.message);
  process.exit(1);
}

if (!isMailEnabled()) {
  console.warn(
    '[mail] SMTP incompleto: las notificaciones internas quedan desactivadas. ' +
      'Los formularios se siguen guardando en SQLite.'
  );
}

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Estudio Lumen escuchando en http://localhost:${PORT}`);
  console.log(`Health check:              http://localhost:${PORT}/health`);
});

// Apagado limpio (útil con `node --watch` y con contenedores).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} recibido, cerrando servidor...`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}

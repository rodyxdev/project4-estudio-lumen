/* =========================================================
   Servidor para desarrollo local.

   En Vercel no se usa este archivo: allí el punto de entrada es api/index.js,
   que exporta la misma app de src/app.js como función serverless. Ambos hablan
   contra el mismo Supabase.
   ========================================================= */
import 'dotenv/config';
import { createApp } from './src/app.js';
import { isSupabaseConfigured } from './src/supabase.js';
import { isMailEnabled } from './src/mailer.js';

const PORT = Number(process.env.PORT) || 3000;

// Sin Supabase no hay dónde guardar nada: mejor no arrancar que aceptar
// formularios que se van a perder.
if (!isSupabaseConfigured()) {
  console.error(
    '[supabase] Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
      'Copia .env.example a .env y rellénalas antes de arrancar.'
  );
  process.exit(1);
}

if (!isMailEnabled()) {
  console.warn(
    '[mail] SMTP incompleto: las notificaciones internas quedan desactivadas. ' +
      'Los formularios se siguen guardando en Supabase.'
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
    server.close(() => process.exit(0));
  });
}

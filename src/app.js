import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import contactoRouter from './routes/contacto.js';
import cotizacionRouter from './routes/cotizacion.js';
import newsletterRouter from './routes/newsletter.js';
import { antiflood } from './rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Construye y configura la aplicación Express.
 * Vive separado de server.js para poder importarla en tests sin abrir un puerto.
 */
export function createApp() {
  const app = express();

  // No anunciar el framework: es información gratis para quien busca exploits
  // conocidos de una versión concreta.
  app.disable('x-powered-by');

  // Cabeceras de seguridad básicas. Tres líneas en vez de traerse helmet
  // entero para esto:
  //   nosniff        — impide que el navegador adivine el tipo de contenido
  //                    y ejecute como script algo que servimos como JSON.
  //   DENY           — nadie puede meter el sitio en un iframe (clickjacking).
  //   Referrer-Policy — no filtrar la URL completa a terceros al salir del sitio.
  // Ojo: esto solo cubre lo que pasa por la función. Los estáticos los sirve
  // el CDN de Vercel sin tocar Express, y sus cabeceras van en vercel.json.
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Vercel (y cualquier PaaS) sirve la app detrás de su propio edge: la IP que
  // ve Express es la del proxy, no la del visitante, y llega la real en
  // X-Forwarded-For. Sin esto, el rate limiting mete a todos los visitantes en
  // el mismo cubo y el límite de 20/min se agota entre todos: el primer bot deja
  // fuera al resto del mundo.
  //
  // Se activa solo con TRUST_PROXY=1 y con valor 1 (confiar en UN salto, el de
  // Vercel). Nunca incondicionalmente: en local no hay proxy delante, así que
  // confiar en la cabecera dejaría que cualquiera se inventara su IP con un
  // X-Forwarded-For a mano y se saltara ambas capas de límite.
  if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
    console.log('[app] trust proxy = 1 (se confía en un salto de proxy)');
  }

  // Parsers. El límite es holgado para el mensaje de 2000 caracteres y corta
  // cualquier cuerpo absurdo antes de que llegue a la validación.
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: true, limit: '32kb' }));

  // Health check: usado por la verificación manual y por cualquier monitor externo.
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'estudio-lumen',
      uptime: Number(process.uptime().toFixed(3)),
      timestamp: new Date().toISOString(),
    });
  });

  // Frontend estático.
  app.use(express.static(PUBLIC_DIR));

  // API de formularios.
  // El antiflood (capa 1) va montado por delante de los routers: cuenta la
  // petición antes de que nadie mire el cuerpo. El límite de negocio (capa 2)
  // vive dentro de cada handler, después de la validación.
  //
  // Nota: req.ip sale del socket porque no hay 'trust proxy' activado. Si esto
  // acaba detrás de un proxy o CDN, hay que configurarlo o todas las peticiones
  // compartirán la IP del proxy y el límite se aplicará a todo el mundo junto.
  app.use('/api/contacto', antiflood, contactoRouter);
  app.use('/api/cotizacion', antiflood, cotizacionRouter);
  app.use('/api/newsletter', antiflood, newsletterRouter);

  // 404 para cualquier cosa que no sea un estático ni una ruta conocida.
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Not Found', path: req.originalUrl });
  });

  // Manejador de errores.
  app.use((err, req, res, next) => {
    // JSON malformado en el cuerpo: es culpa del cliente, no del servidor.
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        ok: false,
        error: 'BadRequest',
        message: 'El cuerpo de la petición no es JSON válido.',
      });
    }

    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        ok: false,
        error: 'PayloadTooLarge',
        message: 'El contenido enviado es demasiado grande.',
      });
    }

    console.error('[error]', err);
    return res.status(err.status || 500).json({
      ok: false,
      error: 'InternalServerError',
      message: 'No pudimos procesar tu solicitud. Inténtalo de nuevo en unos minutos.',
    });
  });

  return app;
}

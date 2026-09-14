/* =========================================================
   Punto de entrada de Vercel.

   Vercel acepta una app de Express como handler: recibe (req, res) igual que
   un servidor Node normal. No se llama a listen() — la plataforma se encarga
   del ciclo de vida.

   La app se construye una sola vez por instancia: mientras la función siga
   caliente, las invocaciones reutilizan este módulo y no rehacen el trabajo.
   ========================================================= */
import 'dotenv/config';
import { createApp } from '../src/app.js';

const app = createApp();

export default app;

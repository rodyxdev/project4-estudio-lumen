# Estudio Lumen

Landing page con backend funcional para un estudio de diseño de interiores ficticio. Pieza de portafolio.

**Demo en vivo:** `[pendiente de despliegue]`

---

## Stack

| Capa | Tecnología |
|---|---|
| Servidor | Node.js + Express 5 |
| Base de datos | Supabase (PostgreSQL) |
| Correo | Nodemailer (Mailtrap sandbox en desarrollo) |
| Hosting | Vercel (función serverless + estáticos) |
| Frontend | HTML, CSS y JavaScript sin frameworks |

Sin framework de frontend y sin framework de CSS: la landing es una sola página estática, y meter
una capa de build para eso habría añadido peso y mantenimiento sin resolver ningún problema real.

## Qué hace

- **Tres formularios funcionales** — cotización, newsletter y contacto general. Envían por `fetch`
  a una API JSON y persisten en Postgres.
- **Validación server-side** — manual, sin librerías: formato de email, campos obligatorios que no
  admiten solo espacios, límites de longitud, y whitelist cerrada para los dos desplegables de
  cotización. El navegador valida primero como cortesía de UX; el servidor no se fía de eso.
- **Rate limiting de dos capas** — un antiflood generoso por IP delante de todo, y un límite de
  negocio estrecho que solo cuenta envíos que ya pasaron la validación.
- **Honeypot anti-bot** — campo señuelo oculto por CSS en los tres formularios. Si llega relleno, la
  respuesta es idéntica a la de un envío correcto pero no se guarda ni se notifica nada.
- **Los fallos de correo no pierden datos** — el `INSERT` es la fuente de verdad. Si el SMTP falla
  (credenciales, timeout, rate limit del proveedor), el registro ya está guardado, el error queda en
  el log con su código, y el usuario recibe confirmación igual.
- **Alta de newsletter idempotente** — reenviar el mismo correo no duplica ni revela si ya estaba
  registrado; si estaba dado de baja, lo reactiva.

## Decisiones de arquitectura

**Supabase Postgres en lugar de una base local.** El proyecto corre en Vercel como función
serverless: no hay disco propio ni proceso de larga vida, así que un archivo SQLite se perdería en
cada invocación. Supabase aporta un Postgres gestionado con API REST, lo que encaja con el modelo
sin estado sin necesidad de administrar un servidor de base de datos.

**Dos capas de rate limiting en vez de una.** Un único límite obliga a elegir entre ser laxo con los
bots o castigar a un usuario legítimo que se equivoca tres veces rellenando el formulario. Separarlas
resuelve el conflicto: la capa 1 (20 peticiones/minuto por IP) corre como middleware y cuenta todo,
válido o no, para frenar el ruido automatizado; la capa 2 (3 envíos/hora por IP y endpoint) se
consume dentro del handler, después de validar y antes de insertar, así que **un error de validación
devuelve 400 y no gasta cuota**. Equivocarse rellenando un formulario no cuesta nada; abusar, sí.

**Los contadores viven en Postgres, no en memoria.** En serverless cada petición puede caer en una
instancia distinta, así que un contador en memoria no contaría nada útil. Ambas capas llaman a una
función `increment_rate_limit` que incrementa de forma atómica en la tabla `rate_limit_hits`. Si esa
llamada falla, las dos capas **dejan pasar la petición** (*fail-open*) y lo registran: preferimos
aceptar spam durante una caída de infraestructura antes que tirar el formulario para todos.

## Limitaciones conocidas

- **Los proyectos gratuitos de Supabase se pausan tras 7 días de inactividad** y hay que reactivarlos
  a mano desde el dashboard. Si eso pasa, la landing carga con normalidad (es estática) pero los
  formularios fallan al intentar guardar.
- **Existe un keep-alive automático** para evitarlo: el workflow
  [`.github/workflows/keep-supabase-alive.yml`](.github/workflows/keep-supabase-alive.yml) hace una
  lectura trivial contra la API REST de Supabase **cada 3 días**, y también puede lanzarse a mano
  desde la pestaña *Actions*. Si aun así el proyecto llegara a pausarse, lo primero que hay que
  mirar es esa pestaña: el step falla con el código HTTP recibido, así que un ping roto aparece como
  un run en rojo en lugar de fallar en silencio.

## Setup local

```bash
git clone <url-del-repositorio>
cd project4-estudio-lumen
cp .env.example .env    # y rellena los valores
npm install
npm start
```

La app queda en `http://localhost:3000`. Health check en `/health`.

Para desarrollo con recarga automática: `npm run dev`. En local se usa `server.js`, que levanta el
mismo Express que la función de Vercel y apunta al mismo Supabase.

El esquema (`inquiries`, `subscribers`, `rate_limit_hits` y la función `increment_rate_limit`) vive
en Supabase y se crea desde su SQL Editor; el proyecto no ejecuta migraciones al arrancar.

Para el correo en desarrollo, [Mailtrap](https://mailtrap.io) sandbox: captura todo lo que se envía
sin entregarlo a nadie. Si no configuras SMTP, la app arranca igual y avisa por consola de que las
notificaciones quedan desactivadas — los formularios se siguen guardando.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor en desarrollo local. No aplica en Vercel. |
| `TRUST_PROXY` | `1` únicamente detrás de un proxy inverso (Vercel). Ausente o vacío en local. Sin esto en producción, el rate limiting ve la IP del edge en todas las peticiones y trata a todos los visitantes como uno solo. Activarlo sin un proxy real delante permite falsificar la IP con una cabecera. |
| `SUPABASE_URL` | URL del proyecto Supabase (`https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role`, **no** la `anon`. Salta RLS y da acceso total: es server-only, nunca debe llegar al cliente, aparecer en un log ni commitearse. |
| `SMTP_HOST` | Host del servidor SMTP. |
| `SMTP_PORT` | Puerto SMTP (2525 o 587 en Mailtrap sandbox). |
| `SMTP_USER` | Usuario SMTP. |
| `SMTP_PASS` | Contraseña SMTP. |
| `MAIL_FROM` | Remitente de las notificaciones internas. |
| `ADMIN_NOTIFY_EMAIL` | Dirección que recibe el aviso de cada consulta. |

Ninguna de estas debe acabar en el repositorio: `.env` está en `.gitignore`, y solo se versiona
`.env.example` con valores de ejemplo.

## Despliegue

Vercel detecta el proyecto sin configuración extra. `vercel.json` reescribe `/api/*` y `/health`
hacia la función de `api/index.js`, y deja que el contenido de `public/` se sirva como estático sin
pasar por la función.

Hay que declarar en las *Environment Variables* del proyecto de Vercel todas las variables de la
tabla de arriba excepto `PORT`, y **`TRUST_PROXY` debe valer `1`**.

El keep-alive de Supabase necesita además dos secrets en el repositorio de GitHub
(*Settings → Secrets and variables → Actions*): `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, con los
mismos valores del `.env` local.

## Estructura

```
├── server.js              # arranque local
├── vercel.json            # rewrites y estáticos
├── api/
│   └── index.js           # punto de entrada serverless (exporta la app de Express)
├── src/
│   ├── app.js             # configuración de Express (separada para poder testear)
│   ├── supabase.js        # cliente server-only y RPC de rate limiting
│   ├── subscribers.js     # alta idempotente del boletín
│   ├── validation.js      # validación manual y whitelists
│   ├── mailer.js          # Nodemailer
│   ├── inquiryService.js  # guardar primero, notificar después
│   ├── rateLimit.js       # capa 1 — antiflood
│   ├── businessLimit.js   # capa 2 — límite de negocio
│   ├── honeypot.js        # campo señuelo
│   └── routes/            # contacto, cotizacion, newsletter
├── public/                # landing estática
└── .github/workflows/     # keep-alive de Supabase
```

## Screenshots

<!-- agregar capturas tras el despliegue -->

## Nota

Estudio Lumen no existe. El nombre, los proyectos, los testimonios y los datos de contacto son
inventados para esta pieza de portafolio.

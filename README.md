# Estudio Lumen

Landing page con backend funcional para un estudio de diseño de interiores ficticio. Pieza de portafolio.

**Demo en vivo:** `[pendiente de despliegue]`

---

## Stack

| Capa | Tecnología |
|---|---|
| Servidor | Node.js + Express 5 |
| Base de datos | SQLite (`better-sqlite3`) |
| Correo | Nodemailer (Mailtrap sandbox en desarrollo) |
| Frontend | HTML, CSS y JavaScript sin frameworks |

Sin framework de frontend y sin framework de CSS: la landing es una sola página estática, y meter
una capa de build para eso habría añadido peso y mantenimiento sin resolver ningún problema real.

## Qué hace

- **Tres formularios funcionales** — cotización, newsletter y contacto general. Envían por `fetch`
  a una API JSON y persisten en SQLite.
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

**SQLite en lugar de PostgreSQL.** El volumen esperado son unas pocas consultas al día desde un
formulario de contacto, y todas las escrituras vienen de un único proceso. Postgres habría añadido
un servicio que administrar, credenciales que rotar y un coste mensual, a cambio de concurrencia que
este alcance no necesita. `better-sqlite3` es síncrono, lo que además elimina toda una clase de
errores de concurrencia en el código de rutas.

**Dos capas de rate limiting en vez de una.** Un único límite obliga a elegir entre ser laxo con los
bots o castigar a un usuario legítimo que se equivoca tres veces rellenando el formulario. Separarlas
resuelve el conflicto: la capa 1 (20 peticiones/minuto por IP) corre como middleware y cuenta todo,
válido o no, para frenar el ruido automatizado; la capa 2 (3 envíos/hora por IP y endpoint) se
consume dentro del handler, después de validar y antes de insertar, así que **un error de validación
devuelve 400 y no gasta cuota**. Equivocarse rellenando un formulario no cuesta nada; abusar, sí.

**Almacenamiento efímero en el plan gratuito de Render.** El disco del plan free no persiste entre
despliegues ni reinicios: cada vez que el servicio se reconstruye, el archivo SQLite se pierde y se
recrea vacío en el primer arranque. Para una pieza de portafolio es aceptable — la notificación por
correo llega igual y es lo que de verdad importa del formulario — pero **no es apto para producción
real** tal cual. Un cliente real necesitaría un disco persistente de pago o migrar a Postgres, y esa
migración toca únicamente `src/db.js`.

## Setup local

```bash
git clone <url-del-repositorio>
cd project4-estudio-lumen
cp .env.example .env    # y rellena los valores
npm install
npm start
```

La app queda en `http://localhost:3000`. Health check en `/health`.

Para desarrollo con recarga automática: `npm run dev`.

La base de datos se crea sola en el primer arranque, en la ruta que indique `DB_PATH`. No hay que
ejecutar migraciones.

Para el correo en desarrollo, [Mailtrap](https://mailtrap.io) sandbox: captura todo lo que se envía
sin entregarlo a nadie. Si no configuras SMTP, la app arranca igual y avisa por consola de que las
notificaciones quedan desactivadas — los formularios se siguen guardando.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor. En local, 3000. En Render no hace falta definirlo: la plataforma inyecta el suyo y la app lo respeta. |
| `TRUST_PROXY` | `1` únicamente detrás de un proxy inverso (Render). Ausente o vacío en local. Sin esto en producción, el rate limiting ve la IP del proxy en todas las peticiones y trata a todos los visitantes como uno solo. Activarlo sin un proxy real delante permite falsificar la IP con una cabecera. |
| `SMTP_HOST` | Host del servidor SMTP. |
| `SMTP_PORT` | Puerto SMTP (2525 o 587 en Mailtrap sandbox). |
| `SMTP_USER` | Usuario SMTP. |
| `SMTP_PASS` | Contraseña SMTP. |
| `MAIL_FROM` | Remitente de las notificaciones internas. |
| `ADMIN_NOTIFY_EMAIL` | Dirección que recibe el aviso de cada consulta. |
| `DB_PATH` | Ruta del archivo SQLite, relativa a la raíz del proyecto. El directorio se crea solo. |

Ninguna de estas debe acabar en el repositorio: `.env` está en `.gitignore`, y solo se versiona
`.env.example` con valores de ejemplo.

## Despliegue

El repositorio incluye `render.yaml` como blueprint de [Render](https://render.com). Todas las
variables sensibles van marcadas con `sync: false`, de modo que Render las pide en el dashboard en
lugar de leerlas del archivo versionado.

Recuerda poner `TRUST_PROXY=1` entre las variables del servicio.

## Estructura

```
├── server.js              # arranque, apagado limpio
├── render.yaml            # blueprint de despliegue
├── src/
│   ├── app.js             # configuración de Express (separada para poder testear)
│   ├── db.js              # SQLite: esquema y consultas
│   ├── validation.js      # validación manual y whitelists
│   ├── mailer.js          # Nodemailer
│   ├── inquiryService.js  # guardar primero, notificar después
│   ├── rateLimit.js       # capa 1 — antiflood
│   ├── businessLimit.js   # capa 2 — límite de negocio
│   ├── honeypot.js        # campo señuelo
│   └── routes/            # contacto, cotizacion, newsletter
└── public/                # landing estática
```

## Screenshots

<!-- agregar capturas tras el despliegue -->

## Nota

Estudio Lumen no existe. El nombre, los proyectos, los testimonios y los datos de contacto son
inventados para esta pieza de portafolio.

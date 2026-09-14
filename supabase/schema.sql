-- =============================================================================
-- Estudio Lumen — esquema completo para Supabase
--
-- Ejecutar entero en el SQL Editor del proyecto. Es idempotente: se puede
-- volver a correr sin romper nada.
--
-- Este archivo está escrito para encajar EXACTAMENTE con lo que espera el
-- código de src/. Si se cambia un nombre de columna o de parámetro aquí, hay
-- que cambiarlo también allí.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. inquiries — cotizaciones y contactos generales
--    Escrita por src/inquiryService.js: insert de
--    (type, name, email, phone, project_type, budget_range, message)
--    y lectura de la fila creada (necesita `id` para el log y el correo).
--    En 'contacto', phone / project_type / budget_range llegan como NULL.
-- -----------------------------------------------------------------------------
create table if not exists public.inquiries (
  id            bigint generated always as identity primary key,
  type          text        not null check (type in ('contacto', 'cotizacion')),
  name          text        not null,
  email         text        not null,
  phone         text,
  project_type  text,
  budget_range  text,
  message       text        not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_inquiries_created_at on public.inquiries (created_at desc);
create index if not exists idx_inquiries_type       on public.inquiries (type);


-- -----------------------------------------------------------------------------
-- 2. subscribers — boletín
--    Escrita por src/subscribers.js:
--      select id, unsubscribed_at where email = ...
--      insert (email)
--      update set unsubscribed_at = null, subscribed_at = <ISO>
--    El UNIQUE de email es lo que resuelve la carrera entre dos altas
--    simultáneas: la perdedora recibe 23505 y el código relee la fila.
--    El email llega SIEMPRE en minúsculas desde la validación en JS.
-- -----------------------------------------------------------------------------
create table if not exists public.subscribers (
  id               bigint generated always as identity primary key,
  email            text        not null unique,
  subscribed_at    timestamptz not null default now(),
  unsubscribed_at  timestamptz
);


-- -----------------------------------------------------------------------------
-- 3. rate_limit_hits — contadores de las dos capas de rate limiting
--
--    NO hay columna de IP: la IP viaja concatenada dentro de `bucket`, que es
--    como lo construye el código:
--      capa 1 (antiflood) → 'antiflood:<ip>'            ventana de 1 minuto
--      capa 2 (negocio)   → 'business:<endpoint>:<ip>'  ventana de 1 hora
--
--    `window_start` llega ya truncado desde JS (UTC, al minuto o a la hora),
--    así que todas las peticiones de una misma ventana comparten fila exacta.
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limit_hits (
  bucket        text        not null,
  window_start  timestamptz not null,
  hits          integer     not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (bucket, window_start)
);

-- Para poder barrer ventanas viejas sin escanear la tabla entera.
create index if not exists idx_rate_limit_hits_window on public.rate_limit_hits (window_start);


-- -----------------------------------------------------------------------------
-- 4. increment_rate_limit — incremento atómico
--
--    Firma exacta que llama src/supabase.js (PostgREST resuelve por NOMBRE):
--      p_bucket        text
--      p_window_start  timestamptz   (se envía como ISO 8601 con Z)
--      p_limit         integer
--
--    Devuelve el CONTEO CRUDO ya incluida esta petición, como integer.
--    La decisión de bloquear NO se toma aquí: el código compara `hits > límite`
--    por su cuenta, para poder distinguir en el log qué capa cortó y devolver
--    mensajes distintos. Por eso `p_limit` se acepta pero no se usa: existe
--    para que la firma coincida y para poder mover el corte aquí en el futuro
--    sin tocar el cliente.
--
--    Consecuencia del contrato: la primera petición de una ventana devuelve 1.
--    Con límite 20, las peticiones 1..20 pasan y la 21 es la primera bloqueada.
--
--    security definer + search_path fijo: la función escribe aunque la tabla
--    tenga RLS activado, y no se puede secuestrar con un search_path hostil.
-- -----------------------------------------------------------------------------
create or replace function public.increment_rate_limit(
  p_bucket        text,
  p_window_start  timestamptz,
  p_limit         integer default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limit_hits as r (bucket, window_start, hits, updated_at)
  values (p_bucket, p_window_start, 1, now())
  on conflict (bucket, window_start)
  do update set hits = r.hits + 1,
                updated_at = now()
  returning r.hits into v_hits;

  return v_hits;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. Seguridad
--
--    RLS activado y SIN políticas: nadie que use la anon key puede leer ni
--    escribir estas tablas. El backend usa la service role key, que salta RLS.
--    Sin esto, cualquiera con la anon key (que es pública por diseño) podría
--    listar todas las consultas y todos los correos de los suscriptores.
-- -----------------------------------------------------------------------------
alter table public.inquiries        enable row level security;
alter table public.subscribers      enable row level security;
alter table public.rate_limit_hits  enable row level security;

-- La RPC solo la puede ejecutar el servidor. Si la pudiera llamar `anon`,
-- cualquiera podría inflar los contadores de otra IP y dejarla sin cuota.
revoke all on function public.increment_rate_limit(text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.increment_rate_limit(text, timestamptz, integer)
  to service_role;


-- -----------------------------------------------------------------------------
-- 6. Limpieza opcional de ventanas viejas
--
--    rate_limit_hits crece una fila por (bucket, ventana) y nada la borra.
--    Con el tráfico de una landing tarda años en molestar, pero conviene
--    dejarlo resuelto. Ejecutar a mano de vez en cuando, o programarlo con
--    pg_cron si el proyecto lo tiene habilitado.
-- -----------------------------------------------------------------------------
create or replace function public.purge_rate_limit_hits(p_older_than interval default interval '2 days')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_borradas integer;
begin
  delete from public.rate_limit_hits
   where window_start < now() - p_older_than;
  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

revoke all on function public.purge_rate_limit_hits(interval) from public, anon, authenticated;
grant execute on function public.purge_rate_limit_hits(interval) to service_role;


-- -----------------------------------------------------------------------------
-- 7. Refrescar la caché de esquema de PostgREST
--    Supabase suele hacerlo solo, pero forzarlo evita un PGRST205/PGRST202
--    justo después de crear todo.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

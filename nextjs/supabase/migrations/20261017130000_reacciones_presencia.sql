-- =============================================================================
-- Migración: resumen público de reacciones + presencia de espectadores
-- Archivo: nextjs/supabase/migrations/20261017130000_reacciones_presencia.sql
-- =============================================================================
-- Objetivo:
--   (1) Permitir mostrar el NÚMERO de reacciones y QUIÉN reaccionó sin debilitar
--       la RLS de `public.reacciones` (cuya política SELECT sólo deja leer las
--       filas propias: `usuario_id = auth.uid()`).
--   (2) Permitir un contador REAL de espectadores (actuales y totales) con
--       deduplicación por sesión y expiración por TTL (sin simular valores).
--
-- Cómo se consigue sin debilitar RLS:
--   Se usan VISTAS con `security_invoker = false` (mismo patrón ya aplicado en
--   20261015130000 para `transmisiones_anfitrion_publico`). La vista se ejecuta
--   con los privilegios de su PROPIETARIO y expone SÓLO datos agregados o la
--   lista de nombres visibles. La tabla base conserva sus políticas intactas.
--
--   Como la vista elude la RLS de las tablas base, el control de exposición se
--   hace en dos capas:
--     a) FILTRO EN LA VISTA: las reacciones sólo se exponen para transmisiones
--        `en_vivo` o para su propio anfitrión (`anfitrion_id = auth.uid()`), de
--        modo que el anfitrión sigue viendo sus reacciones al revisar una
--        transmisión finalizada y el público no ve las de transmisiones ajenas
--        no emitidas.
--     b) GRANT POR COLUMNA: `anon` sólo puede leer (transmision_id, total); la
--        lista de nombres `autores` se reserva a `authenticated` (la interfaz
--        muestra "quién reaccionó" a los usuarios con sesión).
--
-- Garantías:
--   * NO usa service_role.
--   * NO desactiva RLS (sólo la habilita de forma idempotente donde aplica).
--   * NO borra datos ni columnas.
--   * NO modifica ni elimina políticas ajenas.
--
-- Aplicación (manual, NO automática):
--   A) Panel de Supabase -> SQL Editor -> pegar y ejecutar.
--   B) Supabase CLI:  supabase db push  (proyecto enlazado).
-- =============================================================================


-- =============================================================================
-- 1) Resumen público de reacciones (contador + autores)
-- =============================================================================
-- Expone, por transmisión: `total` (número de reacciones) y `autores` (lista de
-- nombres visibles de public.usuarios). SÓLO el nombre visible; nunca correo ni
-- `usuario_id`.
--
-- Filtro de exposición: la transmisión debe estar `en_vivo` O pertenecer al
-- usuario que consulta (`anfitrion_id = auth.uid()`). Para una petición sin
-- sesión, `auth.uid()` es NULL y sólo quedan las transmisiones `en_vivo`.
-- El JOIN es INNER a propósito: si la transmisión no existe, no se expone nada.
create or replace view public.transmisiones_reacciones_publico
with (security_invoker = false) as
select
  r.transmision_id,
  count(*)::int as total,
  coalesce(
    json_agg(u.nombre order by r.fecha) filter (where u.nombre is not null),
    '[]'::json
  ) as autores
from public.reacciones r
join public.transmisiones t on t.id = r.transmision_id
left join public.usuarios u on u.id = r.usuario_id
where t.estado = 'en_vivo' or t.anfitrion_id = auth.uid()
group by r.transmision_id;

-- Los nombres de quienes reaccionan NO se exponen a usuarios anónimos.
-- El REVOKE previo garantiza que no quede un GRANT de tabla (que cubriría
-- `autores`) de una ejecución anterior de esta misma migración.
revoke select on public.transmisiones_reacciones_publico from anon;
grant select (transmision_id, total)
  on public.transmisiones_reacciones_publico to anon;

revoke select on public.transmisiones_reacciones_publico from authenticated;
grant select (transmision_id, total, autores)
  on public.transmisiones_reacciones_publico to authenticated;


-- =============================================================================
-- 2) Presencia de espectadores (tabla real, sin simulaciones)
-- =============================================================================
-- Una fila por (transmision_id, usuario_id):
--   * `primera_vez`  -> primera entrada (sirve para "espectadores totales").
--   * `ultima_vez`   -> último latido recibido.
--   * `activo`       -> marcado en falso al salir explícitamente.
-- "Espectadores actuales" = filas con `activo` y latido dentro del TTL (45 s).
-- "Espectadores totales"  = todas las filas (entradas únicas).
-- La clave primaria compuesta evita el doble conteo de una misma sesión.
create table if not exists public.presencia_transmision (
  transmision_id uuid        not null references public.transmisiones(id) on delete cascade,
  usuario_id     uuid        not null,
  primera_vez    timestamptz not null default now(),
  ultima_vez     timestamptz not null default now(),
  activo         boolean     not null default true,
  primary key (transmision_id, usuario_id)
);

alter table public.presencia_transmision enable row level security;

-- Privilegios mínimos: cada usuario gestiona SÓLO su propia fila.
grant select (transmision_id, usuario_id, ultima_vez, activo)
  on public.presencia_transmision to authenticated;
grant insert (transmision_id, usuario_id, ultima_vez, activo)
  on public.presencia_transmision to authenticated;
grant update (ultima_vez, activo)
  on public.presencia_transmision to authenticated;

drop policy if exists presencia_lectura_propia on public.presencia_transmision;
create policy presencia_lectura_propia
  on public.presencia_transmision
  for select
  to authenticated
  using (usuario_id = auth.uid());

drop policy if exists presencia_entrada_propia on public.presencia_transmision;
create policy presencia_entrada_propia
  on public.presencia_transmision
  for insert
  to authenticated
  with check (usuario_id = auth.uid());

drop policy if exists presencia_salida_propia on public.presencia_transmision;
create policy presencia_salida_propia
  on public.presencia_transmision
  for update
  to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());


-- =============================================================================
-- 3) Vista pública de conteo de espectadores
-- =============================================================================
-- Agregado por transmisión: `actuales` (latido dentro del TTL) y `totales`.
-- Sólo números: no expone qué usuario está viendo.
create or replace view public.transmisiones_espectadores_publico
with (security_invoker = false) as
select
  transmision_id,
  count(*) filter (
    where activo and ultima_vez > now() - interval '45 seconds'
  )::int as actuales,
  count(*)::int as totales
from public.presencia_transmision
group by transmision_id;

grant select on public.transmisiones_espectadores_publico to anon, authenticated;


-- =============================================================================
-- 4) CONSULTAS DE VERIFICACIÓN (sólo lectura)
-- =============================================================================
-- 4.1) Las vistas existen y son consultables:
--   select * from public.transmisiones_reacciones_publico limit 5;
--   select * from public.transmisiones_espectadores_publico limit 5;
-- 4.2) RLS de la tabla de presencia:
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname='public' and tablename='presencia_transmision'
--   order by cmd, policyname;
-- 4.3) Privilegios por columna:
--   select column_name, privilege_type
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='presencia_transmision'
--   order by privilege_type, column_name;
-- 4.4) Que `anon` NO pueda leer `autores` en la vista de reacciones:
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='transmisiones_reacciones_publico'
--   order by grantee, privilege_type, column_name;
-- =============================================================================

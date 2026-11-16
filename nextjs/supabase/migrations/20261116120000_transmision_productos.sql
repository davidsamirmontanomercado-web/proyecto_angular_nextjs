-- =============================================================================
-- Migración: productos promocionados en una transmisión
-- Archivo: nextjs/supabase/migrations/20261116120000_transmision_productos.sql
-- =============================================================================
-- Objetivo:
--   Permitir que el ANFITRIÓN seleccione qué productos de su catálogo promociona
--   durante el live, y que los ESPECTADORES vean esos productos (imagen, nombre,
--   precio, categoría) mientras la transmisión está en vivo.
--
-- Modelo:
--   * `public.transmision_productos` es la tabla de relación N:N entre
--     transmisiones (uuid) y productos (uuid).
--   * NO duplica columnas: el detalle del producto vive sólo en `productos`.
--   * `orden` permite fijar un orden de presentación estable en la interfaz.
--
-- Garantías de esta migración:
--   * NO usa service_role.
--   * NO borra datos ni columnas.
--   * NO duplica la tabla `productos`.
--   * Habilita RLS y crea SÓLO políticas con nombres propios
--     (`drop policy if exists` limitado a esos nombres).
--   * La lectura pública se hace por una VISTA con `security_invoker = false`
--     (mismo patrón ya usado en 20261015130000 y 20261017130000): así `anon`
--     no necesita permiso sobre las tablas base y la exposición se controla con
--     el filtro de la propia vista.
--
-- Tipos (verificados en el proyecto):
--   * `transmisiones.id` es uuid.
--   * `productos.id` es uuid: la API valida el id de producto con UUID_RE en
--     /api/productos/[id] y el frontend tipa `Producto.id` como string.
--
-- Aplicación (manual, NO automática):
--   A) Panel de Supabase -> SQL Editor -> pegar y ejecutar.
--   B) Supabase CLI:  supabase db push  (proyecto enlazado).
-- =============================================================================


-- =============================================================================
-- 1) Tabla de relación transmisión <-> producto
-- =============================================================================
create table if not exists public.transmision_productos (
  transmision_id uuid   not null references public.transmisiones(id) on delete cascade,
  producto_id    uuid   not null references public.productos(id)     on delete cascade,
  orden          integer not null default 0,
  created_at     timestamptz not null default now(),
  primary key (transmision_id, producto_id)
);

-- Índice para resolver "productos de una transmisión" en orden de presentación.
create index if not exists transmision_productos_transmision_orden_idx
  on public.transmision_productos (transmision_id, orden);


-- =============================================================================
-- 2) RLS: el propietario administra; lectura limitada por estado/propiedad
-- =============================================================================
alter table public.transmision_productos enable row level security;

-- 2.1) SELECT: se permite leer la fila si la transmisión está `en_vivo` (para que
--      los espectadores vean la promoción) o si quien consulta es el anfitrión.
--      Para una petición sin sesión `auth.uid()` es NULL y sólo quedarían las
--      transmisiones en vivo. La API pública, de todos modos, lee la VISTA del
--      bloque 3 (que vuelve a aplicar este mismo filtro).
drop policy if exists transmision_productos_lectura on public.transmision_productos;
create policy transmision_productos_lectura
  on public.transmision_productos
  for select
  using (
    exists (
      select 1
      from public.transmisiones t
      where t.id = transmision_id
        and (t.estado = 'en_vivo' or t.anfitrion_id = auth.uid())
    )
  );

-- 2.2) INSERT: sólo el anfitrión de esa transmisión puede asociar productos.
drop policy if exists transmision_productos_insertar_propietario on public.transmision_productos;
create policy transmision_productos_insertar_propietario
  on public.transmision_productos
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.transmisiones t
      where t.id = transmision_id
        and t.anfitrion_id = auth.uid()
    )
  );

-- 2.3) DELETE: sólo el anfitrión puede quitar productos de SU transmisión.
drop policy if exists transmision_productos_borrar_propietario on public.transmision_productos;
create policy transmision_productos_borrar_propietario
  on public.transmision_productos
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.transmisiones t
      where t.id = transmision_id
        and t.anfitrion_id = auth.uid()
    )
  );


-- =============================================================================
-- 3) Permisos por columna para `authenticated` (nunca `anon`).
-- =============================================================================
-- La API escribe exactamente estas columnas; nada de GRANT ALL sobre la tabla.
grant select (transmision_id, producto_id, orden, created_at)
  on public.transmision_productos to authenticated;
grant insert (transmision_id, producto_id, orden)
  on public.transmision_productos to authenticated;
grant delete on public.transmision_productos to authenticated;

-- `anon` no toca la tabla base: lee la vista pública del bloque 4.
revoke all on public.transmision_productos from anon;


-- =============================================================================
-- 4) Vista pública de productos promocionados.
-- =============================================================================
-- Expone, por transmisión, el detalle del producto promocionado SIN ids
-- internos de más: se conserva `producto_id` porque la interfaz lo usa como
-- clave de lista (no es un dato sensible) y NO se expone `vendedor_id`.
--
-- La vista se ejecuta con privilegios de su PROPIETARIO
-- (`security_invoker = false`), así que el control de exposición es el WHERE:
-- sólo transmisiones `en_vivo` o propias del usuario que consulta.
create or replace view public.transmision_productos_publico
with (security_invoker = false) as
select
  tp.transmision_id,
  tp.producto_id,
  tp.orden,
  p.nombre,
  p.descripcion,
  p.precio,
  p.imagen,
  p.categoria,
  p.tag
from public.transmision_productos tp
join public.productos p on p.id = tp.producto_id
join public.transmisiones t on t.id = tp.transmision_id
where t.estado = 'en_vivo' or t.anfitrion_id = auth.uid();

-- El REVOKE previo evita que quede un GRANT de tabla de una ejecución anterior.
revoke select on public.transmision_productos_publico from anon;
revoke select on public.transmision_productos_publico from authenticated;
grant select on public.transmision_productos_publico to anon, authenticated;


-- =============================================================================
-- 5) CONSULTAS DE VERIFICACIÓN (sólo lectura)
-- =============================================================================
-- 5.1) ¿Existe la tabla y sus políticas?
--   select policyname, permissive, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'transmision_productos'
--   order by cmd, policyname;
--
-- 5.2) ¿La FK a productos es del tipo correcto?
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.transmision_productos'::regclass;
-- =============================================================================

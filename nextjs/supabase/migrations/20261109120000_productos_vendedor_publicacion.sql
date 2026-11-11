-- CRUD de productos propiedad del perfil empresarial del vendedor.
alter table public.productos enable row level security;

revoke all on table public.productos from anon;
grant select, insert, update, delete on table public.productos to authenticated;

drop policy if exists productos_vendedor_select on public.productos;
create policy productos_vendedor_select
on public.productos
for select
to authenticated
using (
  exists (
    select 1
    from public.perfiles_empresariales pe
    where pe.id = productos.empresa_id
      and pe.usuario_id = (select auth.uid())
  )
);

drop policy if exists productos_publicados_select on public.productos;
create policy productos_publicados_select
on public.productos
for select
to authenticated
using (estado_publicacion = 'activo');

drop policy if exists productos_vendedor_insert on public.productos;
create policy productos_vendedor_insert
on public.productos
for insert
to authenticated
with check (
  exists (
    select 1
    from public.perfiles_empresariales pe
    where pe.id = productos.empresa_id
      and pe.usuario_id = (select auth.uid())
  )
);

drop policy if exists productos_vendedor_update on public.productos;
create policy productos_vendedor_update
on public.productos
for update
to authenticated
using (
  exists (
    select 1
    from public.perfiles_empresariales pe
    where pe.id = productos.empresa_id
      and pe.usuario_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.perfiles_empresariales pe
    where pe.id = productos.empresa_id
      and pe.usuario_id = (select auth.uid())
  )
);

drop policy if exists productos_vendedor_delete on public.productos;
create policy productos_vendedor_delete
on public.productos
for delete
to authenticated
using (
  exists (
    select 1
    from public.perfiles_empresariales pe
    where pe.id = productos.empresa_id
      and pe.usuario_id = (select auth.uid())
  )
);

-- Proyección pública limitada: no expone correo, teléfono ni otros datos
-- privados del perfil empresarial. Los cambios siguen escribiéndose en productos.
create or replace view public.productos_tienda
with (security_barrier = true)
as
select
  p.id,
  p.nombre,
  p.descripcion,
  p.categoria_id,
  c.nombre as categoria,
  p.subcategoria,
  p.precio,
  p.moneda,
  p.imagenes,
  case
    when jsonb_typeof(p.imagenes) = 'array' then p.imagenes ->> 0
    else null
  end as imagen,
  p.condicion,
  p.stock,
  p.garantia,
  p.entrega,
  p.etiquetas,
  p.estado_publicacion,
  p.fecha_publicacion,
  p.fecha_actualizacion,
  pe.usuario_id as vendedor_id,
  pe.nombre_empresa as vendedor_nombre
from public.productos p
join public.perfiles_empresariales pe on pe.id = p.empresa_id
join public.categorias c on c.id = p.categoria_id
where p.estado_publicacion = 'activo'
  and c.activa = true;

grant select on public.productos_tienda to anon, authenticated;

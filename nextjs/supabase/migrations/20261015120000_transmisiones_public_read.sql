-- =============================================================================
-- Migración: lectura pública MÍNIMA de transmisiones EN VIVO para /envivos
-- =============================================================================
-- Objetivo: permitir que /api/transmisiones liste SÓLO las transmisiones cuya
-- columna `estado` sea `en_vivo`, sin exponer columnas privadas y sin habilitar
-- lectura indiscriminada.
--
-- Regla de negocio CONFIRMADA:
--   /envivos sólo muestra transmisiones en vivo.
--   `estado` verificado en Supabase: 'programada' | 'en_vivo' | 'finalizada'.
--
-- Estado real confirmado en Supabase (2026-10-15):
--   * public.transmisiones tiene 0 registros (no hay datos que alterar).
--   * YA EXISTE la política `transmisiones_lectura_publica` (SELECT, roles
--     anon y authenticated) con `qual = true`. Como PostgreSQL COMBINA con OR
--     las políticas permisivas, agregar una segunda política NO restringiría
--     nada: hay que MODIFICAR la existente. Por eso esta migración NO crea una
--     política nueva; hace `alter policy` sobre `transmisiones_lectura_publica`.
--
-- Contexto verificado (PostgREST, 2026-10-15):
--   * Columnas reales de public.transmisiones:
--       id, titulo, descripcion, estado, subcategoria, imagen_portada,
--       destacada, espectadores_actuales, espectadores_totales,
--       fecha_inicio, fecha_fin, fecha_creacion, fecha_actualizacion,
--       duracion_minutos, url_stream, ubicacion, categoria_id, empresa_id
--   * El SELECT del endpoint usa exactamente:
--       id, titulo, descripcion, estado, subcategoria, imagen_portada,
--       destacada, espectadores_actuales, espectadores_totales, fecha_inicio,
--       categoria_id, categoria:categorias(id,nombre,slug,icono)
--     Ordena por `destacada` y `fecha_inicio`; filtra por `estado` (=en_vivo),
--     `categoria_id`, `subcategoria`, `titulo`, `destacada`.
--   * `categorias` ya es legible por anon; `perfiles_empresariales` NO (y NO
--     se usa en el endpoint, para no exponer datos de empresa).
--
-- Esta migración es NO destructiva: no borra datos, no altera columnas ni
-- modifica registros, y NO elimina ni recrea políticas (sólo cambia el USING
-- de `transmisiones_lectura_publica`). Las políticas de INSERT/UPDATE/DELETE
-- (y cualquier otra) quedan intactas.
--
-- Aplicación (manual, NO automática):
--   A) Panel de Supabase -> SQL Editor -> pegar y ejecutar.
--   B) Supabase CLI:  supabase db push  (proyecto enlazado).
-- =============================================================================

-- 0) ANTES DE APLICAR: verificar el tipo de la política existente (command,
--    roles y using actuales). No se modifica ninguna otra política.
--   select policyname, permissive, cmd, roles, qual, with_check
--   from pg_policies where schemaname='public' and tablename='transmisiones';
--   select relrowsecurity from pg_class where oid='public.transmisiones'::regclass;

-- 1) Privilegio de lectura por columnas (proyección pública mínima).
--    Necesario: hoy anon NO tiene GRANT sobre la tabla (por eso responde 42501),
--    aunque la política exista. NO hay table-level GRANT, por lo que columnas
--    como url_stream, ubicacion, empresa_id, fecha_fin, duracion_minutos, etc.
--    quedan fuera del alcance de lectura.
grant select (
  id,
  titulo,
  descripcion,
  estado,
  subcategoria,
  imagen_portada,
  destacada,
  espectadores_actuales,
  espectadores_totales,
  fecha_inicio,
  categoria_id
) on public.transmisiones to anon, authenticated;

-- 2) Habilitar RLS (idempotente). Si ya estaba habilitado, no cambia nada.
alter table public.transmisiones enable row level security;

-- 3) Modificar SÓLO la política existente `transmisiones_lectura_publica`
--    para que devuelva únicamente filas en vivo. `alter policy` conserva el
--    command (SELECT) y los roles (anon, authenticated); sólo cambia el USING.
--    Se ejecuta de forma guardada: si la política no existe, avisa y no crea
--    ninguna nueva (para no alterar el esquema sin autorización).
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'transmisiones'
      and policyname = 'transmisiones_lectura_publica'
  ) then
    alter policy "transmisiones_lectura_publica"
      on public.transmisiones
      using (estado = 'en_vivo');
  else
    raise notice 'No existe la política transmisiones_lectura_publica; no se modificó nada. Revisar manualmente antes de continuar.';
  end if;
end
$$;

-- =============================================================================
-- LiveMarket · DIAGNÓSTICO DE INTEGRACIÓN CON SUPABASE  (SÓLO LECTURA)
-- Archivo: nextjs/supabase/diagnostics/20261015_diagnostico_integracion.sql
-- =============================================================================
-- QUÉ ES:
--   Un conjunto de consultas de SOLO LECTURA (information_schema + pg_catalog)
--   para fotografiar el estado REAL de la base de datos antes de decidir qué
--   cambios aplicar. NO modifica nada: no hay INSERT/UPDATE/DELETE/ALTER/GRANT.
--
-- CÓMO USARLO:
--   1. Abre Supabase → SQL Editor → New query.
--   2. Pega TODO este archivo y ejecútalo (Run).
--   3. Copia los resultados de cada bloque (0.x) y compáralos con lo que exige
--      la app (ver la cabecera de 20261015_cambios_condicionales.sql).
--   4. Sólo DESPUÉS decide qué bloques del archivo de cambios condicionales
--      aplicar. No apliques ese archivo completo "por si acaso".
--
-- CONTEXTO YA CONOCIDO:
--   * Se ejecutó manualmente y se verificó:
--       GRANT INSERT (linea_negocio) ON public.transmisiones TO authenticated;
--     => el bloque 0.3 debería mostrar `linea_negocio INSERT = true`.
--   * Las migraciones 20261015130000 y 20261015140000 NO se asumen aplicadas.
--   * No se usa service_role en ningún caso.
-- =============================================================================


-- =============================================================================
-- 0.1) RLS habilitado en las tablas implicadas
-- =============================================================================
select
  n.nspname                                            as esquema,
  c.relname                                            as tabla,
  c.relrowsecurity                                     as rls_habilitado,
  c.relforcerowsecurity                                as rls_forzado_para_el_dueno,
  pg_get_userbyid(c.relowner)                          as propietario_tabla
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'transmisiones', 'reacciones', 'seguimientos',
    'perfiles_empresariales', 'usuarios', 'categorias', 'mensajes_chat'
  )
order by c.relname;


-- =============================================================================
-- 0.2) Políticas RLS existentes (transmisiones, reacciones, seguimientos)
--      `roles` indica a quién aplica; `permissive` = RESTRICTIVE|PERMISSIVE.
--      Recuerda: varias políticas de un mismo comando se combinan con OR.
-- =============================================================================
select
  tablename   as tabla,
  policyname  as politica,
  permissive  as tipo,
  roles       as roles,
  cmd         as comando,
  qual        as using_expr,
  with_check  as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('transmisiones', 'reacciones', 'seguimientos')
order by tablename, cmd, policyname;


-- =============================================================================
-- 0.3) ¿Tiene `authenticated` exactamente los permisos de COLUMNA que usa la API?
--      (true = presente). Si algo sale en false, ver el bloque condicional 1.x.
-- =============================================================================
with requeridos(tabla, columna, privilegio) as (
  values
    -- Listado del propietario (/api/transmisiones/mias) + detalle/edición
    ('transmisiones', 'anfitrion_id',       'SELECT'),
    ('transmisiones', 'fecha_fin',          'SELECT'),
    ('transmisiones', 'duracion_minutos',   'SELECT'),
    ('transmisiones', 'ubicacion',          'SELECT'),
    ('transmisiones', 'fecha_creacion',     'SELECT'),
    ('transmisiones', 'fecha_actualizacion','SELECT'),
    -- Crear transmisión (POST /api/transmisiones)
    ('transmisiones', 'id',                 'INSERT'),
    ('transmisiones', 'anfitrion_id',       'INSERT'),
    ('transmisiones', 'estado',             'INSERT'),
    ('transmisiones', 'titulo',             'INSERT'),
    ('transmisiones', 'descripcion',        'INSERT'),
    ('transmisiones', 'linea_negocio',      'INSERT'),
    ('transmisiones', 'categoria_id',       'INSERT'),
    ('transmisiones', 'subcategoria',       'INSERT'),
    ('transmisiones', 'imagen_portada',     'INSERT'),
    ('transmisiones', 'ubicacion',          'INSERT'),
    ('transmisiones', 'destacada',          'INSERT'),
    -- Editar / iniciar / finalizar (PATCH, /iniciar, /finalizar)
    ('transmisiones', 'titulo',             'UPDATE'),
    ('transmisiones', 'descripcion',        'UPDATE'),
    ('transmisiones', 'subcategoria',       'UPDATE'),
    ('transmisiones', 'imagen_portada',     'UPDATE'),
    ('transmisiones', 'ubicacion',          'UPDATE'),
    ('transmisiones', 'categoria_id',       'UPDATE'),
    ('transmisiones', 'destacada',          'UPDATE'),
    ('transmisiones', 'estado',             'UPDATE'),
    ('transmisiones', 'fecha_inicio',       'UPDATE'),
    ('transmisiones', 'fecha_fin',          'UPDATE'),
    ('transmisiones', 'duracion_minutos',   'UPDATE'),
    -- Reacciones: leer las propias + crear/borrar
    ('reacciones',    'usuario_id',         'SELECT'),
    ('reacciones',    'transmision_id',     'INSERT'),
    ('reacciones',    'usuario_id',         'INSERT'),
    ('reacciones',    'transmision_id',     'DELETE'),
    -- Seguimientos: leer los propios + crear/borrar (endpoint por transmisión)
    ('seguimientos',  'seguidor_id',        'SELECT'),
    ('seguimientos',  'seguido_id',         'SELECT'),
    ('seguimientos',  'seguidor_id',        'INSERT'),
    ('seguimientos',  'seguido_id',         'INSERT'),
    ('seguimientos',  'seguidor_id',        'DELETE'),
    ('seguimientos',  'seguido_id',         'DELETE')
)
select
  r.tabla,
  r.columna,
  r.privilegio,
  has_column_privilege(
    'authenticated',
    format('public.%I', r.tabla),
    r.columna,
    r.privilegio
  ) as presente_authenticated,
  has_column_privilege(
    'anon',
    format('public.%I', r.tabla),
    r.columna,
    r.privilegio
  ) as presente_anon
from requeridos r
order by r.tabla, r.privilegio, r.columna;


-- =============================================================================
-- 0.4) Permisos A NIVEL DE TABLA (detecta GRANT amplios tipo "GRANT ALL").
--      Si aparecen INSERT/UPDATE/DELETE a nivel de tabla, es MÁS de lo necesario
--      (la app sólo necesita privilegios por columna).
-- =============================================================================
select
  grantee       as rol,
  table_name    as tabla,
  privilege_type as privilegio
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('transmisiones', 'reacciones', 'seguimientos')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;


-- =============================================================================
-- 0.5) Permisos por COLUMNA vigentes a nivel de tabla `transmisiones`
--      (para ver de un vistazo todo lo concedido a anon/authenticated).
-- =============================================================================
select
  grantee       as rol,
  column_name   as columna,
  privilege_type as privilegio
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'transmisiones'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type, column_name;


-- =============================================================================
-- 0.6) ¿Existe la vista `transmisiones_anfitrion_publico` y cómo está definida?
-- =============================================================================
select
  c.relkind,
  n.nspname                                        as esquema,
  c.relname                                        as vista,
  pg_get_viewdef(c.oid, true)                      as definicion
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'transmisiones_anfitrion_publico';

-- Si el bloque anterior devuelve 0 filas, la vista NO existe todavía
-- (habría que aplicar el bloque condicional 2.1).


-- =============================================================================
-- 0.7) Propietario y OPCIONES DE SEGURIDAD de la vista (clave: security_invoker)
--      * security_invoker = true  -> la vista respeta la RLS del usuario que
--        consulta (equivale a una vista "normal").
--      * ausente / false          -> la vista ejecuta con privilegios de su
--        PROPIETARIO (lo que buscamos aquí: no exigir acceso a
--        perfiles_empresariales/usuarios al rol anon).
-- =============================================================================
select
  pg_get_userbyid(c.relowner)      as propietario_vista,
  coalesce(c.reloptions, '{}')     as opciones_reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'transmisiones_anfitrion_publico';

-- Desglose legible de las opciones (option_name = 'security_invoker', ...):
select
  opt.option_name,
  opt.option_value
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_options_to_table(c.reloptions) as opt
where n.nspname = 'public'
  and c.relname = 'transmisiones_anfitrion_publico';


-- =============================================================================
-- 0.8) Permisos sobre la VISTA (¿pueden anon/authenticated hacer SELECT?)
-- =============================================================================
select
  grantee       as rol,
  table_name    as vista,
  privilege_type as privilegio
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'transmisiones_anfitrion_publico'
order by grantee, privilege_type;


-- =============================================================================
-- 0.9) Columnas reales de `reacciones` y `seguimientos` (verificar NOT NULL y
--      defaults, para no asumir nombres ni obligatoriedad).
-- =============================================================================
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('reacciones', 'seguimientos')
order by table_name, ordinal_position;


-- =============================================================================
-- 0.10) Claves foráneas, únicas y primarias relevantes para likes y seguimientos
--       (contype: p=PK, u=UNIQUE, f=FK, c=check). Determinante para saber si el
--       INSERT idempotente (que asume 23505 en duplicados) tiene soporte real.
-- =============================================================================
select
  con.conname                     as restriccion,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'u' then 'UNIQUE'
    when 'f' then 'FOREIGN KEY'
    else con.contype::text
  end                             as tipo,
  con.conrelid::regclass          as tabla,
  pg_get_constraintdef(con.oid)   as definicion
from pg_constraint con
join pg_namespace n on n.oid = con.connamespace
where n.nspname = 'public'
  and con.conrelid in (
    'public.reacciones'::regclass,
    'public.seguimientos'::regclass
  )
order by tabla, tipo, restriccion;


-- =============================================================================
-- 0.11) Restricciones de `transmisiones` implicadas en el flujo del propietario
--       (NOT NULL / FK / UNIQUE de anfitrion_id, categoria_id, linea_negocio).
-- =============================================================================
select
  con.conname                     as restriccion,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'u' then 'UNIQUE'
    when 'f' then 'FOREIGN KEY'
    else con.contype::text
  end                             as tipo,
  pg_get_constraintdef(con.oid)   as definicion
from pg_constraint con
join pg_namespace n on n.oid = con.connamespace
where n.nspname = 'public'
  and con.conrelid = 'public.transmisiones'::regclass
order by tipo, restriccion;


-- =============================================================================
-- 0.12) (Opcional) Nulabilidad/defaults de `transmisiones` relevantes
-- =============================================================================
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'transmisiones'
order by ordinal_position;

-- =============================================================================
-- FIN DEL DIAGNÓSTICO
-- =============================================================================

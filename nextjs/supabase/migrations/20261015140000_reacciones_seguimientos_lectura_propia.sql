-- =============================================================================
-- Migración: lectura propia para reacciones y seguimientos
-- =============================================================================
-- Contexto (revisión del flujo de likes y seguimientos, tarea 4):
--   * `reacciones`: INSERT y DELETE ya están cubiertos por políticas propias
--     (`reacciones_insertar_usuario` + borrado propio). La API comprueba el
--     estado con un SELECT filtrando `usuario_id = auth.uid()`.
--   * `seguimientos`: INSERT y DELETE ya están cubiertos por políticas propias
--     (`seguidor_id = auth.uid()`). La API comprueba el estado con un SELECT
--     filtrando `seguidor_id = auth.uid()`.
--
-- RIESGO DETECTADO: si esas tablas sólo tienen políticas de INSERT/DELETE y
-- ninguna de SELECT para filas propias, los GET devolverán vacío SIN error
-- (RLS deniega en silencio), y el botón de "me gusta"/"siguiendo" aparecería
-- siempre apagado. No se pudieron leer pg_policies con la clave publicable, así
-- que esto queda como hipótesis a confirmar con la consulta de verificación.
--
-- Esta migración es ADITIVA y conservadora: sólo añade políticas de SELECT para
-- que cada usuario lea SUS propias filas. No restringe ni elimina políticas
-- existentes. Si ya existía una política equivalente, se combinan con OR y el
-- resultado es idéntico.
--
-- Garantías: sin service_role, sin desactivar RLS, sin borrar datos.
-- Aplicación: MANUAL (sólo si la consulta de verificación muestra que falta).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) reacciones: leer las propias.
-- -----------------------------------------------------------------------------
alter table public.reacciones enable row level security;

-- Ya debería existir; un GRANT es idempotente. Se limita a `authenticated`.
grant select on public.reacciones to authenticated;

drop policy if exists reacciones_lectura_propia on public.reacciones;
create policy reacciones_lectura_propia
  on public.reacciones
  for select
  to authenticated
  using (usuario_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 2) seguimientos: leer los propios (a quién sigo).
-- -----------------------------------------------------------------------------
alter table public.seguimientos enable row level security;

grant select on public.seguimientos to authenticated;

drop policy if exists seguimientos_lectura_propia on public.seguimientos;
create policy seguimientos_lectura_propia
  on public.seguimientos
  for select
  to authenticated
  using (seguidor_id = auth.uid());


-- =============================================================================
-- 3) CONSULTAS DE VERIFICACIÓN (sólo lectura; ejecutar ANTES de aplicar).
-- =============================================================================
-- 3.1) Políticas actuales de reacciones y seguimientos:
--   select tablename, policyname, permissive, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename in ('reacciones', 'seguimientos')
--   order by tablename, cmd, policyname;
--
-- 3.2) Privilegios de tabla/columna para `authenticated`:
--   select table_name, privilege_type
--   from information_schema.role_table_grants
--   where grantee = 'authenticated'
--     and table_schema = 'public'
--     and table_name in ('reacciones', 'seguimientos')
--   order by table_name, privilege_type;
-- =============================================================================

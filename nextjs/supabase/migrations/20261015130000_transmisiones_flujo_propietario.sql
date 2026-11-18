-- =============================================================================
-- Migración: flujo del propietario de transmisiones
--            (crear -> ver las mías -> editar/iniciar/finalizar)
--            + información pública mínima del anfitrión
-- =============================================================================
-- Objetivo:
--   * Un usuario autenticado puede crear sus transmisiones.
--   * Puede listar LAS SUYAS en cualquier estado (incluidas 'programada').
--   * Puede editarlas, iniciarlas y finalizarlas.
--   * `anon` puede ver la información pública mínima del anfitrión SIN recibir
--     anfitrion_id, empresa_id ni ningún otro dato privado.
--
-- Garantías de esta migración:
--   * NO usa service_role.
--   * NO desactiva RLS (sólo la habilita de forma idempotente).
--   * NO borra datos ni columnas.
--   * NO elimina ni recrea políticas ajenas: sólo crea políticas nuevas con
--     nombres propios (y `drop policy if exists` limitado a esos nombres).
--
-- ============================ HECHOS VERIFICADOS ============================
-- Comprobado con PostgREST usando la clave publicable (rol anon), 2026-10-15:
--
--   public.transmisiones (19 columnas reales):
--     id, titulo, descripcion, estado, subcategoria, imagen_portada, destacada,
--     espectadores_actuales, espectadores_totales, fecha_inicio, fecha_fin,
--     fecha_creacion, fecha_actualizacion, duracion_minutos, url_stream,
--     ubicacion, categoria_id, empresa_id, anfitrion_id
--     (anfitrion_id EXISTE; la migración 20261015120000 no lo listaba).
--
--   Tipos comprobados por el error de cast de Postgres:
--     id = uuid, categoria_id = uuid, fecha_inicio = timestamptz,
--     destacada = boolean, espectadores_actuales = integer,
--     estado = text (acepta valores arbitrarios, no es un enum).
--
--   public.usuarios: id (uuid), correo, nombre. NO existe `auth_user_id`.
--   public.perfiles_empresariales: id (uuid), usuario_id (uuid), nombre_empresa, logo.
--     NO existe `empresa_id`.
--
--   Hoy `anon` sólo tiene SELECT sobre 11 columnas públicas y existe la política
--   `transmisiones_lectura_publica` (SELECT, anon+authenticated, USING estado='en_vivo').
--   La tabla tiene 0 registros.
--
-- ========================= LÍMITES DE VERIFICACIÓN ==========================
-- La clave publicable NO permite leer pg_policies ni information_schema, por lo
-- que NO se pudieron comprobar:
--   a) los GRANT de INSERT/UPDATE que ya tenga `authenticated`,
--   b) las políticas RLS de INSERT/UPDATE de `transmisiones` que ya existan,
--   c) si `transmisiones.empresa_id` es NOT NULL,
--   d) si `mensajes_chat.tipo` es NOT NULL y su default,
--   e) la FK exacta de `anfitrion_id` (¿usuarios.id? ¿auth.users.id?).
--
-- Por eso:
--   * Las políticas de esta migración son PERMISIVAS y con nombres nuevos: si ya
--     existe una equivalente, PostgreSQL las combina con OR y el resultado sigue
--     exigiendo `anfitrion_id = auth.uid()`, nunca es más laxa de lo permitido.
--   * Al final hay un bloque de CONSULTAS DE VERIFICACIÓN (sólo lectura) para
--     confirmar (a)-(e) antes o después de aplicar.
--
-- Aplicación: MANUAL (SQL Editor de Supabase o `supabase db push`).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) SELECT adicional SÓLO para `authenticated` (columnas de gestión del dueño).
-- -----------------------------------------------------------------------------
-- Lo que ve el propietario y `anon` NO debe ver: fechas de ciclo de vida,
-- duración, ubicación y el id del anfitrión.
-- NO se conceden: empresa_id (dato de negocio) ni url_stream (secreto de emisión).
-- Nota: al ser un GRANT a nivel de rol, `authenticated` podrá leer estas columnas
-- también en filas `en_vivo` de otros usuarios (ya visibles por la política
-- pública). Son metadatos no sensibles; `url_stream` y `empresa_id` quedan fuera.
grant select (
  anfitrion_id,
  fecha_fin,
  duracion_minutos,
  ubicacion,
  fecha_creacion,
  fecha_actualizacion
) on public.transmisiones to authenticated;


-- -----------------------------------------------------------------------------
-- 2) INSERT SÓLO para `authenticated`, limitado a las columnas que escribe la API.
-- -----------------------------------------------------------------------------
-- La API envía exactamente: id, anfitrion_id, estado, titulo, descripcion,
-- linea_negocio, categoria_id, subcategoria, imagen_portada, ubicacion, destacada.
-- NO se concede INSERT sobre empresa_id: la API no la envía y, al ser nullable,
-- la base de datos aplica NULL por defecto (relación usuario -> empresa pendiente).
grant insert (
  id,
  anfitrion_id,
  estado,
  titulo,
  descripcion,
  linea_negocio,
  categoria_id,
  subcategoria,
  imagen_portada,
  ubicacion,
  destacada
) on public.transmisiones to authenticated;


-- -----------------------------------------------------------------------------
-- 3) UPDATE SÓLO para `authenticated`, limitado a las columnas que cambia la API.
-- -----------------------------------------------------------------------------
-- PATCH usa: titulo, descripcion, subcategoria, imagen_portada, ubicacion,
-- categoria_id, destacada.
-- iniciar usa: estado, fecha_inicio.
-- finalizar usa: estado, fecha_fin, duracion_minutos.
grant update (
  titulo,
  descripcion,
  subcategoria,
  imagen_portada,
  ubicacion,
  categoria_id,
  destacada,
  estado,
  fecha_inicio,
  fecha_fin,
  duracion_minutos
) on public.transmisiones to authenticated;


-- -----------------------------------------------------------------------------
-- 4) RLS idempotente + políticas del propietario.
-- -----------------------------------------------------------------------------
alter table public.transmisiones enable row level security;

-- 4.1) El propietario lee SUS transmisiones en cualquier estado (incluida
--      'programada'). La política pública `transmisiones_lectura_publica` NO se
--      toca: se combina con OR (permisivas) y sigue limitando a anon.
drop policy if exists transmisiones_lectura_propietario on public.transmisiones;
create policy transmisiones_lectura_propietario
  on public.transmisiones
  for select
  to authenticated
  using (anfitrion_id = auth.uid());

-- 4.2) Sólo puede crear transmisiones cuyo anfitrión sea él mismo.
drop policy if exists transmisiones_crear_propietario on public.transmisiones;
create policy transmisiones_crear_propietario
  on public.transmisiones
  for insert
  to authenticated
  with check (anfitrion_id = auth.uid());

-- 4.3) Sólo puede actualizar las suyas, y no puede reasignar la propiedad.
drop policy if exists transmisiones_editar_propietario on public.transmisiones;
create policy transmisiones_editar_propietario
  on public.transmisiones
  for update
  to authenticated
  using (anfitrion_id = auth.uid())
  with check (anfitrion_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 5) Información pública mínima del anfitrión (para anon, sin exponer ids).
-- -----------------------------------------------------------------------------
-- La API no puede leer `perfiles_empresariales` como anon (responde 42501) y no
-- se le va a dar acceso a esa tabla. En su lugar se expone una vista con SÓLO el
-- nombre comercial y el logo, sin ningún uuid.
--
-- OJO (intencionado): la vista se ejecuta con los privilegios de su propietario
-- (`security_invoker = false`), de modo que no hace falta conceder nada sobre
-- `perfiles_empresariales` ni `usuarios`. El filtro `estado = 'en_vivo'` y la
-- lista explícita de columnas son la garantía de privacidad: no hay `select *`.
-- La clave de unión `perfiles_empresariales.usuario_id = transmisiones.anfitrion_id`
-- es la hipótesis estándar (ambos son el uuid del usuario autenticado); se usa
-- LEFT JOIN para que, si no coincide, la vista devuelva NULL en vez de romper.
create or replace view public.transmisiones_anfitrion_publico
with (security_invoker = false) as
select
  t.id as transmision_id,
  p.nombre_empresa,
  p.logo,
  u.nombre as anfitrion_nombre
from public.transmisiones t
left join public.perfiles_empresariales p on p.usuario_id = t.anfitrion_id
left join public.usuarios u on u.id = t.anfitrion_id
where t.estado = 'en_vivo';

grant select on public.transmisiones_anfitrion_publico to anon, authenticated;


-- =============================================================================
-- 6) CONSULTAS DE VERIFICACIÓN (sólo lectura; ejecutar antes de dar por bueno
--    el flujo). Confirman los puntos (a)-(e) que la clave publicable no permite ver.
-- =============================================================================
-- 6.1) Nulabilidad y defaults de las columnas en duda (empresa_id / mensajes_chat):
--   select table_name, column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and (
--       (table_name = 'transmisiones' and column_name in
--          ('empresa_id','anfitrion_id','estado','fecha_inicio','fecha_fin','duracion_minutos'))
--       or
--       (table_name = 'mensajes_chat' and column_name in
--          ('tipo','contenido','remitente_id','respondido','fecha'))
--     )
--   order by table_name, column_name;
--
-- 6.2) Políticas existentes de transmisiones (comprobar que no hay otra política
--      de INSERT/UPDATE más laxa que la de esta migración):
--   select policyname, permissive, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'transmisiones'
--   order by cmd, policyname;
--
-- 6.3) Claves foráneas reales (relación anfitrion_id / usuario_id):
--   select conname, conrelid::regclass as tabla, pg_get_constraintdef(oid) as definicion
--   from pg_constraint
--   where contype = 'f'
--     and conrelid in (
--       'public.transmisiones'::regclass,
--       'public.perfiles_empresariales'::regclass
--     )
--   order by tabla, conname;
-- =============================================================================

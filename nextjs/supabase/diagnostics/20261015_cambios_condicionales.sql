-- =============================================================================
-- LiveMarket · CAMBIOS CONDICIONALES MÍNIMOS  (NO EJECUTAR EN BLOQUE)
-- Archivo: nextjs/supabase/diagnostics/20261015_cambios_condicionales.sql
-- =============================================================================
-- IMPORTANTE
--   * Este archivo NO se ejecuta automáticamente. NO está en supabase/migrations/
--     a propósito, para que `supabase db push` no lo aplique.
--   * NO lo lances completo. Aplica SÓLO los bloques cuya condición se cumpla
--     según el resultado del diagnóstico (20261015_diagnostico_integracion.sql).
--   * Ningún bloque borra datos ni elimina políticas ajenas. Las políticas se
--     crean SÓLO si no existen ya (se comprueba en pg_policies). Nunca se hace
--     `drop policy` sobre nada que no hayamos creado nosotros.
--   * No usa service_role, no desactiva RLS.
--
-- MAPA diagnóstico -> cambio
--   0.1 RLS deshabilitado en alguna tabla .............. bloque 0
--   0.3 columnas SELECT/INSERT/UPDATE en false ......... bloque 1
--   0.6 vista inexistente .............................. bloque 2.1
--   0.7 security_invoker ausente/true o def. distinta .. bloque 2.2 (revisar antes)
--   0.8 vista sin SELECT para anon/authenticated ....... bloque 2.3
--   0.2 sin política de SELECT propia (transmisiones) .. bloque 3.1
--   0.2 sin política de INSERT propia (transmisiones) .. bloque 3.2
--   0.2 sin política de UPDATE propia (transmisiones) .. bloque 3.3
--   0.2 reacciones sin SELECT propia ................... bloque 4.1
--   0.2 seguimientos sin SELECT propia ................. bloque 4.2
--   0.2 seguimientos sin INSERT/DELETE propios ......... bloque 5 (REVISAR)
--   0.4 GRANT amplio a nivel de tabla .................. bloque 6 (revisar, manual)
-- =============================================================================


-- =============================================================================
-- BLOQUE 0 · RLS habilitado (idempotente y seguro: sólo habilita, nunca quita)
--   Aplicar si 0.1 muestra rls_habilitado = false para alguna de estas tablas.
-- =============================================================================
alter table public.transmisiones enable row level security;
alter table public.reacciones    enable row level security;
alter table public.seguimientos  enable row level security;


-- =============================================================================
-- BLOQUE 1 · Permisos de COLUMNA para `authenticated`
--   Aplicar SÓLO las líneas cuyo `presente_authenticated` salga false en 0.3.
--   GRANT es idempotente: re-ejecutarlo no rompe nada ni amplía de más, porque
--   la lista es exactamente la que la API necesita (no hay `GRANT ALL`).
-- =============================================================================

-- 1.1 SELECT del ciclo de vida (listado de "mis transmisiones" y detalle).
--     Necesario para /api/transmisiones/mias y para resolver `anfitrion_id`
--     en /api/transmisiones/[id]/seguimiento.
grant select (
  anfitrion_id,
  fecha_fin,
  duracion_minutos,
  ubicacion,
  fecha_creacion,
  fecha_actualizacion
) on public.transmisiones to authenticated;

-- 1.2 INSERT de creación (incluye `linea_negocio`; ya verificado manualmente).
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

-- 1.3 UPDATE de edición / iniciar / finalizar.
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

-- 1.4 reacciones / seguimientos: SELECT de las propias filas.
grant select on public.reacciones   to authenticated;
grant select on public.seguimientos to authenticated;

-- NOTA: la API NO escribe columnas de reacciones/seguimientos distintas de las
-- que ya cubren las políticas existentes. Si 0.3 muestra false en INSERT/DELETE
-- de reacciones o seguimientos, NO concedas columnas a ciegas: revisa primero
-- el bloque 5 y la política de creación/borrado existente (0.2).


-- =============================================================================
-- BLOQUE 2 · Vista pública del anfitrión
-- =============================================================================

-- 2.1 Crear la vista SÓLO si no existe (0.6 sin filas).
--     Ejecuta con privilegios del propietario (security_invoker = false) y
--     expone únicamente 4 columnas, ninguna es un uuid interno.
do $bloque$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'transmisiones_anfitrion_publico'
  ) then
    create view public.transmisiones_anfitrion_publico
    with (security_invoker = false) as
    select
      t.id                       as transmision_id,
      p.nombre_empresa,
      p.logo,
      u.nombre                   as anfitrion_nombre
    from public.transmisiones t
    left join public.perfiles_empresariales p on p.usuario_id = t.anfitrion_id
    left join public.usuarios u on u.id = t.anfitrion_id
    where t.estado = 'en_vivo';

    raise notice 'Vista transmisiones_anfitrion_publico creada.';
  else
    raise notice 'La vista ya existe: revisa el bloque 2.2 antes de tocar nada.';
  end if;
end
$bloque$;

-- 2.2 Si la vista YA existe (0.6 con filas) pero 0.7 muestra `security_invoker`
--     ausente/true, o la definición difiere, NO la reemplaces a ciegas:
--       * Puede haber dependencias (grants, otras vistas) que se pierdan.
--       * Revisa 0.6 (definición) y 0.7 (propietario/opciones).
--     Si el diagnóstico confirma que falta el modo propietario, esto es seguro
--     e idempotente (NO cambia columnas ni la definición):
-- alter view public.transmisiones_anfitrion_publico set (security_invoker = false);
--     Si además hay que cambiar el SELECT, usa un `create or replace view`
--     redactado a mano tras revisar 0.6, no generado automáticamente.

-- 2.3 Permiso de lectura sobre la vista (idempotente).
grant select on public.transmisiones_anfitrion_publico to anon, authenticated;


-- =============================================================================
-- BLOQUE 3 · Políticas del propietario en `transmisiones`
--   Se crean SÓLO si no existe ya una política del mismo comando para
--   `authenticated`. Si ya existe (aunque sea con otro nombre), se OMITE para
--   no duplicar. NO se elimina ninguna política.
--   ------------------------------------------------------------------------
--   ATENCIÓN (ampliación de acceso): una política PERMISSIVE se combina con OR.
--   Si ya existiera una política más laxa (p. ej. using(true)), añadir ésta NO
--   la restringe. Si 0.2 revela una política más amplia de lo deseado, eso se
--   corrige/manual-revisa aparte; este archivo no la toca.
-- =============================================================================

-- 3.1 El propietario lee SUS transmisiones (cualquier estado).
do $bloque$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transmisiones'
      and cmd = 'SELECT' and 'authenticated' = any(roles)
  ) then
    create policy transmisiones_lectura_propietario
      on public.transmisiones
      for select to authenticated
      using (anfitrion_id = auth.uid());
    raise notice 'Política transmisiones_lectura_propietario creada.';
  else
    raise notice 'Ya existe una política SELECT para authenticated en transmisiones: OMITIDO (revisa 0.2).';
  end if;
end
$bloque$;

-- 3.2 Sólo crea transmisiones de las que es anfitrión.
do $bloque$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transmisiones'
      and cmd = 'INSERT' and 'authenticated' = any(roles)
  ) then
    create policy transmisiones_crear_propietario
      on public.transmisiones
      for insert to authenticated
      with check (anfitrion_id = auth.uid());
    raise notice 'Política transmisiones_crear_propietario creada.';
  else
    raise notice 'Ya existe una política INSERT para authenticated en transmisiones: OMITIDO (revisa 0.2).';
  end if;
end
$bloque$;

-- 3.3 Sólo actualiza las suyas y no reasigna la propiedad.
do $bloque$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'transmisiones'
      and cmd = 'UPDATE' and 'authenticated' = any(roles)
  ) then
    create policy transmisiones_editar_propietario
      on public.transmisiones
      for update to authenticated
      using (anfitrion_id = auth.uid())
      with check (anfitrion_id = auth.uid());
    raise notice 'Política transmisiones_editar_propietario creada.';
  else
    raise notice 'Ya existe una política UPDATE para authenticated en transmisiones: OMITIDO (revisa 0.2).';
  end if;
end
$bloque$;


-- =============================================================================
-- BLOQUE 4 · Políticas de lectura propia (reacciones / seguimientos)
--   La API comprueba el estado con SELECT filtrando por el usuario. Si la tabla
--   sólo tiene políticas de INSERT/DELETE, el SELECT devuelve vacío SIN error
--   (RLS deniega en silencio) y el botón aparecería siempre apagado.
-- =============================================================================

-- 4.1 reacciones: leer las propias.
do $bloque$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reacciones'
      and cmd = 'SELECT' and 'authenticated' = any(roles)
  ) then
    create policy reacciones_lectura_propia
      on public.reacciones
      for select to authenticated
      using (usuario_id = auth.uid());
    raise notice 'Política reacciones_lectura_propia creada.';
  else
    raise notice 'Ya existe una política SELECT para authenticated en reacciones: OMITIDO (revisa 0.2).';
  end if;
end
$bloque$;

-- 4.2 seguimientos: leer los propios (a quién sigo).
do $bloque$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'seguimientos'
      and cmd = 'SELECT' and 'authenticated' = any(roles)
  ) then
    create policy seguimientos_lectura_propia
      on public.seguimientos
      for select to authenticated
      using (seguidor_id = auth.uid());
    raise notice 'Política seguimientos_lectura_propia creada.';
  else
    raise notice 'Ya existe una política SELECT para authenticated en seguimientos: OMITIDO (revisa 0.2).';
  end if;
end
$bloque$;


-- =============================================================================
-- BLOQUE 5 · (REVISAR MANUALMENTE — NO ACTIVADO) Escritura de seguimientos
-- -----------------------------------------------------------------------------
--   El endpoint /api/transmisiones/[id]/seguimiento hace INSERT y DELETE en
--   `seguimientos`. Según lo ya conocido, existen políticas propias de creación
--   y borrado (`seguidor_id = auth.uid()`). Este bloque NO debe ejecutarse si
--   0.2 ya muestra políticas INSERT y DELETE para `authenticated`.
--
--   Si 0.2 mostrara que FALTAN, crea la política correspondiente comprobando
--   antes que NO exista una equivalente. Se deja COMENTADO a propósito porque
--   una política nueva PERMISSIVE se combina con OR y podría AMPLIAR el acceso
--   si ya hubiera otra distinta. Adáptalo al nombre/condición reales.
-- -----------------------------------------------------------------------------
-- do $bloque$
-- begin
--   if not exists (
--     select 1 from pg_policies
--     where schemaname='public' and tablename='seguimientos'
--       and cmd='INSERT' and 'authenticated' = any(roles)
--   ) then
--     create policy seguimientos_crear_propio
--       on public.seguimientos for insert to authenticated
--       with check (seguidor_id = auth.uid());
--   end if;
--
--   if not exists (
--     select 1 from pg_policies
--     where schemaname='public' and tablename='seguimientos'
--       and cmd='DELETE' and 'authenticated' = any(roles)
--   ) then
--     create policy seguimientos_borrar_propio
--       on public.seguimientos for delete to authenticated
--       using (seguidor_id = auth.uid());
--   end if;
-- end
-- $bloque$;


-- =============================================================================
-- BLOQUE 6 · (REVISAR MANUALMENTE — NO AUTOMATIZAR) GRANT amplios de tabla
-- -----------------------------------------------------------------------------
--   Si 0.4 muestra INSERT/UPDATE/DELETE a nivel de TABLA (no de columna) para
--   anon o authenticated, es MÁS de lo que la API necesita. Revocar privilegios
--   es una operación sensible: puede romper otros clientes. NO forma parte de
--   esta migración. Ejemplo (NO ejecutar sin analizar antes el impacto):
--     revoke insert, update, delete on public.transmisiones from authenticated;
--   Tras hacerlo, vuelve a aplicar el BLOQUE 1 (permisos por columna).
-- =============================================================================


-- =============================================================================
-- FIN · Recuerda: aplica SÓLO los bloques cuya condición se cumpla en el
--       diagnóstico, y de uno en uno. Vuelve a correr el diagnóstico después.
-- =============================================================================

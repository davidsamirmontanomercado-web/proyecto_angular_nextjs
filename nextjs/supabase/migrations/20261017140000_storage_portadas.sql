-- =============================================================================
-- Migración: bucket de Storage para portadas de transmisiones
-- Archivo: nextjs/supabase/migrations/20261017140000_storage_portadas.sql
-- =============================================================================
-- Objetivo:
--   Permitir subir la imagen de portada de una transmisión a Supabase Storage
--   en lugar de guardar Base64/URLs gigantes en `public.transmisiones`.
--
-- Diseño:
--   * Bucket `portadas`, PÚBLICO para lectura (una portada es contenido público).
--   * Límites propios del bucket (defensa en profundidad, además de la
--     validación del endpoint): 3 MB y sólo image/jpeg, image/png, image/webp,
--     image/gif.
--   * Escritura sólo para `authenticated`, y cada usuario sólo dentro de su
--     propia carpeta `portadas/<auth.uid()>/...`.
--   * Sin service_role y sin debilitar ninguna política existente.
--
-- Garantías:
--   * `on conflict (id) do update`: si el bucket ya existía, se normalizan
--     `public`, `file_size_limit` y `allowed_mime_types` a los valores de esta
--     migración (idempotente).
--   * `drop policy if exists` limitado a los nombres propios de esta migración.
--
-- Aplicación (manual, NO automática):
--   A) Panel de Supabase -> SQL Editor -> pegar y ejecutar.
--   B) Supabase CLI:  supabase db push  (proyecto enlazado).
-- =============================================================================


-- 1) Bucket público de portadas, con límite de 3 MB y MIME permitidos.
--    3145728 = 3 * 1024 * 1024 bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portadas',
  'portadas',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- 2) Lectura pública de los objetos del bucket `portadas`.
drop policy if exists portadas_lectura_publica on storage.objects;
create policy portadas_lectura_publica
  on storage.objects
  for select
  to public
  using (bucket_id = 'portadas');


-- 3) Subida: sólo usuarios autenticados y sólo dentro de su carpeta.
drop policy if exists portadas_subir_autenticado on storage.objects;
create policy portadas_subir_autenticado
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'portadas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- 4) Reemplazo de la propia portada (misma carpeta).
drop policy if exists portadas_actualizar_propia on storage.objects;
create policy portadas_actualizar_propia
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'portadas'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'portadas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- 5) Borrado de la propia portada.
drop policy if exists portadas_borrar_propia on storage.objects;
create policy portadas_borrar_propia
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'portadas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- =============================================================================
-- 6) CONSULTAS DE VERIFICACIÓN (sólo lectura)
-- =============================================================================
-- 6.1) Bucket creado con sus límites:
--   select id, name, public, file_size_limit, allowed_mime_types
--   from storage.buckets where id = 'portadas';
-- 6.2) Políticas del bucket:
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname='storage' and tablename='objects'
--     and policyname like 'portadas%';
-- =============================================================================

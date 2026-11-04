-- =============================================================================
-- Migración: privilegios mínimos del chat (public.mensajes_chat)
-- =============================================================================
-- Objetivo: habilitar SELECT/INSERT del rol `authenticated` para que PostgREST
-- pueda EVALUAR las políticas RLS ya existentes (hoy responde 42501 -> HTTP 403).
--
-- Garantías:
--   * NO crea ni modifica políticas RLS: las existentes quedan intactas.
--   * NO concede privilegios a `anon`.
--   * NO usa service_role.
--   * GRANT por columnas: sólo las columnas que usan realmente el GET y el POST.
--
-- Verificado: las políticas SELECT del chat
--   * chat_leer_publico  -> qual: tipo <> 'privado'
--   * chat_leer_privado  -> remitente_id / destinatario_id / transmision_id
--     (subconsulta a transmisiones: id + anfitrion_id, ya con SELECT concedido)
-- No referencian `fijado`; no tocan empresa_id ni url_stream.
--
-- Aplicación (manual, NO automática):
--   A) Panel de Supabase -> SQL Editor -> pegar y ejecutar.
--   B) Supabase CLI:  supabase db push  (proyecto enlazado).
-- =============================================================================

-- 1) SELECT (rol: authenticated)
--    - Columnas devueltas por el GET: id, transmision_id, contenido, tipo,
--      respondido, remitente_id, fecha.
--    - `oculto`: usado en el WHERE del GET (filtro .eq('oculto', false)).
--    - `destinatario_id` y `transmision_id`: referenciadas por el qual de las
--      políticas SELECT (chat_leer_privado).
--    NO se concede `fijado`: no se devuelve, no se filtra y ninguna política lo usa.
grant select (
  id,
  transmision_id,
  contenido,
  tipo,
  respondido,
  remitente_id,
  fecha,
  oculto,
  destinatario_id
) on public.mensajes_chat to authenticated;

-- 2) INSERT (rol: authenticated)
--    Sólo las columnas que escribe el POST. `tipo`, `fecha`, `oculto`,
--    `respondido` y `fijado` los aplica la base de datos por default.
grant insert (
  transmision_id,
  remitente_id,
  contenido
) on public.mensajes_chat to authenticated;

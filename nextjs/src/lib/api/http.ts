import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createServerSupabase, getSupabaseEnv } from '@/lib/supabase/server';

// Misma lista de orígenes que ya usan las rutas de transmisiones y categorías.
export function getAllowedOrigins(): string[] {
  const origins = ['http://localhost:4200'];

  const angularUrl = process.env.NEXT_PUBLIC_ANGULAR_URL;
  if (angularUrl && angularUrl.trim()) {
    origins.push(angularUrl.trim().replace(/\/+$/, ''));
  }

  // Known production Angular frontend
  origins.push('https://frontend-three-wine-12.vercel.app');

  return Array.from(new Set(origins));
}

/**
 * URL base del propio backend (esquema + host) tal como la ve el navegador.
 *
 * Se prioriza SIEMPRE la cabecera de host de la petición: en Vercel `host` y
 * `x-forwarded-host` son idénticas y contienen el dominio por el que entró el
 * usuario (el alias de producción estable), nunca la URL interna del
 * deployment. `SITE_URL` sólo se usa como último recurso si no hay cabecera.
 *
 * Motivo: usar `SITE_URL` como primera opción es frágil. Si esa variable apunta
 * a un deployment temporal (`backend-<hash>-<team>.vercel.app`), Vercel lo
 * elimina por su política de retención y la redirección OAuth termina en un
 * `410 GONE` ("This deployment was removed according to its retention policy").
 */
export function getBaseUrl(request: Request): string {
  const hostHeader =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host');

  if (hostHeader) {
    // Las cabeceras x-forwarded-* pueden llegar como lista separada por comas:
    // se toma el primer valor (el más cercano al cliente).
    const host = hostHeader.split(',')[0].trim();
    const proto =
      (request.headers.get('x-forwarded-proto')?.split(',')[0].trim()) || 'http';
    return `${proto}://${host}`;
  }

  const envSiteUrl = process.env.SITE_URL;
  if (envSiteUrl) return envSiteUrl.replace(/\/+$/, '');

  return 'http://localhost:3000';
}

export type Cors = {
  headers: (request: Request) => Record<string, string>;
  json: (request: Request, body: unknown, status: number) => NextResponse;
  empty: (request: Request) => NextResponse;
};

// Cada ruta declara sus métodos una sola vez y reutiliza el mismo objeto.
export function cors(allowMethods: string): Cors {
  const baseHeaders = (): Record<string, string> => ({
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  });

  const withOrigin = (request: Request): Record<string, string> => {
    const headers = baseHeaders();
    const origin = request.headers.get('origin');
    const allowed = getAllowedOrigins();
    if (origin && allowed.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'false';
    }
    return headers;
  };

  return {
    headers: withOrigin,
    json: (request, body, status) => NextResponse.json(body, { status, headers: withOrigin(request) }),
    empty: (request) => new NextResponse(null, { status: 204, headers: withOrigin(request) })
  };
}

const BEARER_RE = /^Bearer\s+(\S+)$/i;

export type AuthResult =
  | { ok: true; usuario: User; token: string; db: SupabaseClient }
  | { ok: false; status: number; mensaje: string };

// Cliente de datos ligado al access_token del usuario.
// Con `accessToken` supabase-js envía Authorization: Bearer <token> a PostgREST,
// de modo que RLS ve auth.uid() real y NO se usa service_role.
// La cabecera `global.headers.Authorization` es redundante para PostgREST pero
// garantiza que Storage (que no siempre hereda `accessToken`) también reciba el
// token del usuario y aplique las políticas de `storage.objects`.
export function crearClienteDeUsuario(token: string): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

// Paso A reutilizable: exige `Authorization: Bearer <access_token>` y lo valida
// contra GoTrue antes de tocar la base de datos.
export async function requireUser(request: Request): Promise<AuthResult> {
  const header = request.headers.get('authorization') ?? '';
  const token = BEARER_RE.exec(header.trim())?.[1];

  if (!token) {
    return {
      ok: false,
      status: 401,
      mensaje: 'Autenticación requerida: envía Authorization: Bearer <access_token>.'
    };
  }

  try {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
    const clienteAuth = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await clienteAuth.auth.getUser(token);

    if (error || !data.user) {
      console.error('[requireUser] Token rechazado por Supabase:', error?.message);
      return {
        ok: false,
        status: 401,
        mensaje: error?.message || 'Token no válido o sesión expirada.'
      };
    }

    return { ok: true, usuario: data.user, token, db: crearClienteDeUsuario(token) };
  } catch (err) {
    console.error('[requireUser] Error validando el token:', err);
    return { ok: false, status: 500, mensaje: 'Error interno del servidor.' };
  }
}

/**
 * Exige que el usuario tenga uno de los roles especificados.
 *
 * El rol vive en `user_metadata.rol` (es el que usan también las políticas RLS
 * de Supabase). Si el token no lo trae —por ejemplo una cuenta creada vía
 * Google antes de definir roles— se cae al valor real de `public.usuarios.rol`
 * para no denegar el acceso por un dato ausente en la metadata.
 */
export async function requireRole(
  auth: AuthResult,
  rolesPermitidos: string[]
): Promise<{ ok: boolean; status: number; mensaje: string }> {
  if (!auth.ok) return auth;

  // Priorizamos app_metadata que es donde el admin guarda el rol real
  let rolUsuario: string = auth.usuario.app_metadata?.rol ?? auth.usuario.user_metadata?.rol ?? '';

  if (!rolUsuario) {
    const { data } = await auth.db
      .from('usuarios')
      .select('rol')
      .eq('id', auth.usuario.id)
      .maybeSingle();
    rolUsuario = data?.rol ?? '';
  }

  if (!rolesPermitidos.includes(rolUsuario)) {
    return {
      ok: false,
      status: 403,
      mensaje: `Acceso denegado: se requiere rol ${rolesPermitidos.join(' o ')}.`
    };
  }

  return { ok: true, status: 200, mensaje: 'OK' };
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Devuelve null si el cuerpo no es JSON o no es un objeto.
export async function leerCuerpoJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const cuerpo = await request.json();
    if (cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)) {
      return cuerpo as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export type ErrorBD = { status: number; mensaje: string };

// Convierte los códigos SQL esperables en respuestas HTTP claras.
// Nunca se devuelve el detalle crudo de Postgres al cliente; sólo se extrae el
// nombre de la columna faltante para poder diagnosticar un 23502 sin exponer SQL.
export function mapErrorBD(error: { code?: string; message?: string } | null): ErrorBD | null {
  if (!error) return null;

  switch (error.code) {
    case '23505':
      return { status: 409, mensaje: 'El registro ya existe.' };
    case '23503':
      return { status: 404, mensaje: 'El registro referenciado no existe.' };
    case '23502': {
      const columna = /column "([^"]+)"/i.exec(error.message ?? '')?.[1];
      return {
        status: 400,
        mensaje: columna
          ? `Falta un campo obligatorio en la base de datos: ${columna}.`
          : 'Faltan campos obligatorios.'
      };
    }
    case '23514':
      return { status: 400, mensaje: 'El valor recibido no cumple las restricciones de la base de datos.' };
    case '22P02':
      return { status: 400, mensaje: 'Formato de identificador no válido.' };
    case '42501':
      return { status: 403, mensaje: 'No tienes permisos para esta operación.' };
    default:
      return { status: 500, mensaje: 'Error interno del servidor.' };
  }
}

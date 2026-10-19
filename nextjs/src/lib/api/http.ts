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
function crearClienteDeUsuario(token: string): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  return createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: async () => token,
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
    const clienteAuth = await createServerSupabase();
    const { data, error } = await clienteAuth.auth.getUser(token);

    if (error || !data.user) {
      return {
        ok: false,
        status: 401,
        mensaje: 'Token no válido o sesión expirada.'
      };
    }

    return { ok: true, usuario: data.user, token, db: crearClienteDeUsuario(token) };
  } catch (err) {
    console.error('Error validando el token:', err);
    return { ok: false, status: 500, mensaje: 'Error interno del servidor.' };
  }
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

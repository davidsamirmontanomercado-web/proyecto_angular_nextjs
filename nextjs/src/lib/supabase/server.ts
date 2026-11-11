import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export function getSupabaseEnv() {
  // Variables privadas (sin NEXT_PUBLIC_): estos valores sólo se consumen en el
  // servidor. Se mantienen los nombres antiguos con prefijo como fallback
  // temporal para no romper producción durante la migración en Vercel.
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    '';

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY');

  if (missing.length > 0) {
    throw new Error(
      `[Supabase] Faltan variables de entorno: ${missing.join(', ')}. ` +
      `Revisa tu archivo .env.local y REINICIA el servidor Next.js (Ctrl+C → npm run dev).`
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

/**
 * Crea un cliente con la llave de servicio (admin).
 * Usamos createClient directo de supabase-js para operaciones de backend que
 * requieren saltarse RLS y gestionar usuarios, ya que es más robusto para 
 * llaves de servicio que el cliente de SSR.
 */
export async function createAdminSupabase() {
  const { supabaseUrl } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurada en las variables de entorno.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function createServerSupabase() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
        }
      },
    },
  });
}

export async function getCurrentUser() {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

export async function getSession() {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;
    return data.session;
  } catch {
    return null;
  }
}

export function authCookieOptions(maxAge = 60 * 60 * 24 * 7) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
  };
}

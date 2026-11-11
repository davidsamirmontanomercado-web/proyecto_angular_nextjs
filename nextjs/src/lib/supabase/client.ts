import { createBrowserClient } from '@supabase/ssr';

export function getBrowserSupabaseEnv() {
  // Preferimos los nombres privados (sin NEXT_PUBLIC_); los antiguos se
  // mantienen como fallback temporal durante la migración en Vercel.
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
      `[Supabase Client] Faltan variables de entorno: ${missing.join(', ')}. ` +
      `Revisa tu archivo .env.local y REINICIA el servidor Next.js.`
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

export const createBrowserSupabase = () => {
  const { supabaseUrl, supabaseAnonKey } = getBrowserSupabaseEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
};

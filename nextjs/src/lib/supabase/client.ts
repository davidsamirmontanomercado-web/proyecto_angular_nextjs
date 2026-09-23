import { createBrowserClient } from '@supabase/ssr';

export function getBrowserSupabaseEnv() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    '';

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

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

import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getBaseUrl } from '@/lib/api/http';

function buildLoggedOutUrl(baseUrl: string) {
  // Igual que el resto de pantallas de auth: se prefiere la URL configurada y,
  // si falta, el frontend de producción conocido (nunca localhost en prod).
  const angularBase = (
    process.env.NEXT_PUBLIC_ANGULAR_URL ||
    'https://frontend-three-wine-12.vercel.app'
  ).replace(/\/+$/, '');
  try {
    const url = new URL(`${angularBase}/login`);
    url.searchParams.set('msg', 'logged_out');
    return url;
  } catch {
    return new URL('/google-auth/login?msg=logged_out', baseUrl);
  }
}

export async function POST(request: Request) {
  const baseUrl = getBaseUrl(request);

  try {
    const supabase = await createServerSupabase();
    await supabase.auth.signOut().catch(() => {});
  } catch {
  }

  const next = NextResponse.redirect(buildLoggedOutUrl(baseUrl));
  next.cookies.delete('sb-access-token');
  next.cookies.delete('sb-refresh-token');
  next.cookies.delete('sb-user-email');
  next.cookies.delete('sb-sb-access-token');
  next.cookies.delete('sb-sb-refresh-token');

  return next;
}

export async function GET(request: Request) {
  return POST(request);
}

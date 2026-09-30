import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

function getBaseUrl(request: Request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  if (host) return `${proto}://${host}`;
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envSiteUrl) return envSiteUrl.replace(/\/$/, '');
  return 'http://localhost:3000';
}

export async function GET(request: Request) {
  try {
    const baseUrl = getBaseUrl(request);
    const redirectTo = `${baseUrl}/api/auth/callback`;
    const supabase = await createServerSupabase();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        skipBrowserRedirect: true,
      },
    });

    if (error || !data.url) {
      console.error('[Google OAuth] Error al generar URL de autorización:', error);
      const url = new URL('/google-auth/login', baseUrl);
      url.searchParams.set('error', error?.status === 400 ? 'invalid_request' : 'server_error');
      if (error?.message) url.searchParams.set('desc', encodeURIComponent(error.message));
      return NextResponse.redirect(url);
    }

    return NextResponse.redirect(data.url);
  } catch (err) {
    console.error('[Google OAuth] Error inesperado:', err);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const errorUrl = new URL('/google-auth/login', baseUrl);
    const errMsg = err instanceof Error ? err.message : 'Ocurrió un error desconocido';
    errorUrl.searchParams.set('error', 'server_error');
    errorUrl.searchParams.set('desc', encodeURIComponent(errMsg));
    return NextResponse.redirect(errorUrl);
  }
}

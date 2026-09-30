import { NextResponse } from 'next/server';
import { createServerSupabase, authCookieOptions } from '@/lib/supabase/server';

function getBaseUrl(request: Request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  if (host) return `${proto}://${host}`;
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envSiteUrl) return envSiteUrl.replace(/\/$/, '');
  return 'http://localhost:3000';
}

function getAngularUrl(): string {
  const KNOWN_ANGULAR_URLS = [
    process.env.NEXT_PUBLIC_ANGULAR_URL,
    'https://frontend-three-wine-12.vercel.app',
    'http://localhost:4200',
  ].filter(Boolean) as string[];
  return KNOWN_ANGULAR_URLS[0].replace(/\/+$/, '');
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const baseUrl = getBaseUrl(request);

  if (error || !code) {
    const errorDesc = requestUrl.searchParams.get('error_description');
    console.error('[OAuth Callback] Error o sin código:', { error, errorDesc });
    const url = new URL('/google-auth/login', baseUrl);
    url.searchParams.set('error', error || 'oauth_denied');
    if (errorDesc) url.searchParams.set('desc', encodeURIComponent(errorDesc));
    return NextResponse.redirect(url);
  }

  try {
    const supabase = await createServerSupabase();

    const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

    if (sessionError || !data.session) {
      console.error('[OAuth Callback] Error al intercambiar código por sesión:', sessionError);
      const url = new URL('/google-auth/login', baseUrl);
      const errCode = sessionError?.status === 400 ? 'invalid_request' : (sessionError?.name || 'session_failed');
      url.searchParams.set('error', String(errCode));
      const errMsg = sessionError?.message || 'No se pudo establecer la sesión.';
      if (errMsg) url.searchParams.set('desc', encodeURIComponent(errMsg));
      return NextResponse.redirect(url);
    }

    const { access_token, refresh_token, expires_in = 3600, user } = data.session;

    const angularUser = {
      id: user?.id,
      nombre:
        (user?.user_metadata?.full_name as string) ||
        (user?.user_metadata?.name as string) ||
        (user?.email ? user.email.split('@')[0] : 'Usuario'),
      correo: user?.email || '',
      rol: 'empresa' as const,
      createdAt: user?.created_at ? new Date(user.created_at).getTime() : Date.now(),
    };

    const json = JSON.stringify(angularUser);
    let userB64 = '';
    try {
      if (typeof Buffer !== 'undefined') {
        userB64 = Buffer.from(json, 'utf-8').toString('base64url');
      } else {
        userB64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
    } catch {
      userB64 = encodeURIComponent(json);
    }
    const angularBase = getAngularUrl();
    const successUrl = new URL(`${angularBase}/google-auth`);
    successUrl.searchParams.set('user', userB64);
    successUrl.searchParams.set('at', access_token);
    successUrl.searchParams.set('rt', refresh_token || '');

    const next = NextResponse.redirect(successUrl);
    next.cookies.set('sb-access-token', access_token, authCookieOptions(expires_in));
    next.cookies.set('sb-refresh-token', refresh_token!, authCookieOptions(60 * 60 * 24 * 30));
    if (user?.email) {
      next.cookies.set('sb-user-email', user.email, {
        ...authCookieOptions(expires_in),
        httpOnly: false,
      });
    }

    return next;
  } catch (err) {
    console.error('[OAuth Callback] Error inesperado:', err);
    const errorUrl = new URL('/google-auth/login', baseUrl);
    const errMsg = err instanceof Error ? err.message : 'Ocurrió un error desconocido';
    errorUrl.searchParams.set('error', 'server_error');
    errorUrl.searchParams.set('desc', encodeURIComponent(errMsg));
    return NextResponse.redirect(errorUrl);
  }
}

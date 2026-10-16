import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getAllowedOrigins } from '@/lib/api/http';

// Origen del frontend que lanzó el login. Se acepta `?origin=` explícito o, en
// su defecto, la cabecera `Referer`/`Origin` de la navegación. SIEMPRE se valida
// contra la allowlist (misma que usa CORS): nunca se confía en el valor entrante.
function getValidFrontendOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const candidates: Array<string | null> = [
    requestUrl.searchParams.get('origin'),
    request.headers.get('referer'),
    request.headers.get('origin'),
  ];

  const allowed = getAllowedOrigins();

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const origin = new URL(raw).origin;
      if (allowed.includes(origin)) return origin;
    } catch {
      // valor no parseable como URL: se ignora y se prueba el siguiente
    }
  }

  return null;
}

function getBaseUrl(request: Request): string {
  const envSiteUrl = process.env.SITE_URL;

  if (envSiteUrl) {
    return envSiteUrl.replace(/\/+$/, '');
  }

  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host');

  const proto =
    request.headers.get('x-forwarded-proto') || 'http';

  if (host) {
    return `${proto}://${host}`;
  }

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
      console.error(
        '[Google OAuth] Error al generar URL de autorización:',
        error
      );

      const url = new URL('/google-auth/login', baseUrl);

      url.searchParams.set(
        'error',
        error?.status === 400
          ? 'invalid_request'
          : 'server_error'
      );

      if (error?.message) {
        url.searchParams.set(
          'desc',
          encodeURIComponent(error.message)
        );
      }

      return NextResponse.redirect(url);
    }

    // Se recuerda el origen permitido del frontend para volver a él en el
    // callback. Es una cookie httpOnly del backend, independiente del `state`
    // OAuth que gestiona Supabase.
    const frontendOrigin = getValidFrontendOrigin(request);
    const response = NextResponse.redirect(data.url);
    if (frontendOrigin) {
      response.cookies.set('oauth_origin', frontendOrigin, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        path: '/api/auth',
      });
    }

    return response;
  } catch (err) {
    console.error('[Google OAuth] Error inesperado:', err);

    const baseUrl =
      process.env.SITE_URL || 'http://localhost:3000';

    const errorUrl = new URL(
      '/google-auth/login',
      baseUrl
    );

    const errMsg =
      err instanceof Error
        ? err.message
        : 'Ocurrió un error desconocido';

    errorUrl.searchParams.set('error', 'server_error');
    errorUrl.searchParams.set(
      'desc',
      encodeURIComponent(errMsg)
    );

    return NextResponse.redirect(errorUrl);
  }
}
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

function buildLoggedOutUrl(baseUrl: string) {
  const angularBase = (process.env.NEXT_PUBLIC_ANGULAR_URL || 'http://localhost:4200').replace(/\/+$/, '');
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

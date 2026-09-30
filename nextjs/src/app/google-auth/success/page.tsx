'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function base64UrlDecode(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  try {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

const KNOWN_ANGULAR_URLS = [
  process.env.NEXT_PUBLIC_ANGULAR_URL,
  'https://frontend-three-wine-12.vercel.app',
  'http://localhost:4200',
].filter(Boolean) as string[];

export default function GoogleAuthSuccessPage() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    try {
      const userB64 = params.get('user');
      const accessToken = params.get('at') || '';
      const refreshToken = params.get('rt') || '';
      const angularDashboard = params.get('next') || `${KNOWN_ANGULAR_URLS[0].replace(/\/+$/, '')}/dashboard`;

      if (!userB64) {
        window.location.href = `/google-auth/login?error=missing_data`;
        return;
      }

      const jsonStr = base64UrlDecode(userB64);
      if (!jsonStr) {
        window.location.href = `/google-auth/login?error=bridge_failed`;
        return;
      }
      const user = JSON.parse(jsonStr);

      localStorage.setItem('lm_user', JSON.stringify(user));
      if (accessToken) localStorage.setItem('lm_token', accessToken);
      if (refreshToken) localStorage.setItem('lm_refresh', refreshToken);

      setTimeout(() => {
        window.location.href = angularDashboard;
      }, 300);
    } catch (err) {
      console.error('[Google Auth Success] Error:', err);
      window.location.href = `/google-auth/login?error=bridge_failed`;
    }
  }, [params, router]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto h-14 w-14 rounded-full border-4 border-zinc-200 dark:border-zinc-800 border-t-[#ff3b30] animate-spin mb-6" />
        <h2 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100">
          Iniciando sesión…
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Redirigiendo al panel de LiveMarket
        </p>
      </div>
    </div>
  );
}

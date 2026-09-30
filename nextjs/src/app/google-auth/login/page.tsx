import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/supabase/server';
import GoogleButton from './google-button';

function getAngularUrl(): string {
  const KNOWN_ANGULAR_URLS = [
    process.env.NEXT_PUBLIC_ANGULAR_URL,
    'https://frontend-three-wine-12.vercel.app',
    'http://localhost:4200',
  ].filter(Boolean) as string[];
  return KNOWN_ANGULAR_URLS[0].replace(/\/+$/, '');
}

export const metadata = {
  title: 'Iniciar sesión con Google · LiveMarket',
  description: 'Accede con tu cuenta de Google',
};

const ERROR_LABELS: Record<string, string> = {
  oauth_failed: 'No se pudo iniciar el inicio de sesión con Google.',
  oauth_denied: 'Cancelaste el inicio de sesión o Google denegó el acceso.',
  session_failed: 'No se pudo validar tu sesión. Inténtalo de nuevo.',
  server_error: 'Ocurrió un error en el servidor. Inténtalo en unos momentos.',
  logged_out: 'Has cerrado sesión correctamente.',
  missing_data: 'Faltan datos de la sesión. Vuelve a iniciar sesión.',
  bridge_failed: 'No se pudo completar la redirección al panel. Inténtalo de nuevo.',
  access_denied: 'Google denegó el acceso. Acepta los permisos para continuar.',
  redirect_uri_mismatch:
    'La URL de redireccionamiento no está autorizada. Copia la URL que aparece abajo en Google Cloud Console y Supabase.',
  invalid_client:
    'Client ID o Client Secret incorrectos. Revisa las credenciales de Google.',
  unsupported_response_type:
    'El tipo de respuesta OAuth no está soportado. Revisa la configuración del proveedor.',
  invalid_scope:
    'Uno o más ámbitos (scopes) solicitados no son válidos.',
  temporarily_unavailable:
    'El servicio de Google está temporalmente no disponible. Inténtalo más tarde.',
  server_error_auth:
    'Error interno de Google. Inténtalo de nuevo en unos momentos.',
  invalid_request:
    'Solicitud inválida. Verifica que todos los parámetros de OAuth sean correctos.',
  unauthorized_client:
    'El cliente no está autorizado para usar este tipo de concesión.',
  AuthSessionMissingError:
    'No se pudo establecer la sesión. Vuelve a iniciar el flujo de inicio de sesión.',
  AuthImplicitFlowError:
    'Error en el flujo OAuth. Revisa la configuración de redireccionamiento.',
  AuthCallbackNoRouteError:
    'No se pudo completar la redirección OAuth. Vuelve a intentarlo.',
  AuthPkceUnsupportedError:
    'El flujo PKCE no está soportado. Vuelve a intentarlo.',
  AuthRetryableError:
    'Error temporal de autenticación. Vuelve a intentarlo en unos segundos.',
};

export default async function GoogleLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; desc?: string; msg?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    const angularBase = getAngularUrl();
    const cookieStore = await cookies();
    const at = cookieStore.get('sb-access-token')?.value || '';
    const rt = cookieStore.get('sb-refresh-token')?.value || '';

    const angularUser = {
      id: user.id,
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
      userB64 = Buffer.from(json, 'utf-8').toString('base64url');
    } catch {
      userB64 = encodeURIComponent(json);
    }

    const bridge = new URL(`${angularBase}/google-auth`);
    bridge.searchParams.set('user', userB64);
    bridge.searchParams.set('at', at);
    bridge.searchParams.set('rt', rt);
    redirect(bridge.toString());
  }

  const params = await searchParams;
  const errorKey = params?.error;
  const rawDesc = params?.desc;
  let decodedDesc: string | null = null;
  if (rawDesc) {
    try { decodedDesc = decodeURIComponent(rawDesc); } catch { decodedDesc = rawDesc; }
  }

  const isExternalCodeError =
    (decodedDesc && decodedDesc.toLowerCase().includes('unable to exchange external code')) ||
    (errorKey === 'server_error' && decodedDesc?.startsWith('Unable to exchange'));
  const isClientSecretWrong =
    isExternalCodeError ||
    errorKey === 'invalid_client' ||
    (decodedDesc && decodedDesc.toLowerCase().includes('invalid_client'));
  const isRedirectMismatch =
    errorKey === 'redirect_uri_mismatch' ||
    (decodedDesc && decodedDesc.toLowerCase().includes('redirect_uri'));
  const isInvalidClient =
    errorKey === 'invalid_client' ||
    (decodedDesc && decodedDesc.toLowerCase().includes('invalid_client'));

  let errorMsg: string | null = null;
  if (errorKey || decodedDesc) {
    const baseMsg = ERROR_LABELS[errorKey || ''] || (decodedDesc ? '' : 'Error desconocido.');
    const parts: string[] = [];
    if (baseMsg) parts.push(baseMsg);
    if (errorKey && !isExternalCodeError) parts.push(`(código: ${errorKey})`);
    if (decodedDesc) parts.push(`Detalle: ${decodedDesc}`);
    errorMsg = parts.join(' ').trim();
  }

  const msgKey = params?.msg;
  const successMsg = msgKey === 'logged_out' ? ERROR_LABELS.logged_out : null;

  const angularBase = getAngularUrl();
  const nextBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ||
    'http://localhost:3000';
  const supabaseCallback =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '') +
    '/auth/v1/callback';
  const nextCallback = `${nextBase}/api/auth/callback`;

  return (
    <div className="min-h-screen grid md:grid-cols-[1.05fr_1fr] bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <aside className="relative hidden md:flex flex-col justify-between overflow-hidden p-14 text-white"
        style={{
          background:
            'linear-gradient(140deg,#0a0a0b 0%,#1c1c22 55%,#2a2a33 100%)',
        }}>
        <div className="pointer-events-none absolute -top-44 -right-44 h-[520px] w-[520px] rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(255,59,48,.22),transparent 65%)' }} />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-[440px] w-[440px] rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(255,255,255,.06),transparent 70%)' }} />

        <div className="relative z-10 flex flex-col h-full">
          <a href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <span className="inline-block h-2 w-2 rounded-full bg-[#ff3b30] animate-pulse shadow-[0_0_0_0_rgba(255,59,48,.5)]" />
            LiveMarket
          </a>

          <div className="mt-20">
            <h1 className="text-4xl font-extrabold tracking-tight leading-tight">
              Vende en vivo.
              <br />
              <span className="text-white/45">Crece sin límites.</span>
            </h1>
            <ul className="mt-8 space-y-4 text-sm text-white/70">
              {[
                'Transmisiones segmentadas por categoría',
                'Catálogo integrado en cada en vivo',
                'Perfil empresarial verificado',
                'Analíticas en tiempo real',
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="h-[5px] w-[5px] flex-none rounded-full bg-[#ff3b30] shadow-[0_0_0_3px_rgba(255,59,48,.2)]" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative z-10 mt-20 text-xs text-white/35">
            © 2025 LiveMarket. Todos los derechos reservados.
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center p-8 sm:p-14">
        <div className="w-full max-w-md">
          <div className="md:hidden mb-8">
            <a href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <span className="inline-block h-2 w-2 rounded-full bg-[#ff3b30]" />
              LiveMarket
            </a>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 dark:bg-zinc-900 px-3 py-1 text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
            Google OAuth
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Bienvenido de vuelta</h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Inicia sesión con tu cuenta de Google en un solo clic
          </p>

          {errorMsg && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300">
              <strong className="font-bold block mb-1">⚠️ Error de Google OAuth</strong>
              {errorMsg}
              {isRedirectMismatch && (
                <div className="mt-3 rounded-lg bg-white/80 dark:bg-black/30 p-3 border border-red-200/60 dark:border-red-500/20 font-mono text-[11px] break-all leading-5">
                  🔑 <strong>Debes pegar ESTAS URLs</strong> en 2 sitios:<br />
                  1. Google Cloud Console → Credentials → tu OAuth client → Redirect URIs<br />
                  2. Supabase → Authentication → URL Configuration → Redirect URLs<br /><br />
                  <strong>Para Google Cloud (URIs de redireccionamiento autorizados):</strong><br />
                  <code className="block bg-white dark:bg-zinc-900 px-2 py-0.5 rounded mt-1">{supabaseCallback}</code>
                  <code className="block bg-white dark:bg-zinc-900 px-2 py-0.5 rounded mt-1">{nextCallback}</code>
                </div>
              )}
              {isInvalidClient && (
                <div className="mt-3 rounded-lg bg-white/80 dark:bg-black/30 p-3 border border-red-200/60 dark:border-red-500/20 font-mono text-[11px] break-all leading-5">
                  Revisa Supabase → Authentication → Providers → Google → Client ID / Secret.
                  Ambos deben coincidir EXACTAMENTE con Google Cloud Console (sin espacios).
                </div>
              )}
              {isClientSecretWrong && (
                <div className="mt-3 rounded-lg bg-white/95 dark:bg-black/40 p-3 border border-red-200/60 dark:border-red-500/20 text-[12px] leading-5">
                  <strong className="text-red-700 dark:text-red-300 block mb-2">
                    🔴 ERROR DETECTADO: Tienes mal el Client Secret en Supabase.
                  </strong>
                  <div className="rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-300/60 dark:border-amber-500/30 p-2 mb-3 text-[11px] text-amber-800 dark:text-amber-200">
                    <strong>⚠️ En tu captura veo que en Supabase, el campo "Client Secret (for OAuth)" contiene la URL <code>https://rddkenpjfoposwntcsyn.supabase.co/auth/v1/callback</code>. ESO ESTÁ MAL.</strong><br />
                    Ese campo debe contener el secreto de Google (empieza por <code>GOCSPX-...</code>), NO una URL. Sigue estos pasos:
                  </div>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>
                      <strong>Paso 1 — Copiar el Client Secret REAL de Google Cloud:</strong><br />
                      → Abrir <a target="_blank" rel="noopener noreferrer" className="underline font-bold" href="https://console.cloud.google.com/apis/credentials">Google Cloud → Credentials</a><br />
                      → Entra a tu <code>OAuth 2.0 Client IDs</code><br />
                      → En <strong>Client Secret</strong> pulsa <strong>"Mostrar secret" / "Reveal"</strong> (derecha del input)<br />
                      → Selecciona TODO el texto (doble clic dentro del input), copia (Ctrl+C). Debe parecerse a esto:<br />
                      <code className="bg-white dark:bg-zinc-900 px-2 py-0.5 rounded text-[11px]">GOCSPX-xxxxxxxxx</code>
                    </li>
                    <li>
                      <strong>Paso 2 — Pegar el secret CORRECTO en Supabase:</strong><br />
                      → Abrir <a target="_blank" rel="noopener noreferrer" className="underline font-bold" href="https://supabase.com/dashboard/project/rddkenpjfoposwntcsyn/auth/providers">Supabase → Providers → Google</a><br />
                      → Desplázate a <strong>"Client Secret (for OAuth)"</strong><br />
                      → BORRA lo que hay ahora (la URL que pusiste por error).<br />
                      → PEGA (Ctrl+V) el <code>GOCSPX-...</code> que copiaste en el Paso 1.<br />
                      → <strong>Client IDs</strong> debe quedarse con: <code className="break-all text-[11px]">910194675070-fnaq1gpespffrf6qa96uljj3h68b6tb0.apps.googleusercontent.com</code><br />
                      → <strong>Callback URL (for OAuth)</strong> debe quedarse con: <code className="text-[11px]">https://rddkenpjfoposwntcsyn.supabase.co/auth/v1/callback</code><br />
                      → Pulsa <strong>Save</strong> (botón verde abajo a la derecha).
                    </li>
                    <li>
                      <strong>Paso 3 — Confirma que Google Cloud tiene las URLs correctas:</strong><br />
                      En Google Cloud → tu OAuth Client → <strong>URIs de redireccionamiento autorizados</strong> deben aparecer AL MENOS estas 2 (puedes añadir tu URL de Vercel de Next.js si la tienes):<br />
                      <code className="bg-white dark:bg-zinc-900 px-2 py-0.5 rounded text-[11px] block mt-1">{supabaseCallback}</code>
                      <code className="bg-white dark:bg-zinc-900 px-2 py-0.5 rounded text-[11px] block mt-1">{nextCallback}</code>
                      Pulsa <strong>Save</strong> en Google Cloud también.
                    </li>
                  </ol>
                  <p className="mt-3 text-[11px] text-zinc-600 dark:text-zinc-400">
                    💡 <strong>Extra:</strong> En Google Cloud → <em>OAuth consent screen</em>, si el Publishing Status es "Testing",
                    asegúrate de que tu correo está en <strong>Test users</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {successMsg && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300">
              {successMsg}
            </div>
          )}

          <div className="mt-8 space-y-3">
            <GoogleButton />

            <div className="flex items-center gap-3 my-6 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              o bien
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>

            <a
              href={`${angularBase}/login`}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white text-sm font-semibold text-zinc-900 transition hover:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500"
            >
              🔐 Iniciar con correo y contraseña
            </a>
          </div>

          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            ¿No tienes cuenta?{' '}
            <a href={`${angularBase}/registro`} className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
              Regístrate gratis
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

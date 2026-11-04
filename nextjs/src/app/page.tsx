import Image from 'next/image';
import { getCurrentUser } from '@/lib/supabase/server';

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-24 px-8 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert h-5 w-[100px]"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left my-12">
          <h1 className="max-w-sm text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            LiveMarket
            <span className="block text-xl font-medium mt-2 text-zinc-500 dark:text-zinc-400">
              Backend + Google OAuth
            </span>
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            {user
              ? `Sesión activa como ${user.email}. Puedes ir al panel o probar el flujo de invitado.`
              : 'Panel Next.js con autenticación con Google vía Supabase. Usa los botones de abajo para empezar.'}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 text-sm font-semibold">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              /google-auth/login — Login Google
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              /google-auth/cuenta — Panel privado
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 text-base font-medium sm:flex-row">
          {user ? (
            <>
              <a
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-auto"
                href="/google-auth/cuenta"
              >
                Ir a mi cuenta →
              </a>
              <form action="/api/auth/logout" method="POST" className="w-full md:w-auto">
                <button
                  type="submit"
                  className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                >
                  Cerrar sesión
                </button>
              </form>
            </>
          ) : (
            <>
              <a
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[180px]"
                href="/google-auth/login"
              >
                Iniciar con Google
              </a>
              <a
                className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[180px]"
                href="http://localhost:4200"
              >
                Frontend Angular
              </a>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

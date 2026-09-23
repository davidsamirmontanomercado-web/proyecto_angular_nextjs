'use client';

export default function LogoutButton() {
  const handleLogout = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    form.submit();
  };

  return (
    <form action="/api/auth/logout" method="POST" onSubmit={handleLogout}>
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:text-white"
      >
        <span>↩</span>
        Cerrar sesión
      </button>
    </form>
  );
}

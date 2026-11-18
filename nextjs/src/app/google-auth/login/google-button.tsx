export default function GoogleButton() {
  return (
    <form action="/api/auth/google" method="GET" className="w-full">
      <button
        type="submit"
        className="group flex h-13 w-full items-center justify-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-semibold text-zinc-800 shadow-[0_0_0_1px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(0,0,0,.08),0_10px_26px_rgba(0,0,0,.1)] active:translate-y-0 dark:bg-zinc-50"
      >
        <svg viewBox="0 0 48 48" className="h-5 w-5">
          <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.663 32.774 29.25 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
          <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
          <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.996 16.227 44 24 44z" />
          <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.231-2.227 4.166-4.084 5.57l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
        </svg>
        Continuar con Google
      </button>
    </form>
  );
}

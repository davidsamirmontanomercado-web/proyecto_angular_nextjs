import { redirect } from 'next/navigation';

export default function CuentaRedirectPage() {
  const angularBase = (process.env.NEXT_PUBLIC_ANGULAR_URL || 'http://localhost:4200').replace(/\/+$/, '');
  redirect(`${angularBase}/dashboard`);
}

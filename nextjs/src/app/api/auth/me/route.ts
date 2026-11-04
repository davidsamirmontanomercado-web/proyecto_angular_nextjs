import { cors, requireUser } from '@/lib/api/http';

const CORS = cors('GET, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  // El objeto `usuario` viene de auth.getUser() en requireUser.
  // Contiene la metadata (nombre, rol) que guardamos en el registro.
  const user = auth.usuario;

  return CORS.json(request, {
    data: {
      id: user.id,
      email: user.email,
      nombre: user.user_metadata?.nombre || user.user_metadata?.full_name || user.email?.split('@')[0],
      rol: user.user_metadata?.rol || 'comprador', // Por defecto 'comprador' si no hay rol
      metadata: user.user_metadata,
      createdAt: user.created_at
    }
  }, 200);
}

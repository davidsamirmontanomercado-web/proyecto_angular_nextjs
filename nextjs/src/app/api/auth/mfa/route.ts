import { cors, requireUser } from '@/lib/api/http';

const CORS = cors('GET, POST, DELETE, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

/**
 * Gestiona los factores de autenticación en dos pasos (MFA).
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  try {
    const { data, error } = await auth.db.auth.mfa.listFactors();

    if (error) {
      return CORS.json(request, { error: error.message }, 400);
    }

    return CORS.json(request, { 
      factors: data.all,
      activeFactor: data.all.find(f => f.status === 'verified')
    }, 200);
  } catch (error) {
    return CORS.json(request, { error: 'Error al listar factores de seguridad' }, 500);
  }
}

/**
 * Inicia el proceso de enrolamiento (Enroll) o verificación (Verify) de MFA.
 */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  try {
    const body = await request.json();
    const { action, factorId, challengeId, code } = body;

    // 1. Iniciar enrolamiento (TOTP)
    if (action === 'enroll') {
      const { data, error } = await auth.db.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'LiveMarket',
        friendlyName: auth.usuario.email
      });

      if (error) return CORS.json(request, { error: error.message }, 400);
      return CORS.json(request, { data }, 200);
    }

    // 2. Crear un desafío (Challenge) para un factor existente
    if (action === 'challenge') {
      if (!factorId) return CORS.json(request, { error: 'factorId requerido' }, 400);
      const { data, error } = await auth.db.auth.mfa.challenge({ factorId });
      
      if (error) return CORS.json(request, { error: error.message }, 400);
      return CORS.json(request, { data }, 200);
    }

    // 3. Verificar un código TOTP (Verify)
    if (action === 'verify') {
      if (!factorId || !challengeId || !code) {
        return CORS.json(request, { error: 'factorId, challengeId y code son requeridos' }, 400);
      }
      
      const { data, error } = await auth.db.auth.mfa.verify({
        factorId,
        challengeId,
        code
      });

      if (error) return CORS.json(request, { error: error.message }, 400);

      // Si la verificación es exitosa, actualizamos las cookies con el nuevo token (aal2)
      const response = CORS.json(request, { data }, 200);
      
      if (data?.access_token) {
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as const,
          maxAge: 60 * 60 * 24 * 7, // 1 semana por defecto
          path: '/',
        };
        response.cookies.set('sb-access-token', data.access_token, cookieOptions);
        if (data.refresh_token) {
          response.cookies.set('sb-refresh-token', data.refresh_token, cookieOptions);
        }
      }

      return response;
    }

    return CORS.json(request, { error: 'Acción no válida' }, 400);
  } catch (error) {
    console.error('[MFA POST] Error:', error);
    return CORS.json(request, { error: 'Error en la operación de seguridad' }, 500);
  }
}

/**
 * Elimina un factor de autenticación (Unenroll).
 */
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  try {
    const { factorId } = await request.json();
    if (!factorId) return CORS.json(request, { error: 'factorId requerido' }, 400);

    const { data, error } = await auth.db.auth.mfa.unenroll({ factorId });

    if (error) return CORS.json(request, { error: error.message }, 400);
    return CORS.json(request, { data }, 200);
  } catch (error) {
    return CORS.json(request, { error: 'Error al eliminar el factor de seguridad' }, 500);
  }
}

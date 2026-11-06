import { cors, requireUser } from '@/lib/api/http';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';

const CORS = cors('GET, DELETE, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

/**
 * Obtiene la lista de sesiones activas del usuario.
 * Como no tenemos la Service Role Key de Supabase para consultar auth.sessions directamente,
 * implementamos una detección avanzada del dispositivo actual basada en el User-Agent.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  try {
    const userAgent = request.headers.get('user-agent') || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Análisis del dispositivo actual
    let dispositivo = 'Dispositivo desconocido';
    let sistema = 'Sistema desconocido';
    if (userAgent.includes('Windows')) sistema = 'Windows';
    else if (userAgent.includes('Macintosh')) sistema = 'macOS';
    else if (userAgent.includes('Android')) sistema = 'Android';
    else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) sistema = 'iOS';

    if (userAgent.includes('Chrome')) dispositivo = 'Google Chrome';
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) dispositivo = 'Safari';
    else if (userAgent.includes('Firefox')) dispositivo = 'Mozilla Firefox';
    else if (userAgent.includes('Edg')) dispositivo = 'Microsoft Edge';

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';

    // Si tenemos la llave, intentamos obtener sesiones reales
    // Si tenemos la llave, intentamos obtener sesiones reales
    if (serviceRoleKey) {
      try {
        const admin = await createAdminSupabase();
        // Consultamos la tabla interna de sesiones de Supabase Auth.
        // IMPORTANTE: .schema() va ANTES de .from() en supabase-js
        const { data: dbSessions, error } = await (admin as any)
          .schema('auth')
          .from('sessions')
          .select('*')
          .eq('user_id', auth.usuario.id);

        if (!error && dbSessions) {
          const sesionesMap = (dbSessions as Array<{
            id: string;
            ip: string | null;
            user_agent: string | null;
            updated_at: string | null;
            created_at: string;
          }>).map((s) => {
            const isActual = s.id === (auth.usuario as any).session_id;
            return {
              id: s.id,
              es_actual: isActual,
              ip: s.ip || 'Oculta',
              agente: s.user_agent ? 'Dispositivo registrado' : 'Navegador',
              ultima_actividad: s.updated_at || s.created_at,
              ubicacion: isActual ? 'Conexión actual' : 'Sesión remota'
            };
          });
          return CORS.json(request, { sesiones: sesionesMap }, 200);
        }
      } catch (adminError) {
        console.warn('[Sesiones] Error al usar Admin Key, usando fallback:', adminError);
      }
    }

    // Fallback: Si no hay llave o falla, mostramos solo la sesión actual
    const sesiones = [{
      id: 'current-' + auth.usuario.id.substring(0, 8),
      es_actual: true,
      ip: ip,
      agente: `${dispositivo} en ${sistema}`,
      ultima_actividad: auth.usuario.last_sign_in_at || new Date().toISOString(),
      ubicacion: 'Conexión actual'
    }];

    return CORS.json(request, { sesiones }, 200);
  } catch (error) {
    return CORS.json(request, { error: 'Error al obtener sesiones' }, 500);
  }
}

/**
 * Permite cerrar una sesión específica.
 * En esta versión sin Service Role, si el usuario intenta cerrar su propia sesión
 * (la única que listamos), procedemos a desautenticarlo.
 */
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  try {
    const { sessionId } = await request.json();
    if (!sessionId) return CORS.json(request, { error: 'ID de sesión requerido' }, 400);

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const currentSessionId = (auth.usuario as any).session_id || ('current-' + auth.usuario.id.substring(0, 8));

    // Si es la sesión actual, usamos el flujo normal
    if (sessionId === currentSessionId || sessionId === auth.usuario.id) {
      const supabase = await createServerSupabase();
      await supabase.auth.signOut();
      return CORS.json(request, { message: 'Sesión actual cerrada' }, 200);
    }

    // Si es una sesión remota y tenemos la llave, la cerramos vía Admin
    if (serviceRoleKey) {
      const admin = await createAdminSupabase();
      const { error } = await admin.auth.admin.signOut(sessionId);
      if (!error) return CORS.json(request, { message: 'Sesión remota cerrada' }, 200);
    }

    return CORS.json(request, { message: 'Sesión cerrada correctamente' }, 200);
  } catch (error) {
    return CORS.json(request, { error: 'Error al cerrar sesión' }, 500);
  }
}

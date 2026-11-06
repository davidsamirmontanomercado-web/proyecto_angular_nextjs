import { cors, leerCuerpoJson } from '@/lib/api/http';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/mailersend';

const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  const body = await leerCuerpoJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email) {
    return CORS.json(request, { error: 'El correo es obligatorio.' }, 400);
  }

  try {
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const callbackUrl = `${siteUrl.replace(/\/+$/, '')}/api/auth/callback?type=recovery`;

    // INTENTO 1: Usar el servicio de correo nativo de Supabase (más sencillo)
    const supabase = await createServerSupabase();
    
    // Verificación de llaves Supabase (Anti-error de configuración)
    const { supabaseAnonKey } = await (await import('@/lib/supabase/server')).getSupabaseEnv();
    if (supabaseAnonKey.startsWith('sb_') && siteUrl.includes('supabase.co')) {
      return CORS.json(request, { 
        error: 'Las llaves de Supabase en .env.local son para uso local (CLI), pero la URL es de un proyecto remoto. Cámbialas por las llaves del Dashboard de Supabase.',
        technicalInfo: 'Las llaves deben empezar por eyJ...'
      }, 400);
    }

    const { error: nativeError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl,
    });

    if (!nativeError) {
      return CORS.json(request, { message: 'Correo de recuperación enviado (via Supabase).' }, 200);
    }

    console.warn('[Auth Recuperar] Falló el servicio nativo de Supabase, intentando MailerSend...', nativeError.message);

    // INTENTO 2: Si falla el nativo, intentamos MailerSend usando el Admin Link
    const adminSupabase = await createAdminSupabase();
    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: { redirectTo: callbackUrl }
    });

    if (linkError) {
      console.error('[Auth Recuperar] Error al generar link administrativo:', linkError.message);
      return CORS.json(request, { error: 'No se pudo generar el enlace de recuperación. ¿El correo es correcto?' }, 400);
    }

    const recoveryLink = linkData.properties.action_link;

    const emailRes = await sendEmail({
      to: email,
      subject: 'Restablece tu contraseña - LiveMarket',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #0f172a;">Recuperación de cuenta</h2>
          <p>Haz clic en el botón para cambiar tu contraseña:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${recoveryLink}" style="background: #0f172a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
              Restablecer contraseña
            </a>
          </div>
          <p style="color: #64748b; font-size: 12px;">Si no pediste esto, ignora el mensaje. El link expira en 1 hora.</p>
        </div>
      `
    });

    if (emailRes.ok) {
      return CORS.json(request, { message: 'Correo de recuperación enviado.' }, 200);
    }

    // Si todo falla, devolvemos el error con el máximo detalle posible.
    console.error('[Auth Recuperar] Error final enviando email:', JSON.stringify(emailRes.error, null, 2));

    let mensajeError = 'No se pudo enviar el correo de recuperación.';
    if (emailRes.error?.message?.includes('unverified')) {
      mensajeError = 'Tu dominio en MailerSend no está verificado aún. Revisa los registros DNS en Hostinger.';
    } else if (emailRes.error?.message?.includes('approved')) {
      mensajeError = 'Tu cuenta de MailerSend está pendiente de aprobación. Completa el formulario de negocio.';
    } else if (emailRes.error?.code === 401 || emailRes.error?.code === 403) {
      mensajeError = 'La API Key de MailerSend no es válida o no tiene permisos.';
    }

    return CORS.json(request, { 
      error: mensajeError,
      details: emailRes.error,
      technicalInfo: 'Asegúrate de que el dominio signasep.site esté verificado en MailerSend.'
    }, 500);

  } catch (err: any) {
    console.error('[Auth Recuperar] Error inesperado:', err);
    return CORS.json(request, { 
      error: 'Error interno del servidor.',
      details: err.message || String(err)
    }, 500);
  }
}

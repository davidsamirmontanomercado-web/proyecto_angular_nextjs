import { cors, leerCuerpoJson, getBaseUrl } from '@/lib/api/http';
import { createAdminSupabase } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/resend';

const CORS = cors('POST, OPTIONS');

// Validación de formato deliberadamente laxa: sólo se comprueba que el valor
// tenga forma de correo. Nunca se comprueba si está registrado.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Respuesta única para toda solicitud con formato válido. Es idéntica exista o
// no la cuenta y se haya podido enviar o no el correo, de modo que la respuesta
// HTTP no permite enumerar usuarios.
const RESPUESTA_GENERICA = {
  message:
    'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
};

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  const body = await leerCuerpoJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  // Único error que sí se distingue: el formato del correo. No revela si la
  // cuenta existe.
  if (!email || !EMAIL_RE.test(email)) {
    return CORS.json(request, { error: 'El correo electrónico no es válido.' }, 400);
  }

  try {
    // Se deriva del host real de la petición (el dominio de producción estable
    // del backend), no de SITE_URL, para que el enlace no apunte a un
    // deployment temporal.
    const siteUrl = getBaseUrl(request).replace(/\/+$/, '');
    const callbackUrl = `${siteUrl}/api/auth/callback`;

    // Diagnóstico: sólo se registra el inicio del proceso. Nunca el correo del
    // solicitante (dato personal) ni ningún token.
    console.log('[Auth Recuperar] Inicio del proceso de recuperación de contraseña.');

    const admin = await createAdminSupabase();

    // Se genera el token de recuperación con la API de administración. No se
    // reenvía el `action_link` de Supabase porque usa el flujo implícito y
    // entrega la sesión en el fragmento de la URL (#access_token=...), que el
    // backend nunca recibe. En su lugar se construye un enlace propio hacia
    // /api/auth/callback con el `hashed_token`; ese endpoint lo canjea por una
    // sesión con `verifyOtp` y redirige a Angular.
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    const hashedToken = data?.properties?.hashed_token;

    if (error || !hashedToken) {
      // Causa habitual: el correo no pertenece a ninguna cuenta. Se responde
      // igual que en el caso correcto para no revelar si existe. Se registra el
      // motivo técnico de Supabase, nunca el correo ni el token.
      console.error('[Auth Recuperar] No se generó el enlace de recuperación:', {
        motivo: error?.message || 'hashed_token ausente',
        status: error?.status,
      });
      return CORS.json(request, RESPUESTA_GENERICA, 200);
    }

    // Diagnóstico: el enlace existe. Nunca se registra el `hashed_token`.
    console.log('[Auth Recuperar] Enlace de recuperación generado correctamente.');

    const enlace = `${callbackUrl}?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;

    const emailRes = await sendEmail({
      to: email,
      subject: 'Restablece tu contraseña - LiveMarket',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #0f172a;">Recuperación de cuenta</h2>
          <p>Haz clic en el botón para cambiar tu contraseña:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${enlace}" style="background: #0f172a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
              Restablecer contraseña
            </a>
          </div>
          <p style="color: #64748b; font-size: 12px;">Si no pediste esto, ignora el mensaje. El enlace expira en 1 hora.</p>
        </div>
      `,
    });

    if (!emailRes.ok) {
      // Resend RECHAZÓ la petición (clave inválida, dominio no verificado,
      // remitente no autorizado, límite del plan...). Se registra el
      // diagnóstico en servidor sin credenciales ni tokens y se responde igual
      // que en el caso correcto para no revelar información.
      console.error('[Auth Recuperar] Resend RECHAZÓ el envío del correo de recuperación:', {
        statusCode: emailRes.statusCode,
        code: emailRes.error?.code,
        message: emailRes.error?.message,
        campos: emailRes.error?.campos,
        codigos: emailRes.error?.codigos,
      });
    } else if (emailRes.estado !== 'encolado') {
      // CASO CRÍTICO: Resend devolvió 2xx (petición aceptada) pero el correo
      // NO se entregará. Se registra como error.
      console.error(
        '[Auth Recuperar] Resend aceptó la petición pero el correo NO se entregará:',
        {
          estado: emailRes.estado,
          statusCode: emailRes.statusCode,
          envioPausado: emailRes.envioPausado,
          messageId: emailRes.messageId,
          avisos: emailRes.avisos,
        }
      );
    } else {
      // Caso correcto: el mensaje está en cola. La entrega final se comprueba
      // en el panel de Resend (Logs) con ese `messageId`.
      console.log('[Auth Recuperar] Correo encolado por Resend.', {
        statusCode: emailRes.statusCode,
        messageId: emailRes.messageId,
      });
    }

    return CORS.json(request, RESPUESTA_GENERICA, 200);
  } catch (err) {
    // Error de configuración del servidor (variables ausentes, Supabase caído,
    // etc.). Es independiente de si el correo existe, por lo que no permite
    // enumerar usuarios; se devuelve 500 sin detalles.
    console.error(
      '[Auth Recuperar] Error inesperado:',
      err instanceof Error ? err.message : 'desconocido'
    );
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

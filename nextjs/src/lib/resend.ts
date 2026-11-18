import { Resend } from 'resend';

// =============================================================================
// Proveedor de correo: Resend (https://resend.com)
// -----------------------------------------------------------------------------
// Envía correos transaccionales (recuperación de contraseña, etc.).
// Resend solo requiere verificación DNS (SPF/DKIM); NO exige que el dominio
// tenga una web pública, a diferencia de MailerSend que rechazó la cuenta.
// =============================================================================

const resend = new Resend(process.env.RESEND_API_KEY || '');

interface MailOptions {
  to: string;
  toName?: string;
  subject: string;
  text?: string;
  html: string;
}

/** Error ya normalizado y sin datos sensibles (nunca incluye la API Key). */
export interface MailError {
  statusCode?: number;
  code?: string;
  message?: string;
  /** Campos que el proveedor señaló como inválidos. Nunca sus valores. */
  campos?: string[];
  /** Códigos de error del proveedor, si los hay. */
  codigos?: string[];
}

/** Aviso devuelto por el proveedor. */
export interface MailWarning {
  type?: string;
  message?: string;
}

/**
 * Estado real del envío. En Resend un `200` con `id` significa que el mensaje
 * fue aceptado y está en cola para enviarse. Cualquier otro caso se considera
 * `rechazado`.
 */
export type EstadoEnvio =
  | 'encolado'
  | 'pausado'
  | 'suprimido_parcial'
  | 'suprimido_total'
  | 'rechazado';

export type MailSendResult =
  | {
      ok: true;
      statusCode: number;
      estado: Exclude<EstadoEnvio, 'rechazado'>;
      messageId: string | null;
      envioPausado: boolean;
      avisos: MailWarning[];
    }
  | {
      ok: false;
      estado: 'rechazado';
      statusCode?: number;
      error: MailError;
    };

const fromEmail = process.env.MAIL_FROM || 'no-reply@signasep.site';
const fromName = process.env.MAIL_FROM_NAME || 'LiveMarket';

/**
 * Envía un correo usando Resend y devuelve el estado REAL del envío.
 *
 * No registra ni devuelve la respuesta completa: sólo se expone lo necesario
 * para diagnosticar (código HTTP, estado, identificador del mensaje y errores
 * normalizados sin datos sensibles).
 */
export async function sendEmail({
  to,
  toName,
  subject,
  text,
  html,
}: MailOptions): Promise<MailSendResult> {
  // Sin clave, Resend lanzaría un error de autenticación. Se avisa explícitamente
  // (sin revelar el valor) para que la causa sea reconocible al primer vistazo.
  if (!process.env.RESEND_API_KEY) {
    console.error('[Resend] RESEND_API_KEY no está definida en el entorno.');
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: toName ? [`${toName} <${to}>`] : [to],
      subject,
      html,
      text: text || html.replace(/<[^>]*>?/gm, ''),
    });

    if (error || !data?.id) {
      const normalizado: MailError = {
        statusCode: (error as any)?.statusCode,
        code: (error as any)?.name,
        message: error?.message,
      };

      console.error('[Resend] Envío rechazado:', {
        statusCode: normalizado.statusCode,
        code: normalizado.code,
        message: normalizado.message,
      });

      return {
        ok: false,
        estado: 'rechazado',
        statusCode: normalizado.statusCode,
        error: normalizado,
      };
    }

    console.log('[Resend] Respuesta del proveedor:', {
      statusCode: 200,
      estado: 'encolado',
      messageId: data.id,
    });

    return {
      ok: true,
      statusCode: 200,
      estado: 'encolado',
      messageId: data.id,
      envioPausado: false,
      avisos: [],
    };
  } catch (err: any) {
    // Error de red/DNS o error inesperado del SDK.
    const normalizado: MailError = {
      message: err?.message || 'Error desconocido al enviar el correo',
    };

    console.error('[Resend] Error inesperado:', normalizado.message);

    return {
      ok: false,
      estado: 'rechazado',
      error: normalizado,
    };
  }
}

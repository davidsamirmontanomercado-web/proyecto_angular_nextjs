import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";

const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY || '',
});

const sentFrom = new Sender(
  process.env.MAIL_FROM || 'no-reply@signasep.site',
  process.env.MAIL_FROM_NAME || 'LiveMarket'
);

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
  /** Detalle de validación devuelto por MailerSend (p. ej. campo `to`). */
  details?: unknown;
}

/**
 * Servicio para enviar correos usando MailerSend.
 *
 * No registra la respuesta ni el cuerpo del error completos: la respuesta de
 * MailerSend incluye la dirección del destinatario y el error puede arrastrar
 * cabeceras de la petición. Sólo se normaliza y se registra lo necesario para
 * diagnosticar (código HTTP, código y mensaje).
 */
export async function sendEmail({
  to,
  toName,
  subject,
  text,
  html,
}: MailOptions): Promise<{ ok: true; statusCode: number } | { ok: false; error: MailError }> {
  const recipients = [
    new Recipient(to, toName || to.split('@')[0])
  ];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setReplyTo(sentFrom)
    .setSubject(subject)
    .setHtml(html)
    .setText(text || html.replace(/<[^>]*>?/gm, ''));

  try {
    const response = await mailerSend.email.send(emailParams);
    console.log('[MailerSend] Correo aceptado. statusCode:', response.statusCode);
    return { ok: true, statusCode: response.statusCode };
  } catch (error: any) {
    // El SDK lanza { headers, body, statusCode } en errores HTTP, o el error
    // nativo (red/DNS) si la petición no llegó a salir.
    const errorData = error?.body ?? error?.response?.data ?? null;
    const normalizado: MailError = {
      statusCode: error?.statusCode ?? error?.response?.status,
      code: errorData?.code ?? errorData?.error?.code,
      message: errorData?.message ?? errorData?.error?.message ?? error?.message,
      details: errorData?.errors ?? undefined,
    };

    console.error('[MailerSend] Envío rechazado:', {
      statusCode: normalizado.statusCode,
      code: normalizado.code,
      message: normalizado.message,
    });

    return { ok: false, error: normalizado };
  }
}

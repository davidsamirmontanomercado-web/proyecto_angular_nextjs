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

/**
 * Servicio para enviar correos usando MailerSend.
 */
export async function sendEmail({ to, toName, subject, text, html }: MailOptions) {
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
    console.log('[MailerSend] Correo enviado con éxito:', response);
    return { ok: true, response };
  } catch (error: any) {
    // Intentamos extraer el mensaje de error real de MailerSend
    const errorData = error.body || error.response?.data || error.message || error;
    console.error('[MailerSend] Error detallado al enviar correo:', JSON.stringify(errorData, null, 2));
    return { ok: false, error: errorData };
  }
}

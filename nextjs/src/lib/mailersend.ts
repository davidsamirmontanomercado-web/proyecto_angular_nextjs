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
  /** Campos que MailerSend señaló como inválidos (p. ej. `from.email`). Nunca sus valores. */
  campos?: string[];
  /** Códigos de error del proveedor (p. ej. `MS42207`) extraídos del detalle. */
  codigos?: string[];
}

/** Aviso devuelto por MailerSend (p. ej. destinatario suprimido). */
export interface MailWarning {
  /** Tipo técnico del aviso: SOME_SUPPRESSED, ALL_SUPPRESSED, ... */
  type?: string;
  /** Explicación genérica del aviso. No incluye direcciones de correo. */
  message?: string;
}

/**
 * Estado real del envío, deducido de la respuesta de MailerSend.
 *
 * IMPORTANTE: MailerSend responde `202 Accepted` en tres situaciones distintas
 * (documentación oficial, "Sending queued" / "Sending paused" / "Validation
 * warning"):
 *   - el mensaje queda en cola y se enviará            -> `encolado`
 *   - el envío de la cuenta/dominio está pausado       -> `pausado`
 *   - parte de los destinatarios están suprimidos      -> `suprimido_parcial`
 *   - TODOS los destinatarios están suprimidos: "the email is not sent" y NO
 *     se devuelve `x-message-id`                       -> `suprimido_total`
 *   - MailerSend rechaza la petición (422/401/403...)  -> `rechazado`
 *
 * Por eso un `202` NO equivale a entrega: el estado se deduce de las cabeceras
 * (`x-message-id`, `x-send-paused`) y del cuerpo (`warnings`) reales.
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
      /** Identificador del mensaje (cabecera `x-message-id`). Sirve para consultar la entrega. */
      messageId: string | null;
      /** true si MailerSend indica que el envío está pausado (`x-send-paused`). */
      envioPausado: boolean;
      /** Avisos del proveedor, sin direcciones de correo. */
      avisos: MailWarning[];
    }
  | {
      ok: false;
      estado: 'rechazado';
      statusCode?: number;
      error: MailError;
    };

/** Extrae los avisos del cuerpo de MailerSend descartando cualquier dato personal. */
function extraerAvisos(body: unknown): MailWarning[] {
  if (!body || typeof body !== 'object') return [];

  const warnings = (body as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];

  return warnings
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map((w) => ({
      type: typeof w.type === 'string' ? w.type : undefined,
      // Sólo el texto genérico del aviso: `recipients` incluiría direcciones de
      // correo (dato personal) y se descarta deliberadamente.
      message:
        typeof w.message === 'string'
          ? w.message
          : typeof w.warning === 'string'
            ? w.warning
            : undefined,
    }));
}

/** Extrae de un error de validación los nombres de campo y los códigos `#MSxxxxx`. */
function extraerDiagError(errorData: any): { campos?: string[]; codigos?: string[] } {
  const errors = errorData?.errors;
  const campos =
    errors && typeof errors === 'object' && !Array.isArray(errors)
      ? Object.keys(errors)
      : undefined;

  // Nunca se registran los valores (podrían contener el correo del destinatario);
  // sólo los códigos del proveedor, que identifican la causa exacta.
  const serializado = JSON.stringify(errorData ?? null) ?? '';
  const codigos = Array.from(
    new Set((serializado.match(/#?MS\d{5}/g) ?? []).map((c) => c.replace('#', '')))
  );

  return {
    campos: campos && campos.length ? campos : undefined,
    codigos: codigos.length ? codigos : undefined,
  };
}

/**
 * Envía un correo usando MailerSend y devuelve el estado REAL del envío.
 *
 * No registra ni devuelve la respuesta completa: la respuesta del proveedor
 * incluye la dirección del destinatario y el error puede arrastrar cabeceras de
 * la petición. Sólo se expone lo necesario para diagnosticar (código HTTP,
 * estado, identificador del mensaje, avisos sin datos personales y errores
 * normalizados).
 */
export async function sendEmail({
  to,
  toName,
  subject,
  text,
  html,
}: MailOptions): Promise<MailSendResult> {
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

  // Sin clave, el SDK enviaría `Authorization: Bearer ` y MailerSend respondería
  // 401. Se avisa explícitamente (sin revelar el valor) para que la causa sea
  // reconocible al primer vistazo en los logs.
  if (!process.env.MAILERSEND_API_KEY) {
    console.error('[MailerSend] MAILERSEND_API_KEY no está definida en el entorno.');
  }

  try {
    const response = await mailerSend.email.send(emailParams);

    // El SDK devuelve { headers, body, statusCode }; `headers` ya viene
    // normalizado a objeto con claves en minúsculas.
    const headers = response.headers ?? {};
    const messageId: string | null =
      headers['x-message-id'] ?? headers['X-Message-Id'] ?? null;
    const envioPausado =
      String(headers['x-send-paused'] ?? '').toLowerCase() === 'true';
    const avisos = extraerAvisos(response.body);

    const suprimidoTotal =
      avisos.some((a) => a.type === 'ALL_SUPPRESSED') ||
      (avisos.length > 0 && !messageId);
    const suprimidoParcial = avisos.some((a) => a.type === 'SOME_SUPPRESSED');

    let estado: Exclude<EstadoEnvio, 'rechazado'>;
    if (suprimidoTotal) {
      estado = 'suprimido_total';
    } else if (envioPausado) {
      estado = 'pausado';
    } else if (suprimidoParcial) {
      estado = 'suprimido_parcial';
    } else {
      estado = 'encolado';
    }

    console.log('[MailerSend] Respuesta del proveedor:', {
      statusCode: response.statusCode,
      estado,
      messageId,
      envioPausado,
      avisos: avisos.map((a) => a.type).filter(Boolean),
    });

    return {
      ok: true,
      statusCode: response.statusCode,
      estado,
      messageId,
      envioPausado,
      avisos,
    };
  } catch (error: any) {
    // El SDK lanza { headers, body, statusCode } en errores HTTP, o el error
    // nativo (red/DNS) si la petición no llegó a salir.
    const errorData = error?.body ?? error?.response?.data ?? null;
    const diag = extraerDiagError(errorData);
    const normalizado: MailError = {
      statusCode: error?.statusCode ?? error?.response?.status,
      code: errorData?.code ?? errorData?.error?.code,
      message: errorData?.message ?? errorData?.error?.message ?? error?.message,
      campos: diag.campos,
      codigos: diag.codigos,
    };

    console.error('[MailerSend] Envío rechazado:', {
      statusCode: normalizado.statusCode,
      code: normalizado.code,
      message: normalizado.message,
      campos: normalizado.campos,
      codigos: normalizado.codigos,
    });

    return {
      ok: false,
      estado: 'rechazado',
      statusCode: normalizado.statusCode,
      error: normalizado,
    };
  }
}

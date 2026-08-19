import { sleep } from './utils.js';

class SendError extends Error {
  constructor(message, { permanent = false, status = null } = {}) {
    super(message);
    this.permanent = permanent;
    this.status = status;
  }
}

function errorFromStatus(status, body) {
  const permanent = status >= 400 && status < 500 && status !== 429;
  return new SendError(`HTTP ${status}: ${String(body).slice(0, 300)}`, { permanent, status });
}

async function sendViaBrevo(config, message) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: message.to, name: message.toName }],
      replyTo: config.replyTo ? { email: config.replyTo } : undefined,
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw errorFromStatus(response.status, body);
  try { return JSON.parse(body).messageId ?? 'ok'; } catch { return 'ok'; }
}

async function sendViaResend(config, message) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `${config.senderName} <${config.senderEmail}>`,
      to: [message.to],
      reply_to: config.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw errorFromStatus(response.status, body);
  try { return JSON.parse(body).id ?? 'ok'; } catch { return 'ok'; }
}

let smtpTransport = null;

async function sendViaSMTP(config, message) {
  if (!smtpTransport) {
    let nodemailer;
    try {
      ({ default: nodemailer } = await import('nodemailer'));
    } catch {
      throw new SendError(
        'O modo SMTP precisa do nodemailer. Rode: npm install nodemailer',
        { permanent: true }
      );
    }
    smtpTransport = nodemailer.createTransport({
      host: config.smtpHost,
      port: Number(config.smtpPort || 587),
      secure: Number(config.smtpPort) === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });
  }
  const info = await smtpTransport.sendMail({
    from: `"${config.senderName}" <${config.senderEmail}>`,
    to: `"${message.toName}" <${message.to}>`,
    replyTo: config.replyTo || undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return info.messageId;
}

const PROVIDERS = { brevo: sendViaBrevo, resend: sendViaResend, smtp: sendViaSMTP };

export async function sendWithRetry(config, message) {
  const send = PROVIDERS[config.provider];
  if (!send) {
    return { ok: false, attempts: 0, error: `Provedor desconhecido: "${config.provider}".` };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= config.maxSendAttempts; attempt++) {
    try {
      const messageId = await send(config, message);
      return { ok: true, messageId, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (err.permanent) break;
      if (attempt === config.maxSendAttempts) break;
      const backoff = Math.round(1000 * 2 ** (attempt - 1) * (1 + Math.random() * 0.3));
      await sleep(backoff);
    }
  }

  return {
    ok: false,
    attempts: config.maxSendAttempts,
    error: lastError?.message || 'erro desconhecido',
    permanent: Boolean(lastError?.permanent),
  };
}

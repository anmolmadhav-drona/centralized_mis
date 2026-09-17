// Mail adapter — pluggable outbound email with a visible development sink.
//
// Transports:
//   • SMTP  — production transport (nodemailer), activated when SMTP_HOST is
//             set. Credentials live ONLY in server env vars; they are never
//             logged and never exposed to the browser.
//   • DEV   — development sink used when SMTP_HOST is not set: the email is
//             printed to the server console, clearly marked DEV ONLY. This
//             makes the password-reset flow fully testable locally without
//             any mail provider — WITHOUT faking real delivery: in
//             production with no SMTP configured, sendMail() FAILS loudly
//             (MailNotConfiguredError) instead of pretending to send.
//
// Anti-patterns intentionally avoided:
//   • no silent success when nothing was sent
//   • no credentials/passwords/tokens in logs (only recipient + subject)
import { createTransport, type Transporter } from 'nodemailer'

export interface OutboundMail {
  to: string
  subject: string
  text: string
  html: string
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('SMTP is not configured — outbound email cannot be sent (set SMTP_HOST etc., see .env.example)')
    this.name = 'MailNotConfiguredError'
  }
}

let cachedTransporter: Transporter | null = null

export function smtpConfigured(): boolean {
  return !!process.env.SMTP_HOST
}

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter
  if (!smtpConfigured()) throw new MailNotConfiguredError()
  cachedTransporter = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // STARTTLS on 587, implicit TLS on 465 — standard nodemailer behaviour
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  })
  return cachedTransporter
}

/**
 * Send an email. Throws ONLY MailNotConfiguredError (production, no SMTP) —
 * transport-level failures are returned as a rejected-but-typed result so
 * callers can log them without crashing a request.
 */
export async function sendMail(mail: OutboundMail): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!smtpConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      // Fail loudly — never fake a successful send.
      throw new MailNotConfiguredError()
    }
    // Development sink: visible in the server console, clearly marked.
    // (The reset LINK is printed here on purpose — it is the only way to
    // complete a local password-reset test without a mail provider.)
    const divider = '─'.repeat(72)
    console.log(
      `\n${divider}\n[DEV MAIL SINK] (SMTP not configured — email NOT actually sent)\n` +
        `To:      ${mail.to}\nSubject: ${mail.subject}\n${divider}\n${mail.text}\n${divider}\n`
    )
    return { ok: true }
  }

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@localhost',
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return { ok: true }
  } catch (err) {
    // Log the failure class, never credentials or message bodies.
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown transport error'
    return { ok: false, error: reason }
  }
}

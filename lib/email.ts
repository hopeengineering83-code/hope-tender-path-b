// lib/email.ts
// Lightweight email sender. Falls back to console.log if SMTP is not configured.
// To enable: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM in env.

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const { to, subject, html } = payload;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM ?? "noreply@hopetender.com";

  if (!host || !user || !pass) {
    // SMTP not configured — log only (safe no-op in production until SMTP is set)
    console.log(`[email] Would send to=${to} subject="${subject}" (SMTP not configured)`);
    return;
  }

  // Dynamic import so the module loads even if nodemailer is absent
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const nodemailer = require("nodemailer") as any;
    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    await transporter.sendMail({ from, to, subject, html });
    console.log(`[email] Sent to=${to} subject="${subject}"`);
  } catch (err) {
    console.error(`[email] Failed to send to=${to}:`, err);
    // Never throw — email failure must not crash the app
  }
}

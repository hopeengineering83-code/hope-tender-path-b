import nodemailer from "nodemailer";
import { logger } from "./observability";
type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export type EmailDeliveryResult = {
  delivered: boolean;
  reason?: "NOT_CONFIGURED" | "DELIVERY_FAILED";
};

export type EmailDeliveryConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export function getEmailDeliveryConfig(): EmailDeliveryConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!host || !user || !pass || !from || !Number.isFinite(port) || port <= 0) {
    return null;
  }

  return { host, port, user, pass, from };
}

export function isEmailDeliveryConfigured(): boolean {
  return getEmailDeliveryConfig() !== null;
}

export async function sendEmail(payload: EmailPayload): Promise<EmailDeliveryResult> {
  const { to, subject, html } = payload;
  const config = getEmailDeliveryConfig();

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      logger.warn("[email] SMTP is not configured; message was not delivered");
    }
    return { delivered: false, reason: "NOT_CONFIGURED" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
    await transporter.sendMail({ from: config.from, to, subject, html });
    return { delivered: true };
  } catch (error) {
    logger.error("[email] Delivery failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return { delivered: false, reason: "DELIVERY_FAILED" };
  }
}

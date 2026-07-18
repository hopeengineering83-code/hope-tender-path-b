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

export async function sendEmail(payload: EmailPayload): Promise<EmailDeliveryResult> {
  const { to, subject, html } = payload;
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;

  if (!host || !user || !pass || !process.env.EMAIL_FROM) {
    if (process.env.NODE_ENV !== "production") {
      logger.warn("[email] SMTP is not configured; message was not delivered");
    }
    return { delivered: false, reason: "NOT_CONFIGURED" };
  }

  try {
    const nodemailer = require("nodemailer") as any;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({ from, to, subject, html });
    return { delivered: true };
  } catch (error) {
    logger.error("[email] Delivery failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return { delivered: false, reason: "DELIVERY_FAILED" };
  }
}

import nodemailer from "nodemailer";
import type { EmailSettings } from "@/lib/settings";

export function emailConfigProblem(s: EmailSettings): string | null {
  if (!s.smtpHost) return "SMTP host is missing.";
  if (!s.to) return "Recipient address is missing.";
  if (!s.from && !s.smtpUser) return "Sender address is missing.";
  return null;
}

export async function sendEmail(s: EmailSettings, subject: string, text: string, html: string) {
  const problem = emailConfigProblem(s);
  if (problem) throw new Error(problem);

  const transport = nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassword } : undefined,
    connectionTimeout: 20_000,
  });
  await transport.sendMail({ from: s.from || s.smtpUser, to: s.to, subject, text, html });
}

import nodemailer from "nodemailer";
import type { MailConfig } from "@/lib/config";

// Sending side of the portal's own SMTP settings; the settings
// themselves are parsed in src/lib/config.ts.
export { readMailConfig, type MailConfig } from "@/lib/config";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

// A transport per send: a handful of emails a day doesn't warrant a pool
// kept alive in the process.
export async function sendMail(config: MailConfig, message: MailMessage): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tls === "tls",
    requireTLS: config.tls === "starttls",
    auth: config.auth,
  });
  await transport.sendMail({ from: config.from, ...message });
}

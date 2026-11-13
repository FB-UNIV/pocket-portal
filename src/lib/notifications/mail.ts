import nodemailer from "nodemailer";
import type { MailConfig } from "@/lib/config";
import { withSpan } from "@/lib/observability/tracing";

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
//
// nodemailer isn't instrumented, so each send is a span of its own (#16):
// how many it went to, never who, and a failure by its type only, since
// an SMTP refusal quotes the address it refused. Sends run after the
// response (ADR-0011), inside the request's trace context.
export function sendMail(config: MailConfig, message: MailMessage): Promise<void> {
  return withSpan(
    "email.send",
    { "email.recipients": message.to.length },
    async () => {
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.tls === "tls",
        requireTLS: config.tls === "starttls",
        auth: config.auth,
      });
      await transport.sendMail({ from: config.from, ...message });
    },
    { errorDetail: "type" },
  );
}

import { logger as defaultLogger } from "@/lib/observability/logger";

type Log = Pick<typeof defaultLogger, "error" | "warn" | "debug">;

// Auth.js's logger (src/auth.ts), so sign-in problems are logged in the
// portal's format, with a stack, instead of Auth.js's colored console lines.
// Auth.js only calls debug when its own debug option is on, which it isn't.
export function authLogger(log: Log = defaultLogger) {
  return {
    error(error: Error & { type?: string }) {
      // type, not name: a production build minifies class names.
      log.error({ err: error }, `Auth.js ${error.type ?? error.name}: ${error.message}`);
    },
    warn(code: string) {
      log.warn(`Auth.js warning: ${code}`);
    },
    debug(message: string, metadata?: unknown) {
      log.debug({ metadata }, `Auth.js: ${message}`);
    },
  };
}

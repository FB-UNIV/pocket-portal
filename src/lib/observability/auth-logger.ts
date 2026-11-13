import { logger as defaultLogger } from "@/lib/observability/logger";

type Log = Pick<typeof defaultLogger, "error" | "warn" | "debug">;

// Auth.js's logger (src/auth.ts), so sign-in problems are logged in the
// portal's format, with a stack, instead of Auth.js's colored console lines.
// The shape Auth.js calls: debug gets the metadata as a second argument,
// which this logger deliberately never reads.
type AuthLogger = {
  error(error: Error & { type?: string }): void;
  warn(code: string): void;
  debug(message: string, metadata?: unknown): void;
};

export function authLogger(log: Log = defaultLogger): AuthLogger {
  return {
    error(error: Error & { type?: string }) {
      // type, not name: a production build minifies class names.
      log.error({ err: error }, `Auth.js ${error.type ?? error.name}: ${error.message}`);
    },
    warn(code: string) {
      log.warn(`Auth.js warning: ${code}`);
    },
    // Auth.js calls this even with its own debug option off (a custom
    // debug replaces its no-op), and the metadata it passes is the sign-in
    // itself: "authorization result" carries the access, ID and refresh
    // tokens, the email and the groups. So the message only, never the
    // metadata, at any log level.
    debug(message: string) {
      log.debug(`Auth.js: ${message}`);
    },
  };
}

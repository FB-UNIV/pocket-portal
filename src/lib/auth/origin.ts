import { logger as defaultLogger } from "@/lib/observability/logger";
import { configSource, type ConfigSource } from "@/lib/config";

type WarnLogger = Pick<typeof defaultLogger, "warn">;

// Auth.js derives `trustHost` itself when it is left undefined:
//   config.trustHost ??= !!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== "production")
// (@auth/core/lib/utils/env.js). src/auth.ts overrides it to `true` so a
// self-hosted deployment without AUTH_URL still works — that is the
// documented fallback, not an accident.
//
// The cost of that fallback is that Auth.js then believes whatever `Host`
// header arrives, so a proxy passing an attacker-controlled Host can steer
// the OIDC callback. Setting AUTH_URL pins the origin and removes the
// dependency on the header entirely. We warn rather than refuse to start,
// so `docker run` stays a one-liner, but the tradeoff is no longer silent.
export function warnIfOriginNotPinned(
  env: ConfigSource = configSource(),
  log: WarnLogger = defaultLogger,
): void {
  if (env.NODE_ENV !== "production" || env.AUTH_URL) {
    return;
  }

  log.warn(
    "AUTH_URL is not set: the public origin is being taken from the incoming Host header. " +
      "Set AUTH_URL to this deployment's public URL (the same origin registered as the " +
      "PocketID callback) so OIDC redirects cannot be steered by a spoofed Host header.",
  );
}

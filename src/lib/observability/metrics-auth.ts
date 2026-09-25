import { createHash, timingSafeEqual } from "node:crypto";
import { logger as defaultLogger } from "@/lib/observability/logger";
import { configSource, type ConfigSource } from "@/lib/config";

type InfoLogger = Pick<typeof defaultLogger, "info">;

// /api/metrics is closed by default: runtime telemetry (exact Node
// version, memory, uptime, event-loop lag) is reconnaissance material, and
// the portal can't know who else can reach it. It is served only when
// METRICS_TOKEN is set *and* the request presents it as a Bearer credential.
//
// Both sides are hashed before comparing so timingSafeEqual always sees
// equal-length inputs; comparing the raw strings would have to bail out
// early on a length mismatch and leak the token's length.
export function isMetricsRequestAuthorized(
  authorization: string | null,
  configuredToken: string | undefined,
): boolean {
  if (!configuredToken || !authorization) return false;

  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match) return false;

  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(configuredToken));
}

// A refused scrape is a 404 by design, which on its own tells a deployer
// nothing, so say once at startup which state this instance is in.
export function logMetricsStatus(
  env: ConfigSource = configSource(),
  log: InfoLogger = defaultLogger,
): void {
  log.info(
    env.METRICS_TOKEN
      ? "/api/metrics is enabled for requests bearing METRICS_TOKEN."
      : "/api/metrics is disabled: set METRICS_TOKEN and send it as a Bearer token to scrape it.",
  );
}

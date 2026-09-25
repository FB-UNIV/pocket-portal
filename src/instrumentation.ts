import { registerOTel } from "@vercel/otel";
import { resolveServiceName } from "@/lib/observability/otel";
import { warnIfOriginNotPinned } from "@/lib/auth/origin";
import { nonDefaultFlags, validateConfig } from "@/lib/config";
import { logger, syncLogLevel } from "@/lib/observability/logger";
import { warnIfPocketIdSecretsReadable } from "@/lib/pocketid/secret-exposure";

export async function register() {
  const nodejs = process.env.NEXT_RUNTIME === "nodejs";

  // The config file first, so everything below, OTel included, sees
  // its values. Imported here, not at the top: it reads the filesystem,
  // which the Edge runtime register() also runs in doesn't have.
  let fileProblems: string[] = [];
  if (nodejs) {
    // Exits the process on a CONFIG_FILE that can't be read (see there).
    const { applyConfigFileAtBoot } = await import("@/lib/config-file");
    fileProblems = applyConfigFileAtBoot(logger);
    syncLogLevel();
  }

  registerOTel({ serviceName: resolveServiceName() });

  if (!nodejs) return;

  // Every configuration problem at once, at boot, rather than one per first
  // use. Logged, not fatal: each setting still fails where it's used.
  for (const problem of [...fileProblems, ...validateConfig()]) {
    logger.error(`Configuration: ${problem}`);
  }
  // What this instance runs with, if not the defaults.
  const flags = nonDefaultFlags();
  if (flags.length > 0) logger.info(`Feature flags: ${flags.join(", ")}`);
  // Once per server process, before a deployment misconfiguration like an
  // unpinned origin matters. Node only: the Edge half doesn't see what
  // the config file set.
  warnIfOriginNotPinned();
  // Imported here, not at the top: metrics-auth uses node:crypto, which the
  // Edge runtime doesn't have (per Next's instrumentation guide,
  // runtime-specific code is imported conditionally).
  const { logMetricsStatus } = await import("@/lib/observability/metrics-auth");
  logMetricsStatus();
  // Fire-and-forget so a slow PocketID never delays startup.
  warnIfPocketIdSecretsReadable().catch(() => {});
}

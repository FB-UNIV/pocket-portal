import pino from "pino";
import { readLogLevel } from "@/lib/config";

// An invalid LOG_LEVEL falls back to info rather than letting pino throw at
// import time, which would take every module that logs down with it.
// validateConfig reports it at startup.
function level() {
  try {
    return readLogLevel();
  } catch {
    return "info";
  }
}

export function createLogger(name: string) {
  return pino({
    name,
    level: level(),
  });
}

export const logger = createLogger("pocket-portal");

// The shared logger is created on import, which in instrumentation is
// before the config file has been applied; this re-reads the level.
export function syncLogLevel(log: { level: string } = logger): void {
  log.level = level();
}

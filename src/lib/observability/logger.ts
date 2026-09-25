import pino from "pino";
import { readLogFormat, readLogLevel } from "@/lib/config";

type Stream = { write(line: string): void };

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

function pretty(): boolean {
  try {
    return readLogFormat() === "pretty";
  } catch {
    return false;
  }
}

// pino's own bookkeeping, noise on a human-read line.
const PRETTY_SKIP = new Set(["level", "time", "name", "msg", "err", "pid", "hostname"]);

function prettyValue(value: unknown): string {
  if (typeof value === "string") return /\s|"|=/.test(value) ? JSON.stringify(value) : value;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Whether the message already shows this value: as a word ("GET", "/apps",
// "404") or a number with a unit ("29ms").
function shownIn(words: Set<string>, value: unknown): boolean {
  if (typeof value === "string") return words.has(value);
  if (typeof value === "number") return words.has(String(value)) || words.has(`${value}ms`);
  return false;
}

// One line per entry: time, level, logger name, message, then the key=value
// fields the message doesn't already show, and an error's stack underneath.
// JSON keeps every field; this is for reading.
export function formatPretty(entry: Record<string, unknown>): string {
  const levelName = String(entry.level ?? "").toUpperCase().padEnd(5);
  const name = entry.name ? `${entry.name}: ` : "";
  const words = new Set(String(entry.msg ?? "").split(/\s+/));
  const fields = Object.entries(entry)
    .filter(([key, value]) => !PRETTY_SKIP.has(key) && value !== undefined && !shownIn(words, value))
    .map(([key, value]) => ` ${key}=${prettyValue(value)}`)
    .join("");
  let line = `${entry.time} ${levelName} ${name}${entry.msg ?? ""}${fields}\n`;

  const err = entry.err as { type?: string; message?: string; stack?: string } | undefined;
  if (err) {
    const stack = err.stack ?? `${err.type ?? "Error"}: ${err.message ?? ""}`;
    line += stack
      .split("\n")
      .map((l) => `    ${l}\n`)
      .join("");
  }
  return line;
}

// Decides the format per line, not once: the shared logger is created on
// import, before a config file can have set LOG_FORMAT.
function destination(stream?: Stream): Stream {
  return {
    write(line: string) {
      const out = stream ?? process.stdout;
      out.write(pretty() ? formatPretty(JSON.parse(line)) : line);
    },
  };
}

export function createLogger(name: string, stream?: Stream) {
  return pino(
    {
      name,
      level: level(),
      // "level":"error" rather than 50, and an ISO time rather than epoch ms.
      formatters: { level: (label) => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination(stream),
  );
}

export const logger = createLogger("pocket-portal");

// The shared logger is created on import, which in instrumentation is
// before the config file has been applied; this re-reads the level.
export function syncLogLevel(log: { level: string } = logger): void {
  log.level = level();
}

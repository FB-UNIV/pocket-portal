import type { logger as defaultLogger } from "@/lib/observability/logger";

type Log = Pick<typeof defaultLogger, "info" | "debug" | "warn">;

// The parts of an ended OpenTelemetry span this reads.
interface EndedSpan {
  attributes: Record<string, unknown>;
  duration: [number, number];
}

export interface RequestLogEntry {
  level: "info" | "debug" | "warn";
  message: string;
  fields: { method: string; path: string; route: string; status: number; durationMs: number };
}

// Hit every few seconds by health checks; at info they'd bury everything.
const PROBES = new Set(["/api/health", "/api/ready"]);

// Next ends one "BaseServer.handleRequest" span per request that carries
// the matched route and the real status, plus an outer "bubble" span
// without either, and separate middleware spans (observed on a production
// build). Only the first describes the request.
export function requestLogEntry(span: EndedSpan): RequestLogEntry | null {
  const attrs = span.attributes;
  if (attrs["next.span_type"] !== "BaseServer.handleRequest" || attrs["next.bubble"]) return null;
  const route = attrs["http.route"];
  if (typeof route !== "string") return null;

  const method = String(attrs["http.method"] ?? "GET");
  // Never the query string: the OIDC callback's carries the sign-in code.
  const path = String(attrs["http.target"] ?? route).split("?")[0];
  const status = Number(attrs["http.status_code"]);
  const durationMs = Math.round(span.duration[0] * 1000 + span.duration[1] / 1e6);
  const level = PROBES.has(path) ? "debug" : status >= 500 ? "warn" : "info";

  return {
    level,
    message: `${method} ${path} ${status} ${durationMs}ms`,
    fields: { method, path, route, status, durationMs },
  };
}

// Registered alongside tracing's own export (instrumentation.ts), so a
// request line and its trace describe the same span.
export class RequestLogProcessor {
  constructor(private readonly log: Log) {}

  onStart(): void {}

  onEnd(span: EndedSpan): void {
    const entry = requestLogEntry(span);
    if (entry) this.log[entry.level](entry.fields, entry.message);
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

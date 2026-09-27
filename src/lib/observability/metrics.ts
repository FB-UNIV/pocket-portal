import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

function createMetrics() {
  const register = new Registry();

  /* v8 ignore start -- process-level metrics collection, not our business logic */
  collectDefaultMetrics({ register });
  /* v8 ignore stop */

  const httpRequestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests handled by the portal",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [register],
  });

  const httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"] as const,
    // prom-client's defaults are coarse between 50 ms and 1 s, where the
    // portal's pages sit, and finer than anyone cares about below 25 ms.
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });

  return { register, httpRequestsTotal, httpRequestDuration };
}

// Next bundles instrumentation.ts, which records requests, and the
// /api/metrics route, which serves them, into separate chunks, each with its
// own copy of this module. One registry per process, on globalThis, so both
// copies see it. Per-process counters are what Prometheus expects: each
// replica exposes its own and Prometheus sums them.
const METRICS = Symbol.for("pocket-portal.metrics");
const metrics = ((globalThis as { [METRICS]?: ReturnType<typeof createMetrics> })[METRICS] ??= createMetrics());

export const register = metrics.register;

export const metricsContentType = register.contentType;

// `route` must be the matched route *pattern* (`/admin/requests`,
// `/api/auth/[...nextauth]`), never the raw request path. A raw path is
// whatever a client invents, so every new label value would be a new
// time series held in memory for the life of the process (CWE-770).
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
): void {
  const labels = { method, route, status_code: String(statusCode) };
  metrics.httpRequestsTotal.inc(labels);
  metrics.httpRequestDuration.observe(labels, durationSeconds);
}

import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const register = new Registry();

/* v8 ignore start -- process-level metrics collection, not our business logic */
collectDefaultMetrics({ register });
/* v8 ignore stop */

export const metricsContentType = register.contentType;

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
  registers: [register],
});

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
  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe(labels, durationSeconds);
}

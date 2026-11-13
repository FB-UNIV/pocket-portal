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

  // Portal-level metrics (#16): what the portal does, not just how it
  // serves. Every label value comes from a fixed set in this file, never
  // from a request, so the number of series stays bounded.
  const accessRequestsTotal = new Counter({
    name: "portal_access_requests_total",
    help: "Access requests by what happened to them: created, reopened, approved, denied",
    labelNames: ["event"] as const,
    registers: [register],
  });

  const grantsTotal = new Counter({
    name: "portal_pocketid_grants_total",
    help: "PocketID group grants by outcome: granted, failed (PocketID errored), refused (not a grantable group)",
    labelNames: ["outcome"] as const,
    registers: [register],
  });

  const notificationsTotal = new Counter({
    name: "portal_notifications_total",
    help: "Notification emails by kind (new_request, decision) and outcome: queued, sent, retried (a failed attempt that will be tried again), failed (given up on, or never queued)",
    labelNames: ["kind", "outcome"] as const,
    registers: [register],
  });

  const pocketIdRequestDuration = new Histogram({
    name: "portal_pocketid_request_duration_seconds",
    help: "PocketID API calls by endpoint pattern and outcome (2xx, 4xx, 5xx, error), in seconds",
    labelNames: ["endpoint", "outcome"] as const,
    // PocketID answers in milliseconds when healthy; the top buckets are
    // for it being slow, which every page then is too.
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });

  // Browser-side page load (#16), beaconed to /api/web-vitals. Buckets sit
  // on the "good" and "poor" thresholds: INP 200/500 ms, TTFB 0.8/1.8 s,
  // LCP 2.5/4 s.
  const webVitals = new Histogram({
    name: "portal_web_vitals_seconds",
    help: "Browser Web Vitals (TTFB, LCP, INP) by page route pattern, in seconds",
    labelNames: ["name", "route"] as const,
    buckets: [0.05, 0.1, 0.2, 0.5, 0.8, 1.8, 2.5, 4, 10],
    registers: [register],
  });

  // Integrations (#23): each call to an integrated app, by integration,
  // operation and outcome, so a slow or failing one shows up.
  const integrationRequestDuration = new Histogram({
    name: "portal_integration_request_duration_seconds",
    help: "Calls to integrated apps (Jellyfin…) by integration, operation and outcome (2xx, 4xx, 5xx, error), in seconds",
    labelNames: ["integration", "operation", "outcome"] as const,
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  return {
    register,
    integrationRequestDuration,
    webVitals,
    httpRequestsTotal,
    httpRequestDuration,
    accessRequestsTotal,
    grantsTotal,
    notificationsTotal,
    pocketIdRequestDuration,
  };
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

export type AccessRequestEvent = "created" | "reopened" | "approved" | "denied";

// Counted once the change is committed, alongside its audit event.
export function recordAccessRequestEvent(event: AccessRequestEvent): void {
  metrics.accessRequestsTotal.inc({ event });
}

export type GrantOutcome = "granted" | "failed" | "refused";

// Every attempt to add a user to a PocketID group. A spike in "granted",
// or any "failed", is worth an alert (RUNBOOK, #4).
export function recordGrant(outcome: GrantOutcome): void {
  metrics.grantsTotal.inc({ outcome });
}

export type NotificationKind = "new_request" | "decision";
// queued: in the outbox. sent: delivered to the SMTP server. retried: an
// attempt failed and another is scheduled. failed: given up on after the
// last attempt, or couldn't be queued at all (ADR-0011).
export type NotificationOutcome = "queued" | "sent" | "retried" | "failed";

export function recordNotification(kind: NotificationKind, outcome: NotificationOutcome): void {
  metrics.notificationsTotal.inc({ kind, outcome });
}

// `endpoint` is a pattern such as "GET /api/users/{id}" (see
// lib/pocketid/fetch.ts), never a URL: a path carries user ids.
export function recordPocketIdCall(endpoint: string, outcome: string, durationSeconds: number): void {
  metrics.pocketIdRequestDuration.observe({ endpoint, outcome }, durationSeconds);
}

// `route` is one of the portal's page patterns (lib/observability/web-vitals),
// never a path a browser sent.
export function recordWebVital(name: string, route: string, seconds: number): void {
  metrics.webVitals.observe({ name, route }, seconds);
}

// `operation` is a fixed name in the integration's code (lib/integrations),
// never request input.
export function recordIntegrationCall(integration: string, operation: string, outcome: string, seconds: number): void {
  metrics.integrationRequestDuration.observe({ integration, operation, outcome }, seconds);
}

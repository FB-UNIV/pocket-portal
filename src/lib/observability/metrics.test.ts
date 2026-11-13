import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  register,
  recordHttpRequest,
  metricsContentType,
  recordAccessRequestEvent,
  recordGrant,
  recordNotification,
  recordPocketIdCall,
  recordWebVital,
} from "./metrics";

describe("metrics registry", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("exposes the metrics content type expected by Prometheus", () => {
    expect(metricsContentType).toMatch(/^text\/plain/);
  });

  it("records an HTTP request's count and duration under method/route/status labels", async () => {
    recordHttpRequest("GET", "/api/metrics", 200, 0.042);

    const body = await register.metrics();

    expect(body).toMatch(
      /http_requests_total\{method="GET",route="\/api\/metrics",status_code="200"\} 1/,
    );
    expect(body).toContain("http_request_duration_seconds");
  });

  it("accumulates multiple requests for the same labels", async () => {
    recordHttpRequest("GET", "/", 200, 0.01);
    recordHttpRequest("GET", "/", 200, 0.02);

    const body = await register.metrics();

    expect(body).toMatch(/http_requests_total\{method="GET",route="\/",status_code="200"\} 2/);
  });

  it("keeps distinct labels separate", async () => {
    recordHttpRequest("GET", "/", 200, 0.01);
    recordHttpRequest("POST", "/", 500, 0.05);

    const body = await register.metrics();

    expect(body).toMatch(/http_requests_total\{method="GET",route="\/",status_code="200"\} 1/);
    expect(body).toMatch(/http_requests_total\{method="POST",route="\/",status_code="500"\} 1/);
  });
});

// Next bundles instrumentation.ts (which records requests) and the
// /api/metrics route (which serves them) into separate chunks, each with its
// own copy of this module (observed on a production build).
describe("metrics registry across bundled copies", () => {
  it("is one registry per process, whichever copy records or serves", async () => {
    register.resetMetrics();
    vi.resetModules();
    const otherCopy = await import("./metrics");

    otherCopy.recordHttpRequest("GET", "/apps", 200, 0.03);

    expect(otherCopy.register).toBe(register);
    expect(await register.metrics()).toMatch(/http_requests_total\{method="GET",route="\/apps",status_code="200"\} 1/);
  });
});

// Portal-level metrics (#16): what the portal does, not just how it serves.
describe("portal metrics", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("counts access requests by what happened to them", async () => {
    recordAccessRequestEvent("created");
    recordAccessRequestEvent("created");
    recordAccessRequestEvent("approved");
    recordAccessRequestEvent("denied");

    const body = await register.metrics();

    expect(body).toMatch(/portal_access_requests_total\{event="created"\} 2/);
    expect(body).toMatch(/portal_access_requests_total\{event="approved"\} 1/);
    expect(body).toMatch(/portal_access_requests_total\{event="denied"\} 1/);
  });

  // A grant spike, or grants failing, is what an alert on the portal's
  // PocketID key should watch (#4).
  it("counts PocketID group grants by outcome", async () => {
    recordGrant("granted");
    recordGrant("failed");
    recordGrant("refused");

    const body = await register.metrics();

    expect(body).toMatch(/portal_pocketid_grants_total\{outcome="granted"\} 1/);
    expect(body).toMatch(/portal_pocketid_grants_total\{outcome="failed"\} 1/);
    expect(body).toMatch(/portal_pocketid_grants_total\{outcome="refused"\} 1/);
  });

  it("counts notification emails by kind and outcome", async () => {
    recordNotification("new_request", "sent");
    recordNotification("decision", "failed");

    const body = await register.metrics();

    expect(body).toMatch(/portal_notifications_total\{kind="new_request",outcome="sent"\} 1/);
    expect(body).toMatch(/portal_notifications_total\{kind="decision",outcome="failed"\} 1/);
  });

  // A slow PocketID should be the first thing visible: the portal depends
  // on it for everything.
  it("times PocketID API calls by endpoint pattern and outcome", async () => {
    recordPocketIdCall("GET /api/users/{id}", "2xx", 0.12);
    recordPocketIdCall("GET /api/users/{id}", "5xx", 2);

    const body = await register.metrics();

    expect(body).toMatch(
      /portal_pocketid_request_duration_seconds_count\{endpoint="GET \/api\/users\/\{id\}",outcome="2xx"\} 1/,
    );
    expect(body).toMatch(
      /portal_pocketid_request_duration_seconds_bucket\{le="0.25",endpoint="GET \/api\/users\/\{id\}",outcome="2xx"\} 1/,
    );
    expect(body).toMatch(
      /portal_pocketid_request_duration_seconds_count\{endpoint="GET \/api\/users\/\{id\}",outcome="5xx"\} 1/,
    );
  });
});

// Browser-side page load (#16): what server latency can't see.
describe("web vitals", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("records each vital by name and route pattern, in seconds", async () => {
    recordWebVital("LCP", "/apps", 1.9);
    recordWebVital("INP", "/admin/apps/[id]", 0.15);

    const body = await register.metrics();

    expect(body).toMatch(/portal_web_vitals_seconds_bucket\{le="2.5",name="LCP",route="\/apps"\} 1/);
    expect(body).toMatch(/portal_web_vitals_seconds_bucket\{le="0.2",name="INP",route="\/admin\/apps\/\[id\]"\} 1/);
  });
});

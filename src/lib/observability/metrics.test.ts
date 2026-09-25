import { describe, it, expect, beforeEach } from "vitest";
import { register, recordHttpRequest, metricsContentType } from "./metrics";

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

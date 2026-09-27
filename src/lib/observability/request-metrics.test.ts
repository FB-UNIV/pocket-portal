import { describe, it, expect, beforeEach } from "vitest";
import { register } from "./metrics";
import { RequestMetricsProcessor } from "./request-metrics";

// Shaped like the root span Next.js ends for each request (see
// request-log.test.ts for the other spans it ends alongside).
function request(target: string, route: string, status: number, durationMs: number, method = "GET") {
  return {
    attributes: {
      "next.span_type": "BaseServer.handleRequest",
      "http.method": method,
      "http.target": target,
      "http.route": route,
      "http.status_code": status,
    },
    duration: [Math.floor(durationMs / 1000), (durationMs % 1000) * 1e6] as [number, number],
  };
}

describe("RequestMetricsProcessor", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("counts each finished request under its method, route pattern and status", async () => {
    const processor = new RequestMetricsProcessor();

    processor.onEnd(request("/apps", "/apps", 200, 30));
    processor.onEnd(request("/apps", "/apps", 200, 40));
    processor.onEnd(request("/api/auth/signin", "/api/auth/[...nextauth]", 302, 12, "POST"));

    const body = await register.metrics();
    expect(body).toMatch(/http_requests_total\{method="GET",route="\/apps",status_code="200"\} 2/);
    expect(body).toMatch(
      /http_requests_total\{method="POST",route="\/api\/auth\/\[\.\.\.nextauth\]",status_code="302"\} 1/,
    );
  });

  // A raw path is whatever a client invents: one series per made-up URL.
  it("labels by the matched route, never the raw path or query", async () => {
    const processor = new RequestMetricsProcessor();

    processor.onEnd(request("/made-up-1?x=1", "/_not-found", 404, 5));
    processor.onEnd(request("/made-up-2", "/_not-found", 404, 5));

    const body = await register.metrics();
    expect(body).toMatch(/http_requests_total\{method="GET",route="\/_not-found",status_code="404"\} 2/);
    expect(body).not.toContain("made-up");
  });

  it("observes the duration in seconds, in buckets sized for a portal", async () => {
    const processor = new RequestMetricsProcessor();

    processor.onEnd(request("/apps", "/apps", 200, 180));

    const body = await register.metrics();
    const bucket = (le: string) =>
      new RegExp(`http_request_duration_seconds_bucket\\{le="${le}",method="GET",route="/apps",status_code="200"\\} (\\d+)`);
    expect(body.match(bucket("0.1"))?.[1]).toBe("0");
    expect(body.match(bucket("0.25"))?.[1]).toBe("1");
    for (const le of ["0.025", "0.05", "0.1", "0.25", "0.5", "1", "2.5", "5", "10"]) {
      expect(body).toMatch(bucket(le));
    }
    expect(body).toMatch(/http_request_duration_seconds_sum\{method="GET",route="\/apps",status_code="200"\} 0\.18/);
  });

  it("ignores spans that aren't a handled request (middleware, bubble, outgoing fetch)", async () => {
    const processor = new RequestMetricsProcessor();

    processor.onEnd({ attributes: { "next.span_type": "Middleware.execute" }, duration: [0, 1e6] });
    processor.onEnd({
      attributes: { "next.span_type": "BaseServer.handleRequest", "next.bubble": true, "http.status_code": 200 },
      duration: [0, 1e6],
    });
    processor.onEnd({ attributes: { "http.url": "http://id.example.test/api/users" }, duration: [0, 1e6] });

    expect(await register.metrics()).not.toMatch(/http_requests_total\{/);
  });

  it("has nothing to start, flush or shut down", async () => {
    const processor = new RequestMetricsProcessor();

    expect(processor.onStart()).toBeUndefined();
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});

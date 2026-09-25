import { describe, it, expect, vi } from "vitest";
import { RequestLogProcessor, requestLogEntry } from "./request-log";

// Shaped like the root spans Next.js ends for each request (observed on a
// production build: one span per request with next.route and the real
// status, one outer "bubble" span with neither, and middleware spans).
function span(attributes: Record<string, unknown>, durationMs = 29) {
  return {
    name: String(attributes["next.span_name"] ?? "GET"),
    attributes,
    duration: [Math.floor(durationMs / 1000), (durationMs % 1000) * 1e6] as [number, number],
  };
}

const request = (target: string, route: string, status: number) =>
  span({
    "next.span_type": "BaseServer.handleRequest",
    "next.span_name": `GET ${route}`,
    "http.method": "GET",
    "http.target": target,
    "http.route": route,
    "http.status_code": status,
  });

describe("requestLogEntry", () => {
  it("describes a request: method, path, status, duration and route", () => {
    expect(requestLogEntry(request("/apps", "/apps", 307))).toEqual({
      level: "info",
      message: "GET /apps 307 29ms",
      fields: { method: "GET", path: "/apps", route: "/apps", status: 307, durationMs: 29 },
    });
  });

  // The OIDC callback's query carries the sign-in code and state.
  it("drops the query string", () => {
    const entry = requestLogEntry(
      request("/api/auth/callback/pocketid?code=secret&state=s", "/api/auth/callback/[...nextauth]", 302),
    );

    expect(entry?.fields.path).toBe("/api/auth/callback/pocketid");
    expect(JSON.stringify(entry)).not.toContain("secret");
  });

  it("names the matched route when it differs from the path", () => {
    expect(requestLogEntry(request("/nope", "/_not-found", 404))?.fields).toMatchObject({
      path: "/nope",
      route: "/_not-found",
      status: 404,
    });
  });

  // Probes hit these every few seconds; at info they'd drown everything else.
  it.each(["/api/health", "/api/ready"])("logs %s at debug", (path) => {
    expect(requestLogEntry(request(path, path, 200))?.level).toBe("debug");
  });

  it("warns on a server error (onRequestError logs the error itself)", () => {
    expect(requestLogEntry(request("/apps", "/apps", 500))?.level).toBe("warn");
  });

  it.each([
    ["the outer bubble span", span({ "next.span_type": "BaseServer.handleRequest", "next.bubble": true, "http.target": "/apps", "http.status_code": 200 })],
    ["a middleware span", span({ "next.span_type": "Middleware.execute", "http.target": "/apps" })],
    ["an outgoing fetch", span({ "http.url": "http://id.example.test/api/users", "http.status_code": 200 })],
  ])("ignores %s", (_what, s) => {
    expect(requestLogEntry(s)).toBeNull();
  });
});

describe("RequestLogProcessor", () => {
  it("logs one line per finished request, at the entry's level", () => {
    const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
    const processor = new RequestLogProcessor(log as never);

    processor.onEnd(request("/apps", "/apps", 200) as never);
    processor.onEnd(span({ "next.span_type": "Middleware.execute" }) as never);

    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { method: "GET", path: "/apps", route: "/apps", status: 200, durationMs: 29 },
      "GET /apps 200 29ms",
    );
  });
});

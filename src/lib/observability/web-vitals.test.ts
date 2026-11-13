import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  PAGE_ROUTES,
  routePattern,
  parseVitalsBeacon,
  createRateLimiter,
  handleVitalsBeacon,
} from "./web-vitals";

describe("routePattern", () => {
  it.each([
    ["/", "/"],
    ["/apps", "/apps"],
    ["/apps/", "/apps"],
    ["/admin/apps/client-123", "/admin/apps/[id]"],
    ["/admin/requests", "/admin/requests"],
  ])("%s is %s", (path, route) => {
    expect(routePattern(path)).toBe(route);
  });

  // A client can send any path: only the portal's own pages are labels.
  it.each(["/nope", "/admin/apps/a/b", "/apps/../admin", "//evil", "", "apps"])("%j is not a page", (path) => {
    expect(routePattern(path)).toBeNull();
  });
});

// The list is hand-kept (a page's pattern isn't known to the browser), so
// a new page without an entry would fall out of the metric silently.
describe("PAGE_ROUTES", () => {
  it("lists every page in src/app", () => {
    const appDir = join(process.cwd(), "src", "app");
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "page.tsx") pages.push(path);
      }
    };
    walk(appDir);

    const patterns = pages.map((page) => {
      const dir = relative(appDir, join(page, ".."));
      const segments = dir === "" ? [] : dir.split(sep).filter((s) => !/^\(.*\)$/.test(s));
      return "/" + segments.join("/");
    });

    expect([...PAGE_ROUTES].sort()).toEqual(patterns.sort());
  });
});

describe("parseVitalsBeacon", () => {
  it("reads a vital, in seconds, for a known page", () => {
    expect(parseVitalsBeacon({ name: "LCP", value: 1234.5, path: "/apps" })).toEqual({
      name: "LCP",
      seconds: 1.2345,
      route: "/apps",
    });
  });

  it.each([
    ["an unknown name", { name: "CLS", value: 0.1, path: "/" }],
    ["a made-up name", { name: "pwned", value: 1, path: "/" }],
    ["a negative value", { name: "TTFB", value: -1, path: "/" }],
    ["an absurd value", { name: "TTFB", value: 600_001, path: "/" }],
    ["a non-number", { name: "TTFB", value: "12", path: "/" }],
    ["infinity", { name: "TTFB", value: Infinity, path: "/" }],
    ["an unknown page", { name: "TTFB", value: 12, path: "/nope" }],
    ["a missing path", { name: "TTFB", value: 12 }],
    ["not an object", "LCP"],
    ["null", null],
  ])("rejects %s", (_why, body) => {
    expect(parseVitalsBeacon(body)).toBeNull();
  });
});

describe("createRateLimiter", () => {
  it("allows a burst, then refills over time", () => {
    let now = 0;
    const limiter = createRateLimiter({ perSecond: 2, burst: 3 }, () => now);

    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, true, false]);
    now = 500;
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
    now = 10_000;
    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, true, false]);
  });
});

describe("handleVitalsBeacon", () => {
  const record = vi.fn();
  const deps = (overrides: Partial<Parameters<typeof handleVitalsBeacon>[1]> = {}) => ({
    enabled: true,
    limiter: { take: () => true },
    record,
    ...overrides,
  });
  const beacon = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://portal.example.test/api/web-vitals", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body,
    });
  const LCP = JSON.stringify({ name: "LCP", value: 900, path: "/" });

  beforeEach(() => record.mockReset());

  it("records a valid vital and answers 204", async () => {
    const res = await handleVitalsBeacon(beacon(LCP), deps());

    expect(res.status).toBe(204);
    expect(record).toHaveBeenCalledWith("LCP", "/", 0.9);
  });

  it("is a 404 while off, like /api/metrics without its token", async () => {
    expect((await handleVitalsBeacon(beacon(LCP), deps({ enabled: false }))).status).toBe(404);
    expect(record).not.toHaveBeenCalled();
  });

  // The browser says where a request comes from; a page on another site
  // can't post here. (A script outside a browser can: hence the limits.)
  it("refuses a cross-site beacon", async () => {
    const res = await handleVitalsBeacon(beacon(LCP, { "sec-fetch-site": "cross-site" }), deps());

    expect(res.status).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a body bigger than a beacon needs", async () => {
    const res = await handleVitalsBeacon(beacon(JSON.stringify({ name: "LCP", value: 1, path: "/", pad: "x".repeat(2000) })), deps());

    expect(res.status).toBe(413);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses what isn't a vital", async () => {
    expect((await handleVitalsBeacon(beacon("not json"), deps())).status).toBe(400);
    expect((await handleVitalsBeacon(beacon(JSON.stringify({ name: "CLS", value: 1, path: "/" })), deps())).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("drops beacons over the rate limit", async () => {
    const res = await handleVitalsBeacon(beacon(LCP), deps({ limiter: { take: () => false } }));

    expect(res.status).toBe(429);
    expect(record).not.toHaveBeenCalled();
  });
});

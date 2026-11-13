// Browser Web Vitals (#16 §3): what server latency can't see (network,
// JavaScript download, rendering), beaconed by the browser to
// /api/web-vitals and recorded as portal_web_vitals_seconds.
//
// The endpoint is public (the sign-in page has vitals too), so everything
// a client sends is checked against a closed set before it becomes a
// label: three vital names, the portal's own page patterns, a bounded
// value. Anything else is refused, so a client can't create new series. A
// per-replica rate limit caps what a script outside a browser can push;
// losing it on restart, or replicas disagreeing, only loosens the cap,
// which the stateless rule allows.

export const WEB_VITAL_NAMES = ["TTFB", "LCP", "INP"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

// Every page in src/app, as Next names its route. Kept by hand, since the
// browser only knows the path; a unit test fails when a page is missing.
export const PAGE_ROUTES = [
  "/",
  "/apps",
  "/auth/error",
  "/admin/apps",
  "/admin/apps/[id]",
  "/admin/audit",
  "/admin/integrations",
  "/admin/news",
  "/admin/news/new",
  "/admin/news/[id]",
  "/admin/requests",
  "/news",
] as const;

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

const MATCHERS = PAGE_ROUTES.map((route) => ({
  route,
  segments: route === "/" ? [] : route.slice(1).split("/"),
}));

// The page pattern a path belongs to, or null if it isn't one of ours.
export function routePattern(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = trimmed === "/" ? [] : trimmed.slice(1).split("/");
  if (segments.some((s) => s === "." || s === ".." || !SEGMENT.test(s))) return null;

  const match = MATCHERS.find(
    (m) =>
      m.segments.length === segments.length &&
      m.segments.every((pattern, i) => pattern.startsWith("[") || pattern === segments[i]),
  );
  return match?.route ?? null;
}

// Ten minutes in milliseconds: no real page load or interaction takes
// longer, so anything above is noise or abuse.
const MAX_VALUE_MS = 600_000;

export interface WebVitalSample {
  name: WebVitalName;
  seconds: number;
  route: string;
}

export function parseVitalsBeacon(body: unknown): WebVitalSample | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, value, path } = body as Record<string, unknown>;
  if (!WEB_VITAL_NAMES.includes(name as WebVitalName)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_VALUE_MS) return null;
  if (typeof path !== "string") return null;
  const route = routePattern(path);
  if (!route) return null;
  return { name: name as WebVitalName, seconds: value / 1000, route };
}

export interface RateLimiter {
  take(): boolean;
}

// A token bucket: `burst` at once, refilled at `perSecond`.
export function createRateLimiter(
  { perSecond, burst }: { perSecond: number; burst: number },
  now: () => number = Date.now,
): RateLimiter {
  let tokens = burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

// A beacon is ~60 bytes; this leaves room and nothing more.
const MAX_BODY_BYTES = 512;

export interface BeaconDeps {
  enabled: boolean;
  limiter: RateLimiter;
  record: (name: WebVitalName, route: string, seconds: number) => void;
}

// Reads at most `max` bytes, stopping as soon as a body goes over, so a
// chunked body with no (or a false) Content-Length can't be buffered whole.
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const status = (code: number) => new Response(null, { status: code, headers: { "Cache-Control": "no-store" } });

export async function handleVitalsBeacon(request: Request, deps: BeaconDeps): Promise<Response> {
  if (!deps.enabled) return status(404);

  // Browsers say where a request comes from; a page on another site can't
  // post here. Absent (an old browser, or not a browser), the checks below
  // still apply.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return status(403);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return status(413);
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return status(413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return status(400);
  }
  const sample = parseVitalsBeacon(body);
  if (!sample) return status(400);

  if (!deps.limiter.take()) return status(429);
  deps.record(sample.name, sample.route, sample.seconds);
  return status(204);
}

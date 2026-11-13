import { readWebVitalsEnabled } from "@/lib/config";
import { recordWebVital } from "@/lib/observability/metrics";
import { createRateLimiter, handleVitalsBeacon } from "@/lib/observability/web-vitals";

// Browser Web Vitals beacons (#16). A 404 unless Web Vitals are on, which
// needs METRICS_TOKEN (see readWebVitalsEnabled). Public, so every field is
// checked against a closed set and the rate is capped; see
// lib/observability/web-vitals.ts.
//
// Per replica: a burst of 120 beacons, refilled at 30 a second (each page
// load sends two or three). Lost on restart and not shared across
// replicas, which only loosens the cap.
const limiter = createRateLimiter({ perSecond: 30, burst: 120 });

export function POST(request: Request) {
  return handleVitalsBeacon(request, {
    enabled: readWebVitalsEnabled(),
    limiter,
    record: recordWebVital,
  });
}

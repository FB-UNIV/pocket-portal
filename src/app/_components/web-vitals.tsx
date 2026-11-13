"use client";

import { useReportWebVitals } from "next/web-vitals";

// Time to first byte, largest contentful paint and interaction delay: what
// server latency can't see (#16). Rendered by the root layout only while
// Web Vitals are on.
const RECORDED = new Set(["TTFB", "LCP", "INP"]);

type Report = Parameters<typeof useReportWebVitals>[0];

const report: Report = (metric) => {
  if (!RECORDED.has(metric.name)) return;
  // The page the vital was measured on: after a client-side navigation a
  // vital can arrive once the URL has already moved on. The path only, as
  // a query string can carry a search term.
  const measuredOn = (metric as { navigationURL?: string }).navigationURL ?? window.location.href;
  const path = new URL(measuredOn, window.location.href).pathname;
  const body = JSON.stringify({ name: metric.name, value: metric.value, path });
  // A beacon survives the page being closed, which is when INP is final.
  navigator.sendBeacon("/api/web-vitals", new Blob([body], { type: "application/json" }));
};

export function WebVitals() {
  useReportWebVitals(report);
  return null;
}

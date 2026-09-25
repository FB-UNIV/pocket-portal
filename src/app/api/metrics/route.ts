import { notFound } from "next/navigation";
import { register, metricsContentType } from "@/lib/observability/metrics";
import { isMetricsRequestAuthorized } from "@/lib/observability/metrics-auth";
import { readMetricsToken } from "@/lib/config";

// Closed by default: without the token this is a bare 404 and no
// telemetry. Not byte-identical to an unknown route (that one renders the
// HTML not-found page), so the path's existence isn't secret -- only what it
// serves. The token is read per request, like the rest of the app's config.
export async function GET(request: Request) {
  if (!isMetricsRequestAuthorized(request.headers.get("authorization"), readMetricsToken())) {
    notFound();
  }

  const body = await register.metrics();
  return new Response(body, {
    headers: { "Content-Type": metricsContentType, "Cache-Control": "no-store" },
  });
}

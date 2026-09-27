import { test, expect } from "@playwright/test";

// Closed by default: served only with the METRICS_TOKEN bearer; any
// other request gets a 404 and no telemetry.
const TOKEN = process.env.METRICS_TOKEN;

test("metrics endpoint is not served without a token", async ({ request }) => {
  const res = await request.get("/api/metrics");

  expect(res.status()).toBe(404);
  expect(await res.text()).not.toContain("http_requests_total");
});

test("metrics endpoint is not served with a wrong token", async ({ request }) => {
  const res = await request.get("/api/metrics", {
    headers: { Authorization: "Bearer not-the-metrics-token" },
  });

  expect(res.status()).toBe(404);
});

test("metrics endpoint exposes Prometheus text format to the configured token", async ({
  request,
}) => {
  expect(TOKEN, "METRICS_TOKEN must be set (load .env.test)").toBeTruthy();

  const res = await request.get("/api/metrics", {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");

  const body = await res.text();
  expect(body).toContain("http_requests_total");
  expect(body).toContain("http_request_duration_seconds");
});

// Against the built server: instrumentation (which records) and the metrics
// route (which serves) are bundled apart, so this catches a registry each
// side has its own copy of. A HELP line alone would pass the test above.
test("metrics count real requests, by route pattern", async ({ request }) => {
  await request.get("/api/health");
  await request.get("/e2e-made-up-path");

  // A request's span ends just after its response, so poll briefly.
  const scrape = async () =>
    (await request.get("/api/metrics", { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
  await expect
    .poll(scrape)
    .toMatch(/^http_requests_total\{method="GET",route="\/api\/health",status_code="200"\} [1-9]/m);

  const body = await scrape();
  expect(body).toMatch(/^http_request_duration_seconds_count\{method="GET",route="\/api\/health",status_code="200"\} [1-9]/m);
  expect(body).toContain('route="/_not-found"');
  expect(body).not.toContain("e2e-made-up-path");
});

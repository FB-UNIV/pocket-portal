import { describe, it, expect, vi } from "vitest";
import { isMetricsRequestAuthorized, logMetricsStatus } from "./metrics-auth";

const TOKEN = "s3cret-metrics-token";

describe("isMetricsRequestAuthorized", () => {
  it("accepts the configured token as a Bearer credential", () => {
    expect(isMetricsRequestAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("accepts the auth scheme case-insensitively, as RFC 9110 requires", () => {
    expect(isMetricsRequestAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  // Closed by default: an unset token means metrics are off, not open.
  it.each([undefined, ""])("refuses everything when the token is %j", (configured) => {
    expect(isMetricsRequestAuthorized(`Bearer ${TOKEN}`, configured)).toBe(false);
    expect(isMetricsRequestAuthorized("Bearer ", configured)).toBe(false);
    expect(isMetricsRequestAuthorized(null, configured)).toBe(false);
  });

  it.each([
    ["no header", null],
    ["a wrong token", "Bearer not-the-token"],
    ["a prefix of the token", `Bearer ${TOKEN.slice(0, -1)}`],
    ["the token plus extra", `Bearer ${TOKEN}x`],
    ["the bare token without a scheme", TOKEN],
    ["another scheme", `Basic ${TOKEN}`],
    ["an empty credential", "Bearer "],
  ])("refuses %s", (_label, header) => {
    expect(isMetricsRequestAuthorized(header, TOKEN)).toBe(false);
  });
});

describe("logMetricsStatus", () => {
  it("says metrics are served when a token is set", () => {
    const log = { info: vi.fn() };

    logMetricsStatus({ METRICS_TOKEN: TOKEN }, log as never);

    expect(log.info.mock.calls[0].at(-1)).toMatch(/enabled/);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(TOKEN);
  });

  // Otherwise a deployer whose Prometheus gets 404s has nothing to go on.
  it("says metrics are off, and how to turn them on, when no token is set", () => {
    const log = { info: vi.fn() };

    logMetricsStatus({}, log as never);

    expect(log.info.mock.calls[0].at(-1)).toMatch(/disabled.*METRICS_TOKEN/);
  });
});

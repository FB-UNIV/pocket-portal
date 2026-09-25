import { describe, it, expect, vi } from "vitest";
import { warnIfOriginNotPinned } from "./origin";

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

describe("warnIfOriginNotPinned", () => {
  // trustHost: true means Auth.js believes whatever Host header arrives.
  // Behind a correct proxy that is fine; without AUTH_URL in production it
  // is a callback-hijack vector, and nothing currently says so at runtime.
  it("warns in production when no explicit origin is pinned", () => {
    const log = fakeLogger();

    warnIfOriginNotPinned({ NODE_ENV: "production" }, log as never);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0].at(-1)).toMatch(/AUTH_URL/);
  });

  it("stays quiet in production once AUTH_URL is set", () => {
    const log = fakeLogger();

    warnIfOriginNotPinned(
      { NODE_ENV: "production", AUTH_URL: "https://portal.example.test" },
      log as never,
    );

    expect(log.warn).not.toHaveBeenCalled();
  });

  // Local dev without AUTH_URL is the normal, frictionless path — warning
  // there would just train people to ignore the warning.
  it("stays quiet outside production", () => {
    const log = fakeLogger();

    warnIfOriginNotPinned({ NODE_ENV: "development" }, log as never);

    expect(log.warn).not.toHaveBeenCalled();
  });
});

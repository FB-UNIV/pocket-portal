import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveServiceName } from "./otel";

const ORIGINAL_ENV = { ...process.env };

describe("resolveServiceName", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to pocket-portal when OTEL_SERVICE_NAME is unset", () => {
    delete process.env.OTEL_SERVICE_NAME;
    expect(resolveServiceName()).toBe("pocket-portal");
  });

  it("respects the OTEL_SERVICE_NAME environment variable", () => {
    process.env.OTEL_SERVICE_NAME = "pocket-portal-staging";
    expect(resolveServiceName()).toBe("pocket-portal-staging");
  });
});

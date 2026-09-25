import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPocketIdConfig } from "./client";

const ORIGINAL_ENV = { ...process.env };

describe("getPocketIdConfig", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reads base URL and API key from environment variables", () => {
    process.env.POCKETID_BASE_URL = "http://localhost:1411";
    process.env.POCKETID_API_KEY = "test-key";

    const config = getPocketIdConfig();

    expect(config).toEqual({
      baseUrl: "http://localhost:1411",
      apiKey: "test-key",
    });
  });

  it("strips a trailing slash from the base URL", () => {
    process.env.POCKETID_BASE_URL = "http://localhost:1411/";
    process.env.POCKETID_API_KEY = "test-key";

    expect(getPocketIdConfig().baseUrl).toBe("http://localhost:1411");
  });

  it("throws when POCKETID_BASE_URL is missing", () => {
    delete process.env.POCKETID_BASE_URL;
    process.env.POCKETID_API_KEY = "test-key";

    expect(() => getPocketIdConfig()).toThrow(/POCKETID_BASE_URL/);
  });

  it("throws when POCKETID_API_KEY is missing", () => {
    process.env.POCKETID_BASE_URL = "http://localhost:1411";
    delete process.env.POCKETID_API_KEY;

    expect(() => getPocketIdConfig()).toThrow(/POCKETID_API_KEY/);
  });
});

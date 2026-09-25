import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPocketIdOidcConfig } from "./config";

const ORIGINAL_ENV = { ...process.env };

describe("getPocketIdOidcConfig", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reads issuer, client id, and client secret from environment variables", () => {
    process.env.POCKETID_BASE_URL = "http://localhost:1411";
    process.env.POCKETID_OIDC_CLIENT_ID = "client-id";
    process.env.POCKETID_OIDC_CLIENT_SECRET = "client-secret";

    expect(getPocketIdOidcConfig()).toEqual({
      issuer: "http://localhost:1411",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });

  it("strips a trailing slash from the issuer", () => {
    process.env.POCKETID_BASE_URL = "http://localhost:1411/";
    process.env.POCKETID_OIDC_CLIENT_ID = "client-id";
    process.env.POCKETID_OIDC_CLIENT_SECRET = "client-secret";

    expect(getPocketIdOidcConfig().issuer).toBe("http://localhost:1411");
  });

  it("throws when POCKETID_BASE_URL is missing", () => {
    delete process.env.POCKETID_BASE_URL;
    process.env.POCKETID_OIDC_CLIENT_ID = "client-id";
    process.env.POCKETID_OIDC_CLIENT_SECRET = "client-secret";

    expect(() => getPocketIdOidcConfig()).toThrow(/POCKETID_BASE_URL/);
  });

  it("throws when POCKETID_OIDC_CLIENT_ID is missing", () => {
    process.env.POCKETID_BASE_URL = "http://localhost:1411";
    delete process.env.POCKETID_OIDC_CLIENT_ID;
    process.env.POCKETID_OIDC_CLIENT_SECRET = "client-secret";

    expect(() => getPocketIdOidcConfig()).toThrow(/POCKETID_OIDC_CLIENT_ID/);
  });

  it("throws when POCKETID_OIDC_CLIENT_SECRET is missing", () => {
    process.env.POCKETID_BASE_URL = "http://localhost:1411";
    process.env.POCKETID_OIDC_CLIENT_ID = "client-id";
    delete process.env.POCKETID_OIDC_CLIENT_SECRET;

    expect(() => getPocketIdOidcConfig()).toThrow(/POCKETID_OIDC_CLIENT_SECRET/);
  });
});

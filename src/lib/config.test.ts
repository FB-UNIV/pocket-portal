import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONFIG_VARS,
  configSource,
  nonDefaultFlags,
  readAccessRequestReason,
  readAccessRequestsEnabled,
  readAuditLogPageEnabled,
  readEmailNotificationsEnabled,
  readPocketIdBrandingEnabled,
  readPortalName,
  readSecretsWarningEnabled,
  readAuthUrl,
  readDatabaseUrl,
  readLogLevel,
  readMetricsToken,
  readOtelServiceName,
  readPocketIdApi,
  readPocketIdBaseUrl,
  readPocketIdOidc,
  validateConfig,
} from "./config";

const COMPLETE = {
  POCKETID_BASE_URL: "https://id.example.test/",
  POCKETID_API_KEY: "key",
  POCKETID_OIDC_CLIENT_ID: "client",
  POCKETID_OIDC_CLIENT_SECRET: "secret",
  DATABASE_URL: "postgres://db/portal",
  AUTH_SECRET: "auth-secret",
};

describe("config", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Read on every call, never cached: the stateless rule, and what lets
  // tests (and a later YAML source) change it.
  it("reads process.env live by default", () => {
    vi.stubEnv("POCKETID_BASE_URL", "https://one.example.test");
    expect(readPocketIdBaseUrl()).toBe("https://one.example.test");
    vi.stubEnv("POCKETID_BASE_URL", "https://two.example.test");
    expect(readPocketIdBaseUrl()).toBe("https://two.example.test");
    expect(configSource().POCKETID_BASE_URL).toBe("https://two.example.test");
  });

  it("reads the PocketID API and OIDC settings, trimming the base URL", () => {
    expect(readPocketIdApi(COMPLETE)).toEqual({ baseUrl: "https://id.example.test", apiKey: "key" });
    expect(readPocketIdOidc(COMPLETE)).toEqual({
      issuer: "https://id.example.test",
      clientId: "client",
      clientSecret: "secret",
    });
  });

  it.each([
    ["POCKETID_BASE_URL", () => readPocketIdApi({ ...COMPLETE, POCKETID_BASE_URL: "" })],
    ["POCKETID_API_KEY", () => readPocketIdApi({ ...COMPLETE, POCKETID_API_KEY: undefined })],
    ["POCKETID_OIDC_CLIENT_ID", () => readPocketIdOidc({ ...COMPLETE, POCKETID_OIDC_CLIENT_ID: "" })],
    ["POCKETID_OIDC_CLIENT_SECRET", () => readPocketIdOidc({ ...COMPLETE, POCKETID_OIDC_CLIENT_SECRET: "" })],
    ["DATABASE_URL", () => readDatabaseUrl({})],
  ])("names %s when a required setting is missing", (name, read) => {
    expect(read).toThrow(new RegExp(`${name} is not set`));
  });

  it("reads the optional settings, with their defaults", () => {
    expect(readAuthUrl({ AUTH_URL: "https://portal.example.test/" })).toBe("https://portal.example.test");
    expect(readAuthUrl({})).toBeUndefined();
    expect(readMetricsToken({ METRICS_TOKEN: "t" })).toBe("t");
    expect(readMetricsToken({ METRICS_TOKEN: "" })).toBeUndefined();
    expect(readOtelServiceName({})).toBe("pocket-portal");
    expect(readOtelServiceName({ OTEL_SERVICE_NAME: "portal" })).toBe("portal");
    expect(readPocketIdBaseUrl({})).toBeUndefined();
  });

  it("reads the portal's display name, trimmed, with blank meaning unset", () => {
    expect(readPortalName({ PORTAL_NAME: "  Acme Apps " })).toBe("Acme Apps");
    expect(readPortalName({ PORTAL_NAME: "   " })).toBeUndefined();
    expect(readPortalName({})).toBeUndefined();
  });

  // pino throws on an unknown level, which would take the logger, and with
  // it every module that imports it, down at import time.
  it("accepts pino's levels and refuses anything else", () => {
    expect(readLogLevel({})).toBe("info");
    expect(readLogLevel({ LOG_LEVEL: "debug" })).toBe("debug");
    expect(() => readLogLevel({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  describe("validateConfig", () => {
    it("finds nothing wrong with a complete config", () => {
      expect(validateConfig(COMPLETE)).toEqual([]);
    });

    // All at once, so a deployer fixes the file in one pass rather than one
    // restart per missing variable.
    it("reports every problem, not just the first", () => {
      const problems = validateConfig({
        POCKETID_BASE_URL: "https://id.example.test",
        LOG_LEVEL: "verbose",
        SMTP_HOST: "mail",
      });

      for (const name of [
        "POCKETID_API_KEY",
        "POCKETID_OIDC_CLIENT_ID",
        "POCKETID_OIDC_CLIENT_SECRET",
        "DATABASE_URL",
        "AUTH_SECRET",
        "LOG_LEVEL",
        "SMTP_FROM",
      ]) {
        expect(problems.join("\n")).toContain(name);
      }
    });
  });

  it("reports every SMTP problem, not just the first one readMailConfig hits", () => {
    const problems = validateConfig({
      ...COMPLETE,
      SMTP_HOST: "mail",
      SMTP_TLS: "ssl",
      SMTP_PORT: "nope",
      SMTP_USER: "u",
    });

    expect(problems).toHaveLength(4);
    for (const name of ["SMTP_FROM", "SMTP_TLS", "SMTP_PORT", "SMTP_PASSWORD"]) {
      expect(problems.join("\n")).toContain(name);
    }
  });

  // Feature flags. A typo in a flag must not 500 every page: readers fall back to the
  // default, and validateConfig says so at startup.
  describe("feature flags", () => {
    it.each([
      [undefined, true],
      ["true", true],
      ["on", true],
      ["1", true],
      ["false", false],
      ["OFF", false],
      ["0", false],
      ["maybe", true],
    ])("FEATURE_ACCESS_REQUESTS=%s reads as %s", (value, expected) => {
      expect(readAccessRequestsEnabled({ FEATURE_ACCESS_REQUESTS: value })).toBe(expected);
    });

    it.each([
      [undefined, "optional"],
      ["required", "required"],
      ["OFF", "off"],
      ["sometimes", "optional"],
    ])("ACCESS_REQUEST_REASON=%s reads as %s", (value, expected) => {
      expect(readAccessRequestReason({ ACCESS_REQUEST_REASON: value })).toBe(expected);
    });

    // The remaining flags: all on by default, so nothing changes until a
    // deployer opts out.
    it.each([
      ["FEATURE_EMAIL_NOTIFICATIONS", readEmailNotificationsEnabled],
      ["FEATURE_POCKETID_BRANDING", readPocketIdBrandingEnabled],
      ["FEATURE_AUDIT_LOG_PAGE", readAuditLogPageEnabled],
      ["WARN_POCKETID_SECRETS_READABLE", readSecretsWarningEnabled],
    ] as const)("%s defaults to on and can be switched off", (name, read) => {
      expect(read({})).toBe(true);
      expect(read({ [name]: "false" })).toBe(false);
      expect(validateConfig({ ...COMPLETE, [name]: "nah" })).toEqual([
        expect.stringContaining(name),
      ]);
    });

    // support questions start from the log, so say what's non-default.
    it("lists only the flags set away from their defaults", () => {
      expect(nonDefaultFlags({})).toEqual([]);
      expect(
        nonDefaultFlags({
          FEATURE_ACCESS_REQUESTS: "false",
          ACCESS_REQUEST_REASON: "required",
          FEATURE_AUDIT_LOG_PAGE: "true",
          FEATURE_POCKETID_BRANDING: "maybe",
        }),
      ).toEqual(["FEATURE_ACCESS_REQUESTS=false", "ACCESS_REQUEST_REASON=required"]);
    });

    it("reports a POCKETID_BASE_URL that isn't an absolute http(s) URL", () => {
      expect(validateConfig({ ...COMPLETE, POCKETID_BASE_URL: "id.example.test" })).toEqual([
        expect.stringMatching(/POCKETID_BASE_URL must be an absolute http\(s\) URL/),
      ]);
    });

    it("reports an unrecognised flag value at startup", () => {
      const problems = validateConfig({
        ...COMPLETE,
        FEATURE_ACCESS_REQUESTS: "maybe",
        ACCESS_REQUEST_REASON: "sometimes",
      });

      expect(problems).toHaveLength(2);
      expect(problems.join("\n")).toMatch(/FEATURE_ACCESS_REQUESTS[\s\S]*ACCESS_REQUEST_REASON/);
    });
  });

  // the repo publishes test secrets (.env.test, CI); a deployment that
  // copies one must hear about it.
  describe("published test secrets", () => {
    const envTest = Object.fromEntries(
      readFileSync(".env.test", "utf8")
        .split("\n")
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );

    it("reports .env.test's secrets when used in production", () => {
      const problems = validateConfig({
        ...COMPLETE,
        NODE_ENV: "production",
        AUTH_SECRET: envTest.AUTH_SECRET,
        POCKETID_API_KEY: envTest.POCKETID_API_KEY,
        METRICS_TOKEN: envTest.METRICS_TOKEN,
      });

      for (const name of ["AUTH_SECRET", "POCKETID_API_KEY", "METRICS_TOKEN"]) {
        expect(problems.join("\n")).toMatch(new RegExp(`${name} is a published test value`));
      }
    });

    // CI's compose smoke and Helm values use this placeholder.
    it("reports CI's ci-dummy placeholder for the API key and client secret", () => {
      const problems = validateConfig({
        ...COMPLETE,
        NODE_ENV: "production",
        POCKETID_API_KEY: "ci-dummy",
        POCKETID_OIDC_CLIENT_SECRET: "ci-dummy",
      });

      expect(problems.join("\n")).toMatch(/POCKETID_API_KEY is a published test value/);
      expect(problems.join("\n")).toMatch(/POCKETID_OIDC_CLIENT_SECRET is a published test value/);
    });

    // Production with an otherwise sound config, so only the case under test
    // is reported (COMPLETE's AUTH_SECRET is deliberately short).
    const PROD = { ...COMPLETE, NODE_ENV: "production", AUTH_SECRET: "x".repeat(44) };

    // Matched on the password, so a copied test password is caught whatever
    // host the URL points at.
    it.each([
      ["from .env.test", "postgres://portal:portal-test-fixture@localhost:5432/pocket_portal"],
      ["on another host", "postgres://portal:portal-test-fixture@db.internal:5432/app"],
      ["from CI's compose smoke", "postgres://portal:ci-smoke-not-a-real-password@postgres:5432/pocket_portal"],
      ["from the chart's CI values", "postgres://portal:cismokepassword@db:5432/pocket_portal"],
      // postgres.js accepts several hosts, which the WHATWG URL parser rejects.
      ["with several hosts", "postgres://portal:portal-test-fixture@db1:5432,db2:5432/pocket_portal"],
      ["percent-encoded", "postgresql://portal:portal%2Dtest%2Dfixture@db/q"],
    ])("reports a DATABASE_URL with a published password %s", (_where, url) => {
      expect(validateConfig({ ...PROD, DATABASE_URL: url })).toEqual([
        expect.stringMatching(/DATABASE_URL uses a published test password/),
      ]);
    });

    it("accepts a DATABASE_URL with its own password, or none", () => {
      for (const url of ["postgres://portal:s3cr3t-of-our-own@db:5432/q", "postgres://portal@db/q", "postgres://db/q", "postgres://portal:%E0%A4%A@db/q", "postgres://@db/q", "postgres://portal:@db/q", "not a url"]) {
        expect(validateConfig({ ...PROD, DATABASE_URL: url })).toEqual([]);
      }
    });

    it("reports a missing DATABASE_URL in production as unset, not as a crash", () => {
      expect(validateConfig({ ...PROD, DATABASE_URL: undefined })).toEqual([
        expect.stringMatching(/DATABASE_URL is not set/),
      ]);
    });

    it("reports CI's smoke-test AUTH_SECRET too", () => {
      expect(
        validateConfig({ ...COMPLETE, NODE_ENV: "production", AUTH_SECRET: "ci-smoke-secret-0000000000000000" }),
      ).toEqual([expect.stringMatching(/AUTH_SECRET is a published test value/)]);
    });

    it("says nothing outside production, where the fixtures belong", () => {
      expect(validateConfig({ ...COMPLETE, AUTH_SECRET: envTest.AUTH_SECRET })).toEqual([]);
    });

    it("reports an AUTH_SECRET too short to be random enough", () => {
      expect(
        validateConfig({ ...COMPLETE, NODE_ENV: "production", AUTH_SECRET: "short" }),
      ).toEqual([expect.stringMatching(/AUTH_SECRET is shorter than 32 characters/)]);
    });
  });

  // The registry the YAML loader and the generated docs build on.
  describe("CONFIG_VARS", () => {
    // The README table is the deployer's reference; a variable missing from
    // it might as well not exist.
    it("documents every variable in the README", async () => {
      const { readFileSync } = await import("node:fs");
      const readme = readFileSync("README.md", "utf8");
      for (const { name } of CONFIG_VARS) expect(readme, name).toContain(`\`${name}\``);
      expect(readme).toContain("`CONFIG_FILE`");
    });

    // A blank or prose line inside a GFM table ends it, and every row after
    // renders as literal pipes. That shipped twice before this test.
    it("keeps the README table unbroken between its markers", async () => {
      const { readFileSync } = await import("node:fs");
      const readme = readFileSync("README.md", "utf8");
      const start = readme.indexOf("<!-- AUTO-GENERATED");
      const end = readme.indexOf("<!-- /AUTO-GENERATED -->");
      const table = readme
        .slice(readme.indexOf("-->", start) + 3, end)
        .trim()
        .split("\n");

      expect(start).toBeGreaterThan(-1);
      for (const line of table) expect(line, "a line inside the table").toMatch(/^\|.*\|$/);
    });

    it("gives every non-secret a config-file key, and no secret one it can be set by", () => {
      for (const v of CONFIG_VARS) {
        if (v.secret) expect(v.yaml, v.name).toBeDefined(); // so a refusal can name it
        else expect(v.yaml, v.name).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      }
    });

    it("lists every variable exactly once", () => {
      const names = CONFIG_VARS.map((v) => v.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("marks the secrets, which a config file must never hold", () => {
      const secrets = CONFIG_VARS.filter((v) => v.secret).map((v) => v.name);
      expect(secrets.sort()).toEqual(
        ["AUTH_SECRET", "DATABASE_URL", "METRICS_TOKEN", "POCKETID_API_KEY", "POCKETID_OIDC_CLIENT_SECRET", "SMTP_PASSWORD"].sort(),
      );
    });

    // A variable read somewhere but missing here would silently escape
    // validation and the docs.
    it("covers every variable validateConfig can complain about", () => {
      const names = new Set(CONFIG_VARS.map((v) => v.name));
      for (const problem of validateConfig({})) {
        const mentioned = problem.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [];
        expect(mentioned.some((m) => names.has(m)), problem).toBe(true);
      }
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import { applyConfigFile, applyConfigFileAtBoot, parseConfigFile } from "./config-file";

const YAML = `
pocketid:
  baseUrl: https://id.example.test
  oidcClientId: 00000000-0000-4000-8000-000000000001
auth:
  url: https://portal.example.test
smtp:
  host: smtp.example.test
  port: 465
  tls: tls
features:
  accessRequests: false
  accessRequestReason: required
`;

describe("parseConfigFile", () => {
  it("maps nested keys onto their environment variables", () => {
    expect(parseConfigFile(YAML)).toEqual({
      values: {
        POCKETID_BASE_URL: "https://id.example.test",
        POCKETID_OIDC_CLIENT_ID: "00000000-0000-4000-8000-000000000001",
        AUTH_URL: "https://portal.example.test",
        SMTP_HOST: "smtp.example.test",
        SMTP_PORT: "465",
        SMTP_TLS: "tls",
        FEATURE_ACCESS_REQUESTS: "false",
        ACCESS_REQUEST_REASON: "required",
      },
      problems: [],
    });
  });

  // What the README points deployers at must itself be valid.
  it("parses the shipped example without a single problem", async () => {
    const { readFileSync } = await import("node:fs");

    const { values, problems } = parseConfigFile(readFileSync("pocket-portal.example.yaml", "utf8"));

    expect(problems).toEqual([]);
    expect(values.POCKETID_BASE_URL).toBe("https://id.example.test");
  });

  it("accepts an empty file", () => {
    expect(parseConfigFile("")).toEqual({ values: {}, problems: [] });
  });

  // A file gets copied, committed and pasted into tickets; secrets belong in
  // the environment or a *_FILE mount.
  it("refuses a secret, naming where it should go instead", () => {
    const { values, problems } = parseConfigFile("pocketid:\n  apiKey: hunter2\n");

    expect(values).toEqual({});
    expect(problems).toEqual([
      expect.stringMatching(/pocketid\.apiKey.*POCKETID_API_KEY.*POCKETID_API_KEY_FILE/),
    ]);
  });

  it("refuses unknown keys, so a typo doesn't silently do nothing", () => {
    expect(parseConfigFile("pocketid:\n  baseURL: https://x\n").problems).toEqual([
      expect.stringMatching(/Unknown key "pocketid\.baseURL"/),
    ]);
  });

  it.each([
    ["a list where a value belongs", "smtp:\n  host: [a, b]\n", /smtp\.host/],
    ["a scalar where a section belongs", "smtp: mail\n", /"smtp"/],
    ["something that isn't YAML", "pocketid: [unclosed\n", /not valid YAML/],
    ["a top-level list", "- a\n- b\n", /mapping/],
  ])("reports %s", (_why, text, message) => {
    expect(parseConfigFile(text).problems).toEqual([expect.stringMatching(message)]);
  });
});

describe("applyConfigFile", () => {
  const read = vi.fn(() => YAML);

  it("does nothing without CONFIG_FILE", () => {
    const env: Record<string, string | undefined> = {};

    expect(applyConfigFile(env, read)).toEqual([]);
    expect(env).toEqual({});
  });

  // Precedence: environment > file > default.
  it("fills in only what the environment doesn't already set", () => {
    const env: Record<string, string | undefined> = {
      CONFIG_FILE: "/etc/pocket-portal.yaml",
      AUTH_URL: "https://from-env.example.test",
    };

    expect(applyConfigFile(env, read)).toEqual([]);
    expect(read).toHaveBeenCalledWith("/etc/pocket-portal.yaml");
    expect(env.AUTH_URL).toBe("https://from-env.example.test");
    expect(env.POCKETID_BASE_URL).toBe("https://id.example.test");
    expect(env.FEATURE_ACCESS_REQUESTS).toBe("false");
  });

  it("reads a real file from disk by default", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const path = join(mkdtempSync(join(tmpdir(), "config-")), "config.yaml");
    writeFileSync(path, "log:\n  level: warn\n");
    const env: Record<string, string | undefined> = { CONFIG_FILE: path };

    expect(applyConfigFile(env)).toEqual([]);
    expect(env.LOG_LEVEL).toBe("warn");
  });

  // Compose maps an unset host variable to "" (`AUTH_URL: ${AUTH_URL:-}`);
  // treating that as "set" would make the file useless under compose.
  it("fills in variables the environment sets to an empty string", () => {
    const env: Record<string, string | undefined> = { CONFIG_FILE: "/etc/q.yaml", AUTH_URL: "" };

    applyConfigFile(env, read);

    expect(env.AUTH_URL).toBe("https://portal.example.test");
  });

  // Asked for explicitly, a file that can't be read is a broken deployment,
  // not something to boot past with half the settings missing.
  it("throws when the named file can't be read", () => {
    const env: Record<string, string | undefined> = { CONFIG_FILE: "/missing.yaml" };
    const missing = () => {
      throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    };

    expect(() => applyConfigFile(env, missing)).toThrow(
      /CONFIG_FILE "\/missing\.yaml" could not be read: ENOENT/,
    );
  });

  it("prefixes the file's own problems with its path", () => {
    const env: Record<string, string | undefined> = { CONFIG_FILE: "/etc/q.yaml" };

    expect(applyConfigFile(env, () => "nope: 1\n")).toEqual([
      expect.stringMatching(/^\/etc\/q\.yaml: Unknown key "nope"/),
    ]);
  });
});

describe("applyConfigFileAtBoot", () => {
  it("passes the file's problems through when it can be read", () => {
    const log = { fatal: vi.fn() };
    const exit = vi.fn() as unknown as (code: number) => never;

    const problems = applyConfigFileAtBoot(log, exit, { CONFIG_FILE: "/q.yaml" }, () => "nope: 1\n");

    expect(problems).toEqual([expect.stringMatching(/Unknown key "nope"/)]);
    expect(exit).not.toHaveBeenCalled();
  });

  // Not a throw: a throw from register() leaves Next serving 500s.
  it("logs fatal and exits 1 when the named file can't be read", () => {
    const log = { fatal: vi.fn() };
    const exit = vi.fn() as unknown as (code: number) => never;
    const missing = () => {
      throw new Error("ENOENT: no such file");
    };

    applyConfigFileAtBoot(log, exit, { CONFIG_FILE: "/missing.yaml" }, missing);

    expect(log.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringMatching(/CONFIG_FILE "\/missing\.yaml" could not be read/),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_VARS } from "./config";

// docker-entrypoint.sh's *_FILE support, run for real in sh with
// migrations off and a command that just prints the variable.
function run(env: Record<string, string>) {
  const out = execFileSync(
    "sh",
    ["docker-entrypoint.sh", "sh", "-c", 'printf "AUTH_SECRET=%s" "$AUTH_SECRET"'],
    {
      env: { PATH: process.env.PATH, NODE_ENV: "test", MIGRATE_ON_START: "false", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // The entrypoint logs its own lines first; the value follows the marker.
  return out.slice(out.indexOf("AUTH_SECRET=") + "AUTH_SECRET=".length);
}

describe("docker-entrypoint.sh secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "entrypoint-"));
  const secretFile = join(dir, "auth_secret");
  // A trailing newline, as `echo secret > file` leaves one.
  writeFileSync(secretFile, "from-a-file\n");

  it("reads VAR from VAR_FILE, without the trailing newline", () => {
    expect(run({ AUTH_SECRET_FILE: secretFile })).toBe("from-a-file");
  });

  it("leaves VAR alone when no VAR_FILE is given", () => {
    expect(run({ AUTH_SECRET: "plain" })).toBe("plain");
  });

  it.each([
    ["both are set", { AUTH_SECRET: "plain", AUTH_SECRET_FILE: secretFile }, /both AUTH_SECRET and AUTH_SECRET_FILE/],
    ["the file can't be read", { AUTH_SECRET_FILE: join(dir, "missing") }, /not readable/],
  ])("refuses to start when %s", (_why, env, message) => {
    expect(() => run(env)).toThrow(message);
  });

  it("covers every secret the config registry knows about", () => {
    const script = readFileSync("docker-entrypoint.sh", "utf8");
    const list = /for secret in ([A-Z_ ]+); do/.exec(script)?.[1].split(" ") ?? [];
    const secrets = CONFIG_VARS.filter((v) => v.secret).map((v) => v.name);

    expect(list.sort()).toEqual(secrets.sort());
  });
});

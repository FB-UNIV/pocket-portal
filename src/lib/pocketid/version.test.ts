import { describe, it, expect, vi } from "vitest";
import {
  MIN_POCKETID_VERSION,
  getPocketIdVersion,
  meetsMinimumVersion,
  warnIfPocketIdTooOld,
} from "./version";

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

// PocketID 2.15.0 (pocket-id#1671) is the first whose OIDC client list
// carries each client's allowedUserGroups; before, only a count.
describe("MIN_POCKETID_VERSION", () => {
  it("is 2.15.0", () => {
    expect(MIN_POCKETID_VERSION).toBe("2.15.0");
  });
});

describe("meetsMinimumVersion", () => {
  it.each([
    ["2.15.0", true],
    ["2.15.3", true],
    ["2.16.0", true],
    ["3.0.0", true],
    ["v2.16.0", true],
    ["2.14.9", false],
    ["2.13.0", false],
    ["1.99.0", false],
  ])("%s -> %s", (version, expected) => {
    expect(meetsMinimumVersion(version)).toBe(expected);
  });

  it.each(["", "latest", "2.x", "unknown"])("can't tell for %j", (version) => {
    expect(meetsMinimumVersion(version)).toBeNull();
  });
});

describe("getPocketIdVersion", () => {
  it("asks /api/version/current with the API key", async () => {
    const fetchImpl = jsonFetch({ currentVersion: "2.16.0" });

    expect(await getPocketIdVersion("https://id.example.test/", "k", fetchImpl)).toBe("2.16.0");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe("https://id.example.test/api/version/current");
    expect(init?.headers).toEqual({ "X-API-KEY": "k" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["PocketID answers non-2xx", jsonFetch({ currentVersion: "2.16.0" }, 401)],
    ["the field is missing", jsonFetch({ version: "2.16.0" })],
    ["the request fails", vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch],
  ])("is null when %s", async (_why, fetchImpl) => {
    expect(await getPocketIdVersion("https://id.example.test", "k", fetchImpl)).toBeNull();
  });
});

describe("warnIfPocketIdTooOld", () => {
  const env = { POCKETID_BASE_URL: "https://id.example.test", POCKETID_API_KEY: "k" };
  const logger = () => ({ error: vi.fn(), info: vi.fn() });

  it("logs an error naming both versions when PocketID is too old", async () => {
    const log = logger();

    await warnIfPocketIdTooOld(env, log as never, jsonFetch({ currentVersion: "2.13.0" }));

    expect(log.error).toHaveBeenCalledTimes(1);
    const message = log.error.mock.calls[0].at(-1);
    expect(message).toMatch(/2\.13\.0/);
    expect(message).toMatch(/2\.15\.0 or later/);
  });

  it("stays quiet when PocketID is recent enough", async () => {
    const log = logger();

    await warnIfPocketIdTooOld(env, log as never, jsonFetch({ currentVersion: "2.16.0" }));

    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it("says so, without failing, when the version can't be read", async () => {
    const log = logger();

    await warnIfPocketIdTooOld(env, log as never, jsonFetch({}, 503));

    expect(log.error).not.toHaveBeenCalled();
    expect(log.info.mock.calls[0].at(-1)).toMatch(/2\.15\.0/);
  });

  it("does nothing without a PocketID URL or API key", async () => {
    const log = logger();
    const fetchImpl = jsonFetch({ currentVersion: "2.13.0" });

    await warnIfPocketIdTooOld({ POCKETID_BASE_URL: "https://id.example.test" }, log as never, fetchImpl);
    await warnIfPocketIdTooOld({ POCKETID_API_KEY: "k" }, log as never, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

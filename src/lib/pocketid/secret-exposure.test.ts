import { describe, it, expect, vi } from "vitest";
import { getSecretExposure, warnIfPocketIdSecretsReadable } from "./secret-exposure";

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function publicConfig(uiConfigDisabled: string) {
  return [
    { key: "appName", type: "string", value: "Pocket ID" },
    { key: "uiConfigDisabled", type: "bool", value: uiConfigDisabled },
  ];
}

describe("getSecretExposure", () => {
  it("reads the public, unauthenticated config endpoint without an API key", async () => {
    const fetchImpl = jsonFetch(publicConfig("true"));

    await getSecretExposure("https://id.example.test/", fetchImpl);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe("https://id.example.test/api/application-configuration");
    expect(JSON.stringify(init ?? {})).not.toMatch(/X-API-KEY/i);
  });

  it("is 'masked' when PocketID runs with UI_CONFIG_DISABLED=true", async () => {
    expect(await getSecretExposure("https://id.example.test", jsonFetch(publicConfig("true")))).toBe(
      "masked",
    );
  });

  it("is 'readable' when UI_CONFIG_DISABLED is false", async () => {
    expect(
      await getSecretExposure("https://id.example.test", jsonFetch(publicConfig("false"))),
    ).toBe("readable");
  });

  it.each([
    ["the key is missing", jsonFetch([{ key: "appName", type: "string", value: "x" }])],
    ["the body is not an array", jsonFetch({ nope: true })],
    ["PocketID answers non-2xx", jsonFetch(publicConfig("false"), 503)],
    ["the request fails", vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch],
  ])("is 'unknown' when %s", async (_label, fetchImpl) => {
    expect(await getSecretExposure("https://id.example.test", fetchImpl)).toBe("unknown");
  });
});

describe("warnIfPocketIdSecretsReadable", () => {
  const env = { POCKETID_BASE_URL: "https://id.example.test" };
  const logger = () => ({ warn: vi.fn(), info: vi.fn() });

  it("warns, naming the fix, when secrets are readable", async () => {
    const log = logger();

    await warnIfPocketIdSecretsReadable(env, log as never, jsonFetch(publicConfig("false")));

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0].at(-1)).toMatch(/UI_CONFIG_DISABLED=true/);
  });

  it("stays quiet when secrets are masked", async () => {
    const log = logger();

    await warnIfPocketIdSecretsReadable(env, log as never, jsonFetch(publicConfig("true")));

    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  // PocketID being down isn't this problem, but the check shouldn't vanish silently.
  it("logs at info when the state can't be determined", async () => {
    const log = logger();

    await warnIfPocketIdSecretsReadable(env, log as never, jsonFetch({}, 500));

    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it("skips the check when POCKETID_BASE_URL is unset", async () => {
    const log = logger();
    const fetchImpl = jsonFetch(publicConfig("false"));

    await warnIfPocketIdSecretsReadable({}, log as never, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

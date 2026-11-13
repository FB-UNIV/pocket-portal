import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pocketIdFetch, statusClass } from "./fetch";
import { recordPocketIdCall } from "@/lib/observability/metrics";

vi.mock("@/lib/observability/metrics", () => ({ recordPocketIdCall: vi.fn() }));

const mockRecord = vi.mocked(recordPocketIdCall);

describe("pocketIdFetch", () => {
  beforeEach(() => mockRecord.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("makes the call and records it under its endpoint pattern, not the path", async () => {
    const response = new Response(null, { status: 200 });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);

    const init = { headers: { "X-API-KEY": "k" } };
    await expect(
      pocketIdFetch("GET /api/users/{id}", "https://id.example.test/api/users/abc-123", init),
    ).resolves.toBe(response);

    expect(fetch).toHaveBeenCalledWith("https://id.example.test/api/users/abc-123", init);
    expect(mockRecord).toHaveBeenCalledWith("GET /api/users/{id}", "2xx", expect.any(Number));
    expect(mockRecord.mock.calls[0][2]).toBeGreaterThanOrEqual(0);
  });

  it("records an error status by its class", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await pocketIdFetch("GET /api/oidc/clients", "https://id.example.test/api/oidc/clients");

    expect(mockRecord).toHaveBeenCalledWith("GET /api/oidc/clients", "5xx", expect.any(Number));
  });

  it("records a call that never got an answer, and rethrows", async () => {
    const err = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));

    await expect(pocketIdFetch("GET /healthz", "https://id.example.test/healthz")).rejects.toBe(err);

    expect(mockRecord).toHaveBeenCalledWith("GET /healthz", "error", expect.any(Number));
  });
});

describe("statusClass", () => {
  it.each([
    [200, "2xx"],
    [204, "2xx"],
    [302, "3xx"],
    [404, "4xx"],
    [429, "4xx"],
    [500, "5xx"],
  ])("%i is %s", (status, expected) => {
    expect(statusClass(status)).toBe(expected);
  });
});

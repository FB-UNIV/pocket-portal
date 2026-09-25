import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listAllPages,
  listPocketIdGroups,
  listPocketIdOidcClients,
  listPocketIdUsers,
  type PocketIdConfig,
} from "./client";

const config: PocketIdConfig = { baseUrl: "https://pocketid.example.test", apiKey: "k" };

function page<T>(data: T[], currentPage: number, totalPages: number) {
  return new Response(
    JSON.stringify({
      data,
      pagination: { totalPages, totalItems: 0, currentPage, itemsPerPage: 2 },
    }),
    { status: 200 },
  );
}

describe("listAllPages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a single page as-is", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(["a", "b"], 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAllPages(config, "/api/user-groups", "groups", 2)).resolves.toEqual([
      "a",
      "b",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows totalPages and concatenates every page in order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b"], 1, 3))
      .mockResolvedValueOnce(page(["c", "d"], 2, 3))
      .mockResolvedValueOnce(page(["e"], 3, 3));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAllPages(config, "/api/user-groups", "groups", 2)).resolves.toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);

    const urls = fetchMock.mock.calls.map(([url]) => new URL(url as string));
    expect(urls.map((u) => u.pathname)).toEqual([
      "/api/user-groups",
      "/api/user-groups",
      "/api/user-groups",
    ]);
    expect(urls.map((u) => u.searchParams.get("pagination[page]"))).toEqual(["1", "2", "3"]);
    expect(urls.every((u) => u.searchParams.get("pagination[limit]") === "2")).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { "X-API-KEY": "k" } });
  });

  it("returns an empty list when there is nothing to list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([], 1, 0)));

    await expect(listAllPages(config, "/api/users", "users")).resolves.toEqual([]);
  });

  it("throws when a later page fails, rather than returning a short list", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(page(["a", "b"], 1, 2))
        .mockResolvedValueOnce(new Response("", { status: 502, statusText: "Bad Gateway" })),
    );

    await expect(listAllPages(config, "/api/oidc/clients", "OIDC clients", 2)).rejects.toThrow(
      "PocketID list OIDC clients failed: 502 Bad Gateway",
    );
  });
});

// Each lister is one line, which makes its path the whole contract: callers
// mock these in unit tests, so nothing else would notice a wrong one.
describe("PocketID listers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const listers: Array<[string, (c: PocketIdConfig) => Promise<unknown[]>, string, string]> = [
    ["listPocketIdUsers", listPocketIdUsers, "/api/users", "users"],
    ["listPocketIdGroups", listPocketIdGroups, "/api/user-groups", "groups"],
    ["listPocketIdOidcClients", listPocketIdOidcClients, "/api/oidc/clients", "OIDC clients"],
  ];

  it.each(listers)("%s pages through %s with the API key", async (_name, list, path) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(["x"], 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(list(config)).resolves.toEqual(["x"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe(path);
    expect(init.headers).toEqual({ "X-API-KEY": "k" });
  });

  it.each(listers)("%s names what failed", async (_name, list, _path, what) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 502, statusText: "Bad Gateway" })),
    );

    await expect(list(config)).rejects.toThrow(`PocketID list ${what} failed: 502 Bad Gateway`);
  });
});

// PocketID before 2.15.0 lists clients with allowedUserGroupsCount instead
// of allowedUserGroups; reading that as a group list crashed /apps with a
// TypeError. Say what's wrong instead.
describe("listPocketIdOidcClients on PocketID before 2.15.0", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails with the minimum version, not a TypeError", async () => {
    const oldClient = { id: "c1", name: "App", isGroupRestricted: true, allowedUserGroupsCount: 1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([oldClient], 1, 1)));

    await expect(listPocketIdOidcClients(config)).rejects.toThrow(/PocketID 2\.15\.0 or later/);
  });
});

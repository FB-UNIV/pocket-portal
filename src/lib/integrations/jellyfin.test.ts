import { describe, it, expect, vi } from "vitest";
import { createJellyfin, isItemId } from "./jellyfin";

// #23: Jellyfin, read on the server with a server-wide API key. Endpoints
// per Jellyfin's OpenAPI spec: /System/Info/Public (no auth), /Items
// (Authorization header), /Items/{id}/Images/Primary (no auth).

const BASE = "https://tv.example.test";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function jellyfin(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(fetchImpl);
  return { fetch, client: createJellyfin({ baseUrl: `${BASE}/`, apiKey: "k3y", fetch, timeoutMs: 3000 }) };
}

describe("Jellyfin client", () => {
  it("reads the server's name and version without the key", async () => {
    const { fetch, client } = jellyfin(async () => json({ ServerName: "Home", Version: "10.10.7", Id: "abc" }));

    await expect(client.status()).resolves.toEqual({ name: "Home", version: "10.10.7", serverId: "abc" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/System/Info/Public`);
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it("asks for the newest movies and episodes, with the key in the Authorization header", async () => {
    const { fetch, client } = jellyfin(async () =>
      json({
        Items: [
          { Id: "1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c", Name: "Dune", Type: "Movie", ProductionYear: 2021, ServerId: "abc", ImageTags: { Primary: "t1" } },
          { Id: "2e7b3c9f1d5a4f8b0c4d3e2f1a0b9c8d", Name: "Pilot", Type: "Episode", SeriesName: "Severance", ServerId: "abc", ImageTags: {} },
        ],
        TotalRecordCount: 2,
      }),
    );

    const items = await client.recentlyAdded(8);

    const [url, init] = fetch.mock.calls[0];
    const asked = new URL(url);
    expect(asked.pathname).toBe("/Items");
    expect(asked.searchParams.getAll("sortBy")).toEqual(["DateCreated"]);
    expect(asked.searchParams.get("sortOrder")).toBe("Descending");
    expect(asked.searchParams.getAll("includeItemTypes")).toEqual(["Movie", "Episode"]);
    expect(asked.searchParams.get("recursive")).toBe("true");
    expect(asked.searchParams.get("limit")).toBe("8");
    expect(new Headers(init?.headers).get("authorization")).toBe('MediaBrowser Token="k3y"');
    expect(items).toEqual([
      { id: "1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c", title: "Dune", subtitle: "2021", hasPoster: true, serverId: "abc" },
      { id: "2e7b3c9f1d5a4f8b0c4d3e2f1a0b9c8d", title: "Pilot", subtitle: "Severance", hasPoster: false, serverId: "abc" },
    ]);
  });

  // The base URL is admin-set: never follow it somewhere else.
  it("refuses a redirect rather than following it", async () => {
    const { fetch, client } = jellyfin(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));

    await expect(client.status()).rejects.toThrow(/302/);
    expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("gives up after its timeout", async () => {
    const { fetch, client } = jellyfin(async () => json({}));

    await client.status();

    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fetches a poster, only as a picture", async () => {
    const { fetch, client } = jellyfin(async () => new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));

    await expect(client.poster("1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c")).resolves.toEqual({
      contentType: "image/jpeg",
      bytes: Uint8Array.from([1, 2, 3]),
    });
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe("/Items/1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c/Images/Primary");
  });

  it.each([
    ["an SVG", "image/svg+xml"],
    ["HTML", "text/html"],
  ])("refuses a poster that comes back as %s", async (_what, type) => {
    const { client } = jellyfin(async () => new Response("<svg/>", { headers: { "content-type": type } }));

    await expect(client.poster("1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c")).resolves.toBeNull();
  });

  it("never asks for an item id that isn't one", async () => {
    const { fetch, client } = jellyfin(async () => json({}));

    await expect(client.poster("../System/Configuration")).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("links an item to its page in Jellyfin's web client", () => {
    const { client } = jellyfin(async () => json({}));

    expect(client.itemUrl({ id: "1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c", serverId: "abc" })).toBe(
      `${BASE}/web/#/details?id=1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c&serverId=abc`,
    );
  });

  it("tests the connection: reachable, and the key accepted", async () => {
    const ok = jellyfin(async (url) => (url.includes("/Items") ? json({ Items: [] }) : json({ ServerName: "Home", Version: "10.10.7", Id: "abc" })));
    await expect(ok.client.testConnection()).resolves.toEqual({ ok: true, detail: "Home 10.10.7" });

    const badKey = jellyfin(async (url) => (url.includes("/Items") ? json({}, 401) : json({ ServerName: "Home", Version: "10.10.7", Id: "abc" })));
    await expect(badKey.client.testConnection()).resolves.toEqual({ ok: false, detail: "Jellyfin refused the key (401)" });
  });
});

describe("isItemId", () => {
  it.each(["1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c", "1d6a2b8e-0c4f-4e7a-9b3c-2d1e0f9a8b7c"])("accepts %s", (id) => {
    expect(isItemId(id)).toBe(true);
  });

  it.each(["", "../x", "1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7", "zzz6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c"])("refuses %j", (id) => {
    expect(isItemId(id)).toBe(false);
  });
});

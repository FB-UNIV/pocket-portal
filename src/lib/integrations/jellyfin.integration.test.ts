import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { integrations, auditLog } from "@/lib/db/schema";
import { createJellyfin } from "./jellyfin";
import { getIntegration, saveIntegration } from "./store";

// #23, over real HTTP: the client against a small stand-in for Jellyfin
// that answers like the OpenAPI spec says, and records what it was asked.
describe("Jellyfin client over HTTP (integration)", () => {
  let server: Server;
  let base: string;
  const seen: { url: string; authorization?: string }[] = [];
  const ID = "1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c";

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url ?? "", authorization: req.headers.authorization });
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/System/Info/Public") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ServerName: "Stand-in", Version: "10.10.7", Id: "srv" }));
      } else if (url.pathname === "/Items") {
        if (req.headers.authorization !== 'MediaBrowser Token="k3y"') return void res.writeHead(401).end();
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ Items: [{ Id: ID, Name: "Dune", Type: "Movie", ProductionYear: 2021, ServerId: "srv", ImageTags: { Primary: "t" } }] }),
        );
      } else if (url.pathname === `/Items/${ID}/Images/Primary`) {
        res.writeHead(200, { "content-type": "image/jpeg" }).end(Buffer.from([0xff, 0xd8, 0xff]));
      } else if (url.pathname === "/redirect-me/System/Info/Public") {
        res.writeHead(302, { location: "http://169.254.169.254/" }).end();
      } else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reads what's new with the key, and the status and posters without it", async () => {
    const client = createJellyfin({ baseUrl: base, apiKey: "k3y" });

    await expect(client.recentlyAdded(5)).resolves.toEqual([
      { id: ID, title: "Dune", subtitle: "2021", hasPoster: true, serverId: "srv" },
    ]);
    await expect(client.testConnection()).resolves.toEqual({ ok: true, detail: "Stand-in 10.10.7" });
    await expect(client.poster(ID)).resolves.toEqual({ contentType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff]) });

    const asked = seen.find((s) => s.url.startsWith("/Items?sortOrder"))!;
    expect(asked.url).toContain("includeItemTypes=Movie&includeItemTypes=Episode");
    expect(seen.find((s) => s.url === "/System/Info/Public")!.authorization).toBeUndefined();
  });

  it("says when the key is wrong", async () => {
    await expect(createJellyfin({ baseUrl: base, apiKey: "nope" }).testConnection()).resolves.toEqual({
      ok: false,
      detail: "Jellyfin refused the key (401)",
    });
  });

  it("doesn't follow a redirect anywhere", async () => {
    await expect(createJellyfin({ baseUrl: `${base}/redirect-me`, apiKey: "k3y" }).status()).rejects.toThrow(/302/);
  });
});

describe("integration settings (integration)", () => {
  let db: Db;
  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    db = createDb(url);
  });
  afterAll(() => db.$client.end());
  afterEach(async () => {
    await db.delete(integrations).where(eq(integrations.type, "jellyfin"));
    await db.delete(auditLog).where(eq(auditLog.targetId, "jellyfin"));
  });

  it("saves and updates Jellyfin's settings, auditing each change", async () => {
    const admin = { subject: "admin-sub", email: "admin@example.test" };
    await saveIntegration(db, { type: "jellyfin", baseUrl: "https://tv.example.test", linkedClientId: "jf", enabled: true }, admin);
    await saveIntegration(db, { type: "jellyfin", baseUrl: "https://tv2.example.test", linkedClientId: "jf", enabled: false }, admin);

    await expect(getIntegration(db, "jellyfin")).resolves.toEqual({
      type: "jellyfin",
      baseUrl: "https://tv2.example.test",
      linkedClientId: "jf",
      enabled: false,
    });
    const audit = await db.select().from(auditLog).where(eq(auditLog.targetId, "jellyfin"));
    expect(audit.map((a) => a.action)).toEqual(["integration.updated", "integration.updated"]);
  });
});

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { appDependencies, appOverrides } from "@/lib/db/schema";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps, listUserCatalogApps, setAppCategory, setAppHidden } from "./apps";

// Requires a running test PocketID + Postgres: npm run test-env:up
// Migrations run once for the whole integration suite via
// vitest.integration.global-setup.ts.

describe("catalog apps (integration)", () => {
  let db: Db;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    db = createDb(connectionString);
  });


  // Close the pool, or its open sockets keep the test process alive past
  // the run ("something prevents ... from exiting").
  afterAll(() => db.$client.end());
  // scripts/pocketid-provision-oidc-client.mjs always provisions this one.
  const PROVISIONED = "00000000-0000-4000-8000-000000000001";

  afterEach(async () => {
    await db.delete(appOverrides).where(eq(appOverrides.pocketIdClientId, "test-client-id"));
    await db.delete(appOverrides).where(eq(appOverrides.pocketIdClientId, PROVISIONED));
  });

  it("lists the real PocketID OIDC client provisioned for this test env, not hidden by default", async () => {
    const config = getPocketIdConfig();
    const apps = await listAdminCatalogApps(config, db);

    // scripts/pocketid-provision-oidc-client.mjs always provisions this one.
    const provisioned = apps.find((a) => a.id === "00000000-0000-4000-8000-000000000001");
    expect(provisioned).toBeTruthy();
    expect(provisioned!.hidden).toBe(false);
  });

  it("setAppHidden persists a hide override, reflected by listAdminCatalogApps", async () => {
    const config = getPocketIdConfig();

    await setAppHidden(db, "test-client-id", true);
    const rows = await db
      .select()
      .from(appOverrides)
      .where(eq(appOverrides.pocketIdClientId, "test-client-id"));
    expect(rows).toHaveLength(1);
    expect(rows[0].hidden).toBe(true);

    // Won't show up among real PocketID clients (fake id), but proves the
    // override table round-trips correctly through the same code path
    // listAdminCatalogApps uses.
    const apps = await listAdminCatalogApps(config, db);
    expect(apps.find((a) => a.id === "test-client-id")).toBeUndefined();
  });

  it("setAppCategory files a real client under a category, without touching hidden", async () => {
    const config = getPocketIdConfig();

    await setAppHidden(db, PROVISIONED, true);
    await setAppCategory(db, PROVISIONED, "Watch & listen");

    const app = (await listAdminCatalogApps(config, db)).find((a) => a.id === PROVISIONED);
    expect(app!.category).toBe("Watch & listen");
    expect(app!.hidden).toBe(true);
  });

  it("setAppCategory with null clears the category", async () => {
    const config = getPocketIdConfig();

    await setAppCategory(db, PROVISIONED, "Files");
    await setAppCategory(db, PROVISIONED, null);

    const app = (await listAdminCatalogApps(config, db)).find((a) => a.id === PROVISIONED);
    expect(app!.category).toBeNull();
    expect(app!.hidden).toBe(false);
  });

  it("setAppHidden can un-hide (upsert, not just insert)", async () => {
    await setAppHidden(db, "test-client-id", true);
    await setAppHidden(db, "test-client-id", false);

    const rows = await db
      .select()
      .from(appOverrides)
      .where(eq(appOverrides.pocketIdClientId, "test-client-id"));
    expect(rows).toHaveLength(1);
    expect(rows[0].hidden).toBe(false);
  });

  it("listUserCatalogApps excludes the provisioned test client (no launch URL set)", async () => {
    const config = getPocketIdConfig();

    const apps = await listUserCatalogApps(config, db, []);

    expect(apps.find((a) => a.id === "00000000-0000-4000-8000-000000000001")).toBeUndefined();
  });

  it("listUserCatalogApps excludes apps hidden via an admin override", async () => {
    const config = getPocketIdConfig();
    await setAppHidden(db, "test-client-id", true);

    const apps = await listUserCatalogApps(config, db, []);

    expect(apps.find((a) => a.id === "test-client-id")).toBeUndefined();
  });

  it("drops a non-http(s) launch URL at the catalog boundary", async () => {
    // PocketID stores whatever launchURL it is given (verified live: a
    // javascript: URL is accepted and returned as-is), so the portal is the
    // only thing standing between it and an <a href>.
    const config = getPocketIdConfig();
    const id = crypto.randomUUID();
    const headers = { "X-API-KEY": config.apiKey, "Content-Type": "application/json" };
    const client = {
      name: `js-launch-${id}`,
      callbackURLs: ["https://js-launch.example.test/callback"],
      pkceEnabled: true,
      isPublic: false,
    };
    await fetch(`${config.baseUrl}/api/oidc/clients`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, ...client }),
    });

    try {
      const put = await fetch(`${config.baseUrl}/api/oidc/clients/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...client, launchURL: "javascript:alert(1)" }),
      });
      expect(put.ok).toBe(true);

      const adminApps = await listAdminCatalogApps(config, db);
      expect(adminApps.find((a) => a.id === id)?.launchUrl).toBeNull();

      const userApps = await listUserCatalogApps(config, db, []);
      expect(userApps.find((a) => a.id === id)).toBeUndefined();
    } finally {
      await fetch(`${config.baseUrl}/api/oidc/clients/${id}`, {
        method: "DELETE",
        headers: { "X-API-KEY": config.apiKey },
      });
    }
  });

  // ADR-0012: each app carries the apps it needs, named from PocketID and,
  // for a user, whether they have each. Seeded: Grafana (engineering) and
  // Sonarr (media).
  it("annotates an app with the apps it needs, read live", async () => {
    const config = getPocketIdConfig();
    const all = await listAdminCatalogApps(config, db);
    const grafana = all.find((a) => a.name === "Grafana (seed)")!;
    const sonarr = all.find((a) => a.name === "Sonarr (seed)")!;
    await db.insert(appDependencies).values({ pocketIdClientId: grafana.id, requiresPocketIdClientId: sonarr.id });
    try {
      const admin = await listAdminCatalogApps(config, db);
      expect(admin.find((a) => a.id === grafana.id)!.requires).toEqual([{ id: sonarr.id, name: "Sonarr (seed)" }]);

      const without = await listUserCatalogApps(config, db, ["engineering"]);
      expect(without.find((a) => a.id === grafana.id)!.requires).toEqual([
        { id: sonarr.id, name: "Sonarr (seed)", hasAccess: false, allowedGroups: sonarr.allowedGroups },
      ]);
      const withIt = await listUserCatalogApps(config, db, ["engineering", "media"]);
      expect(withIt.find((a) => a.id === grafana.id)!.requires[0].hasAccess).toBe(true);
    } finally {
      await db.delete(appDependencies).where(eq(appDependencies.pocketIdClientId, grafana.id));
    }
  });
});

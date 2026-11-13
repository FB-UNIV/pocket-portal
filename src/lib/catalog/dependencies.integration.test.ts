import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { appDependencies, auditLog } from "@/lib/db/schema";
import { addDependency, listDependencies, removeDependency } from "./dependencies";

// Requires a running test Postgres instance: npm run test-env:up.

describe("app dependencies (integration)", () => {
  let db: Db;
  let other: Db;
  // Client ids unique to this run, so leftovers can't collide.
  const ids: string[] = [];
  const client = (name: string) => {
    const id = `${name}-${randomUUID()}`;
    ids.push(id);
    return id;
  };
  const ADMIN = { subject: "admin-sub", email: "admin@example.test" };

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    db = createDb(url);
    other = createDb(url);
  });

  afterAll(async () => {
    await db.$client.end();
    await other.$client.end();
  });

  afterEach(async () => {
    if (!ids.length) return;
    await db
      .delete(appDependencies)
      .where(or(inArray(appDependencies.pocketIdClientId, ids), inArray(appDependencies.requiresPocketIdClientId, ids)));
    await db.delete(auditLog).where(inArray(auditLog.targetId, ids));
    ids.length = 0;
  });

  it("adds a link, audits it, and lists it", async () => {
    const grafana = client("grafana");
    const vpn = client("vpn");

    await expect(addDependency(db, grafana, vpn, ADMIN)).resolves.toEqual({ ok: true });

    const mine = (await listDependencies(db)).filter((l) => l.clientId === grafana);
    expect(mine).toEqual([{ clientId: grafana, requiresId: vpn }]);
    const audit = await db.select().from(auditLog).where(eq(auditLog.targetId, grafana));
    expect(audit).toEqual([
      expect.objectContaining({
        actorSubject: "admin-sub",
        action: "app_dependency.added",
        targetType: "app",
        metadata: { requiresPocketIdClientId: vpn },
      }),
    ]);
  });

  it("adding a link twice changes nothing and audits nothing more", async () => {
    const grafana = client("grafana");
    const vpn = client("vpn");

    await addDependency(db, grafana, vpn, ADMIN);
    await expect(addDependency(db, grafana, vpn, ADMIN)).resolves.toEqual({ ok: true });

    expect((await listDependencies(db)).filter((l) => l.clientId === grafana)).toHaveLength(1);
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, grafana))).toHaveLength(1);
  });

  it("refuses a chain, and writes nothing", async () => {
    const grafana = client("grafana");
    const vpn = client("vpn");
    const dashboards = client("dashboards");
    await addDependency(db, grafana, vpn, ADMIN);

    await expect(addDependency(db, dashboards, grafana, ADMIN)).resolves.toEqual({
      ok: false,
      reason: "prerequisite_needs_another",
    });
    expect((await listDependencies(db)).filter((l) => l.clientId === dashboards)).toEqual([]);
  });

  // Two admins at the same moment: each link is fine alone, together they'd
  // make a chain. The check and insert lock the table, so one waits for the
  // other and then sees its link.
  it("never lets two concurrent adds build a chain", async () => {
    const a = client("a");
    const b = client("b");
    const c = client("c");

    const results = await Promise.all([
      addDependency(db, a, b, ADMIN),
      addDependency(other, b, c, ADMIN),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const links = (await listDependencies(db)).filter((l) => [a, b].includes(l.clientId));
    expect(links).toHaveLength(1);
  });

  it("removes a link and audits it", async () => {
    const grafana = client("grafana");
    const vpn = client("vpn");
    await addDependency(db, grafana, vpn, ADMIN);

    await removeDependency(db, grafana, vpn, ADMIN);

    expect((await listDependencies(db)).filter((l) => l.clientId === grafana)).toEqual([]);
    const removed = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, grafana), eq(auditLog.action, "app_dependency.removed")));
    expect(removed).toHaveLength(1);
  });

  it("removing a link that isn't there audits nothing", async () => {
    const grafana = client("grafana");

    await removeDependency(db, grafana, client("vpn"), ADMIN);

    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, grafana))).toEqual([]);
  });
});

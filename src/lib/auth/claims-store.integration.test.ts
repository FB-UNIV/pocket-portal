import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { sessionClaims } from "@/lib/db/schema";
import { createClaimsStore } from "./claims-store";

// Requires a running test Postgres instance: npm run test-env:up
// Migrations run once for the whole integration suite via
// vitest.integration.global-setup.ts.

const SUBJECT = "claims-store-test-sub";
const INTERVAL = 5 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 24, 12, 0, 0);

describe("session claims store (integration)", () => {
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
  afterEach(async () => {
    await db.delete(sessionClaims).where(eq(sessionClaims.subject, SUBJECT));
  });

  it("grants the first refresh slot, then refuses until the interval has passed", async () => {
    const store = createClaimsStore(() => db);

    await expect(store.claimRefreshSlot(SUBJECT, T0, INTERVAL)).resolves.toBe(true);
    await expect(store.claimRefreshSlot(SUBJECT, T0 + INTERVAL - 1, INTERVAL)).resolves.toBe(false);
    await expect(store.claimRefreshSlot(SUBJECT, T0 + INTERVAL, INTERVAL)).resolves.toBe(true);
  });

  // The whole point of doing this in Postgres: replicas racing for the same
  // user must not all call PocketID.
  it("grants exactly one of many concurrent claims", async () => {
    const store = createClaimsStore(() => db);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.claimRefreshSlot(SUBJECT, T0, INTERVAL)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reads back nothing for a subject it has never seen", async () => {
    await expect(createClaimsStore(() => db).read(SUBJECT)).resolves.toBeNull();
  });

  it("holds no verified claims for a slot that was only claimed", async () => {
    const store = createClaimsStore(() => db);
    await store.claimRefreshSlot(SUBJECT, T0, INTERVAL);

    await expect(store.read(SUBJECT)).resolves.toEqual({ groups: [], isAdmin: false, verifiedAt: null });
  });

  it("stores verified claims and counts them as an attempt", async () => {
    const store = createClaimsStore(() => db);

    await store.saveVerified(SUBJECT, { groups: ["media", "engineering"], isAdmin: true }, T0);

    await expect(store.read(SUBJECT)).resolves.toEqual({
      groups: ["media", "engineering"],
      isAdmin: true,
      verifiedAt: T0,
    });
    await expect(store.claimRefreshSlot(SUBJECT, T0 + 1, INTERVAL)).resolves.toBe(false);
  });

  it("overwrites older verified claims", async () => {
    const store = createClaimsStore(() => db);
    await store.saveVerified(SUBJECT, { groups: ["media"], isAdmin: true }, T0);

    await store.saveVerified(SUBJECT, { groups: [], isAdmin: false }, T0 + INTERVAL);

    await expect(store.read(SUBJECT)).resolves.toEqual({
      groups: [],
      isAdmin: false,
      verifiedAt: T0 + INTERVAL,
    });
  });

  // From review: a refresh captures `now` before its PocketID call, so a
  // sign-in can record newer claims while that call is still in flight.
  it("never lets an older verification overwrite a newer one", async () => {
    const store = createClaimsStore(() => db);
    await store.saveVerified(SUBJECT, { groups: [], isAdmin: false }, T0 + INTERVAL);

    await store.saveVerified(SUBJECT, { groups: ["media"], isAdmin: true }, T0);

    await expect(store.read(SUBJECT)).resolves.toEqual({
      groups: [],
      isAdmin: false,
      verifiedAt: T0 + INTERVAL,
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { userOnboarding } from "@/lib/db/schema";
import { completeTour, dismissChecklist, getOnboarding, setItemTicked } from "./store";

// Requires a running test Postgres instance: npm run test-env:up.
// Keyed by PocketID subject in Postgres, so it follows the person across
// devices and replicas (#21), never browser storage.
describe("onboarding store (integration)", () => {
  let db: Db;
  const subject = `onboarding-${randomUUID()}`;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    db = createDb(url);
  });
  afterAll(() => db.$client.end());
  afterEach(() => db.delete(userOnboarding).where(eq(userOnboarding.subject, subject)));

  it("starts empty for someone who's never been here", async () => {
    await expect(getOnboarding(db, subject)).resolves.toEqual({
      checklistDismissedAt: null,
      tickedItems: [],
      tourCompletedAt: null,
      tourVersion: null,
    });
  });

  it("ticks and unticks items, once each", async () => {
    await setItemTicked(db, subject, "backup-passkey", true);
    await setItemTicked(db, subject, "backup-passkey", true);
    expect((await getOnboarding(db, subject)).tickedItems).toEqual(["backup-passkey"]);

    await setItemTicked(db, subject, "backup-passkey", false);
    expect((await getOnboarding(db, subject)).tickedItems).toEqual([]);
  });

  it("remembers the checklist was dismissed, keeping what was ticked", async () => {
    await setItemTicked(db, subject, "backup-passkey", true);
    await dismissChecklist(db, subject);

    const state = await getOnboarding(db, subject);
    expect(state.checklistDismissedAt).toBeInstanceOf(Date);
    expect(state.tickedItems).toEqual(["backup-passkey"]);
  });

  it("remembers which version of the tour they took", async () => {
    await completeTour(db, subject, 1);

    const state = await getOnboarding(db, subject);
    expect(state.tourVersion).toBe(1);
    expect(state.tourCompletedAt).toBeInstanceOf(Date);
  });
});

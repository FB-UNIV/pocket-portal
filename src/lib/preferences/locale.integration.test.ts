import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { userPreferences } from "@/lib/db/schema";
import { getSavedLocale, saveLocale } from "./locale";

// Requires a running test Postgres: npm run test-env:up
// Migrations run once for the whole integration suite via
// vitest.integration.global-setup.ts.

const SUBJECT = "integration-test-locale-subject";

describe("saved language (integration)", () => {
  let db: Db;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    db = createDb(connectionString);
  });

  afterEach(async () => {
    await db.delete(userPreferences).where(eq(userPreferences.subject, SUBJECT));
  });

  // Close the pool, or its open sockets keep the test process alive.
  afterAll(() => db.$client.end());

  it("is null for someone who never picked a language", async () => {
    expect(await getSavedLocale(db, SUBJECT)).toBeNull();
  });

  it("saves a language, and replaces it on the next pick", async () => {
    await saveLocale(db, SUBJECT, "fr");
    expect(await getSavedLocale(db, SUBJECT)).toBe("fr");

    await saveLocale(db, SUBJECT, "en");
    expect(await getSavedLocale(db, SUBJECT)).toBe("en");

    const rows = await db.select().from(userPreferences).where(eq(userPreferences.subject, SUBJECT));
    expect(rows).toHaveLength(1);
  });
});

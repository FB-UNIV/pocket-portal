import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./src/lib/db/client";

// Migrates once for the whole integration run, not per file: files migrating
// in parallel race Postgres's `CREATE SCHEMA IF NOT EXISTS "drizzle"` (seen
// live as a duplicate-key violation on pg_namespace_nspname_index).
export default async function setup() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const db = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    // An open pool here outlives every test file and holds the run open.
    await db.$client.end();
  }
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { readDatabaseUrl } from "@/lib/config";

export type Db = ReturnType<typeof createDb>;

// A drizzle handle that can run queries — either the pooled Db or the
// transaction handle passed to db.transaction()'s callback. Lets a helper run
// standalone or as part of a larger transaction (e.g. flipping a request's
// status and writing its audit event atomically).
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
// Takes an explicit connection string (not process.env.DATABASE_URL read
// internally) so callers/tests control exactly which database they hit —
// same pattern as getPocketIdConfig().
export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}
/* v8 ignore stop */

let cachedDb: Db | undefined;

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
// Caches one connection pool per process (like src/lib/observability/logger.ts's
// module-level `logger`) — a resource/pooling optimization, not the kind of
// session/business state the stateless-tier rule is about. Tests use
// createDb directly instead, to control exactly which database they hit.
export function getDb(): Db {
  if (!cachedDb) {
    cachedDb = createDb(readDatabaseUrl());
  }
  return cachedDb;
}
/* v8 ignore stop */

#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Applies pending Drizzle migrations, then exits.
//
// It uses drizzle-orm's migrator (a production dependency), not drizzle-kit,
// because the runtime image deliberately has no npm or devDependencies.
// Both use the same bookkeeping (schema "drizzle", table
// "__drizzle_migrations"), so nothing is re-applied.
//
// Run by the container entrypoint (MIGRATE_ON_START, or `migrate` mode, as
// the Helm chart's init container does) and by `npm run db:migrate`.

// A stable, arbitrary 64-bit-safe key. Every replica must contend for the
// *same* advisory lock, so this is a constant rather than anything derived
// from the environment.
export const ADVISORY_LOCK_KEY = 4_027_180_915;

const LOCK_TIMEOUT_MS = 60_000;
const LOCK_POLL_MS = 500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// pg_try_advisory_lock in a polling loop rather than the blocking
// pg_advisory_lock: `lock_timeout` does not reliably bound the blocking
// form, and an unbounded wait turns "another replica is migrating" into a
// deploy that hangs with no explanation instead of one that fails.
export async function acquireAdvisoryLock({
  query,
  lockKey,
  timeoutMs = LOCK_TIMEOUT_MS,
  pollMs = LOCK_POLL_MS,
  sleep = delay,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;

  for (;;) {
    const rows = await query("select pg_try_advisory_lock($1) as locked", [lockKey]);
    if (rows[0]?.locked) return;

    if (now() >= deadline) {
      throw new Error(
        `could not acquire the migration lock within ${timeoutMs}ms — another instance may be ` +
          "migrating, or a previous migration is stuck holding it",
      );
    }
    await sleep(pollMs);
  }
}

// Comparing import.meta.url to `file://${argv[1]}` by string breaks on any
// path containing spaces (and on Windows), and the failure is silent: the
// script exits 0 having migrated nothing. Normalise both sides instead.
export function isMainModule(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return fileURLToPath(metaUrl) === resolve(argv1);
  } catch {
    return false;
  }
}

export async function runMigrations({
  query,
  migrate,
  lockKey = ADVISORY_LOCK_KEY,
  timeoutMs = LOCK_TIMEOUT_MS,
  sleep = delay,
  now = Date.now,
  log = console,
}) {
  await acquireAdvisoryLock({ query, lockKey, timeoutMs, sleep, now });
  log.info?.("migration lock acquired");

  try {
    await migrate();
    log.info?.("migrations up to date");
  } finally {
    // Always released, so a failed migration does not block every
    // subsequent replica until the connection is reaped.
    await query("select pg_advisory_unlock($1)", [lockKey]);
  }
}

// Resolved relative to this file, which works from a checkout and from the
// image (the Dockerfile mirrors the repo layout); MIGRATIONS_FOLDER
// overrides it. fileURLToPath, not URL.pathname, which keeps
// percent-encoding and breaks paths with spaces.
/* v8 ignore start -- process wiring, exercised by the compose CI job rather than unit mocks */
// Lazy: evaluating this at module load would break importing the file under
// a test runner, where import.meta.url is not a file: URL.
function resolveMigrationsFolder() {
  return (
    process.env.MIGRATIONS_FOLDER ??
    resolve(fileURLToPath(new URL(".", import.meta.url)), "../drizzle")
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");

  // max: 1 — an advisory lock is session-scoped, so the lock, the migrations
  // and the unlock must all run on the same connection.
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    await runMigrations({
      query: (text, params) => sql.unsafe(text, params),
      migrate: () => migrate(drizzle(sql), { migrationsFolder: resolveMigrationsFolder() }),
    });
  } catch (error) {
    console.error(`migration failed: ${error instanceof Error ? error.message : error}`);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  await sql.end({ timeout: 5 });
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
/* v8 ignore stop */

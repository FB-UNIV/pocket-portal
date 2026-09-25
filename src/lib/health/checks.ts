import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import type { PocketIdConfig } from "@/lib/pocketid/client";

export interface CheckResult {
  ok: boolean;
  error?: string;
}

const DB_TIMEOUT_MS = 2_000;

// How long PocketID gets to answer discovery before readiness gives up. A
// readiness probe that hangs is worse than one that fails: the orchestrator
// waits on it instead of routing traffic away from this instance.
const POCKETID_TIMEOUT_MS = 2_000;

// Both checks report deliberately terse errors, never the underlying one:
// /api/ready is unauthenticated so probes can reach it, and driver and DNS
// errors routinely carry hosts, ports and sometimes credentials.
//
// The database probe is bounded in two places, because one is not enough:
//  - `set local statement_timeout` makes *Postgres* kill the query. A bare
//    race would answer on time but leave the query running, so a merely
//    slow database would accumulate probe queries for as long as the
//    orchestrator keeps scraping.
//  - the outer deadline covers what statement_timeout cannot: the server
//    never seeing the statement at all. postgres.js 3.4.9 can leave an
//    initial query pending indefinitely after a clean socket close, and
//    `connect_timeout` does not bound that case — without this, /api/ready
//    would hang rather than answer 503.
export async function checkDatabase(
  db: Db,
  timeoutMs: number = DB_TIMEOUT_MS,
): Promise<CheckResult> {
  const ms = Math.max(1, Math.trunc(timeoutMs));

  // Maps both outcomes to a value, so this promise never rejects and can be
  // raced without leaving an unhandled rejection behind when it loses.
  const probe: Promise<CheckResult> = db
    .transaction(async (tx) => {
      // SET takes no bind parameters; `ms` is an integer we produced here,
      // never caller-supplied text.
      await tx.execute(sql.raw(`set local statement_timeout = ${ms}`));
      await tx.execute(sql`select 1`);
    })
    .then(
      () => ({ ok: true }),
      () => ({ ok: false, error: "database query failed" }),
    );

  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: `database check timed out after ${ms}ms` }),
      ms,
    );
  });

  return Promise.race([probe, deadline]).finally(() => clearTimeout(timer));
}

export async function checkPocketId(
  config: PocketIdConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = POCKETID_TIMEOUT_MS,
): Promise<CheckResult> {
  // Discovery rather than an authenticated endpoint: it proves the issuer is
  // reachable and serving, without spending an admin API call on every probe.
  const url = `${config.baseUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    return res.ok ? { ok: true } : { ok: false, error: `discovery returned ${res.status}` };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: `discovery timed out after ${timeoutMs}ms` };
    }
    return { ok: false, error: "discovery request failed" };
  } finally {
    clearTimeout(timer);
  }
}

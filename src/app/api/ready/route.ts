import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { checkDatabase, checkPocketId, type CheckResult } from "@/lib/health/checks";

const FAILED_CONFIG: CheckResult = { ok: false, error: "not configured" };

// Readiness. Answers "can this instance actually serve a request", which
// means Postgres and PocketID both have to be reachable.
//
// Both dependencies are probed even when the first already failed, so a
// single call tells an operator everything that is wrong rather than only
// the first thing to break.
export async function GET() {
  const [database, pocketid] = await Promise.all([
    (async () => {
      try {
        return await checkDatabase(getDb());
      } catch {
        // getDb()/getPocketIdConfig() throw on missing env. A probe must
        // answer 503, not hand back a 500 with a stack trace.
        return FAILED_CONFIG;
      }
    })(),
    (async () => {
      try {
        return await checkPocketId(getPocketIdConfig());
      } catch {
        return FAILED_CONFIG;
      }
    })(),
  ]);

  const ready = database.ok && pocketid.ok;

  return Response.json(
    { status: ready ? "ready" : "not ready", checks: { database, pocketid } },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { sessionClaims } from "@/lib/db/schema";
import type { ClaimsStore } from "./claims-refresh";

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
// Postgres-backed ClaimsStore. Times come from the app's clock, like
// the token's own timestamps, so a row and a cookie compare on one scale.
//
// Takes a getter rather than a Db: the jwt callback runs on every request,
// and resolving the pool lazily turns a missing DATABASE_URL into a rejected
// call the refresh path already treats as "store unavailable", not a thrown
// error that would 500 every page.
export function createClaimsStore(getDb: () => Db): ClaimsStore {
  return {
    // One statement, so racing replicas can't both win: the loser's insert
    // conflicts, waits on the winner's row lock, then fails the WHERE against
    // the freshly stamped attempted_at and returns no row.
    async claimRefreshSlot(subject, now, intervalMs) {
      const claimed = await getDb()
        .insert(sessionClaims)
        .values({ subject, attemptedAt: new Date(now) })
        .onConflictDoUpdate({
          target: sessionClaims.subject,
          set: { attemptedAt: new Date(now) },
          // An ISO string, not a Date: a raw Date inside a sql`` template
          // reaches postgres-js unconverted and the query fails.
          setWhere: sql`${sessionClaims.attemptedAt} <= ${new Date(now - intervalMs).toISOString()}::timestamptz`,
        })
        .returning({ subject: sessionClaims.subject });
      return claimed.length === 1;
    },

    async read(subject) {
      const [row] = await getDb().select().from(sessionClaims).where(eq(sessionClaims.subject, subject));
      if (!row) return null;
      return {
        groups: row.groups,
        isAdmin: row.isAdmin,
        verifiedAt: row.verifiedAt ? row.verifiedAt.getTime() : null,
      };
    },

    async saveVerified(subject, claims, now) {
      const at = new Date(now);
      await getDb()
        .insert(sessionClaims)
        .values({ subject, ...claims, verifiedAt: at, attemptedAt: at })
        .onConflictDoUpdate({
          target: sessionClaims.subject,
          set: { ...claims, verifiedAt: at, attemptedAt: at },
          // A refresh stamps `now` before its PocketID call, so a sign-in can
          // record newer claims while that call is in flight. Only a newer
          // verification may replace the row; an older one is dropped.
          setWhere: sql`${sessionClaims.verifiedAt} is null or ${sessionClaims.verifiedAt} <= ${at.toISOString()}::timestamptz`,
        });
    },
  };
}
/* v8 ignore stop */

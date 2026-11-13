import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { userOnboarding } from "@/lib/db/schema";

// A person's onboarding state (#21), by PocketID subject, in Postgres.

export interface Onboarding {
  checklistDismissedAt: Date | null;
  tickedItems: string[];
  tourCompletedAt: Date | null;
  tourVersion: number | null;
}

const NOTHING_YET: Onboarding = { checklistDismissedAt: null, tickedItems: [], tourCompletedAt: null, tourVersion: null };

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
export async function getOnboarding(db: Db, subject: string): Promise<Onboarding> {
  const [row] = await db.select().from(userOnboarding).where(eq(userOnboarding.subject, subject));
  if (!row) return { ...NOTHING_YET };
  return {
    checklistDismissedAt: row.checklistDismissedAt,
    tickedItems: row.tickedItems,
    tourCompletedAt: row.tourCompletedAt,
    tourVersion: row.tourVersion,
  };
}

// Adds or removes one ticked item, in one statement so two tabs ticking at
// once can't lose either.
export async function setItemTicked(db: Db, subject: string, item: string, ticked: boolean): Promise<void> {
  const next = ticked
    ? sql`(select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements_text(${userOnboarding.tickedItems} || to_jsonb(${item}::text)) v)`
    : sql`(select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_array_elements_text(${userOnboarding.tickedItems}) v where v <> ${item})`;
  await db
    .insert(userOnboarding)
    .values({ subject, tickedItems: ticked ? [item] : [] })
    .onConflictDoUpdate({ target: userOnboarding.subject, set: { tickedItems: next, updatedAt: sql`now()` } });
}

export async function dismissChecklist(db: Db, subject: string): Promise<void> {
  await db
    .insert(userOnboarding)
    .values({ subject, checklistDismissedAt: sql`now()` })
    .onConflictDoUpdate({
      target: userOnboarding.subject,
      set: { checklistDismissedAt: sql`now()`, updatedAt: sql`now()` },
    });
}
/* v8 ignore stop */

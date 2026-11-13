import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* v8 ignore start -- declarative table def, exercised by the integration suite */
// See docs/adr/0006-audit-trail-separate-from-logs.md: this is a permanent,
// queryable system of record for security/access-relevant events — not
// derived from application logs or traces.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorSubject: text("actor_subject").notNull(),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The admin audit page reads newest first, keyset-paged on
    // (created_at, id); without these every page is a full sort of a table
    // that only grows. Deliberately ascending: a backward scan yields
    // DESC NULLS FIRST, which is what `ORDER BY ... DESC` means. A DESC
    // index is stored NULLS LAST, and Postgres won't treat that as a match
    // even on NOT NULL columns, so it would sort anyway.
    index("audit_log_created_at_id_idx").on(table.createdAt, table.id),
    // The same order within one action, for the page's filter.
    index("audit_log_action_created_at_id_idx").on(table.action, table.createdAt, table.id),
  ],
);
/* v8 ignore stop */

/* v8 ignore start -- declarative table def, exercised by the integration suite */
// See docs/adr/0007-pocketid-live-catalog.md: the catalog itself is read
// live from PocketID's OIDC clients (GET /api/oidc/clients), not stored
// here. This table holds only explicit hide/show exceptions an admin
// sets in the portal — most clients will never have a row.
export const appOverrides = pgTable("app_overrides", {
  pocketIdClientId: text("pocket_id_client_id").primaryKey(),
  hidden: boolean("hidden").notNull().default(false),
  // Portal-only grouping for /apps ("Watch & listen"), which PocketID has no
  // field for. Null means uncategorised. See ADR-0007's 2026-11-06 amendment.
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/* v8 ignore stop */

/* v8 ignore start -- declarative table def, exercised by the integration suite */
// ADR-0002. `pocketIdGroupName` is a snapshot, so a request still reads
// right after the group is renamed. `status` is text rather than a DB enum,
// so new states need no migration. `message` is the requester's optional
// reason, shown to the admin deciding.
export const accessRequests = pgTable(
  "access_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterSubject: text("requester_subject").notNull(),
    requesterEmail: text("requester_email"),
    pocketIdClientId: text("pocket_id_client_id").notNull(),
    pocketIdGroupId: text("pocket_id_group_id").notNull(),
    pocketIdGroupName: text("pocket_id_group_name").notNull(),
    message: text("message"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Set when `status` leaves "pending". Nullable, not defaulted: a
    // pending row has not been decided, and rows predating this column have
    // no honest value to backfill.
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // Filed together with another request (#19, ADR-0012): a prerequisite
    // (the VPN) asked for with the app that needs it (Grafana), which is
    // this column's target. Null for a request filed on its own.
    parentRequestId: uuid("parent_request_id").references((): AnyPgColumn => accessRequests.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    // One active (pending or approved) request per requester+client+group;
    // denied rows are excluded, so a denial can be re-requested. The
    // application's own check can't do this atomically: a request
    // racing an approval could pass it before the approval commits. Covering
    // "approved" too, not just "pending", is what closes that window.
    uniqueIndex("access_requests_pending_unique")
      .on(table.requesterSubject, table.pocketIdClientId, table.pocketIdGroupId)
      .where(sql`${table.status} != 'denied'`),
  ],
);
/* v8 ignore stop */

/* v8 ignore start -- declarative table def, exercised by the integration suite */
// The server-side half of each session's group/admin claims. Sessions
// are signed cookies (ADR-0004), so anything stamped only into the cookie is
// whatever the client chooses to replay. One row per user holds:
// - `attemptedAt`: the last refresh attempt, the throttle every replica and
//   every copy of the cookie shares, so PocketID is asked at most once per
//   interval per user.
// - the last claims PocketID actually verified, and when (`verifiedAt`,
//   null until a refresh or sign-in succeeds). A cookie that skips the
//   refresh because another request just did it gets these claims, not its
//   own, so replaying an old cookie can't bring back a revoked admin.
// Bounded at one row per user who has ever signed in; no cleanup needed.
export const sessionClaims = pgTable("session_claims", {
  subject: text("subject").primaryKey(),
  groups: jsonb("groups").$type<string[]>().notNull().default([]),
  isAdmin: boolean("is_admin").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
});
/* v8 ignore stop */

/* v8 ignore start -- declarative table def, exercised by the integration suite */
// An app that needs another app to be usable (ADR-0012): Grafana needs the
// VPN. Both sides are PocketID OIDC client ids; which group grants the
// prerequisite is read live from PocketID, never stored. One level deep:
// lib/catalog/dependencies.ts checks it under a table lock.
export const appDependencies = pgTable(
  "app_dependencies",
  {
    pocketIdClientId: text("pocket_id_client_id").notNull(),
    requiresPocketIdClientId: text("requires_pocket_id_client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.pocketIdClientId, table.requiresPocketIdClientId] })],
);
/* v8 ignore stop */

/* v8 ignore start -- declarative table def, exercised by the integration suite */
// Choices a person makes about the portal itself, keyed by PocketID subject
// so they follow them across devices and replicas (#64). `locale` is null
// until they pick a language; until then the browser's own preference is
// used. One row per person who has ever set something.
export const userPreferences = pgTable("user_preferences", {
  subject: text("subject").primaryKey(),
  locale: text("locale"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/* v8 ignore stop */

/* v8 ignore start -- declarative table def, exercised by the integration suite */
// Emails waiting to be sent, sent, or given up on (ADR-0011). One row per
// recipient, rendered in their language when queued, so a retry sends
// exactly what would have been sent. Claimed with FOR UPDATE SKIP LOCKED
// and a lease (`locked_until`), so replicas never send the same row at
// once and a replica that dies mid-send gives its rows back. Holds
// addresses and request messages, so sent rows are pruned after 7 days and
// failed ones after 30.
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // "new_request" | "decision"
    kind: text("kind").notNull(),
    // The access request it's about. No foreign key: the outbox outlives
    // nothing, and a row must never block deleting a request.
    requestId: uuid("request_id").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    // For the audit event if it's given up on ("…about engineering").
    pocketIdGroupName: text("pocket_id_group_name"),
    // "pending" | "sent" | "failed"
    status: text("status").notNull().default("pending"),
    // Claims so far, each one an attempt.
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // What the sender loop asks for every 30 s on every replica: pending
    // rows that are due. Partial, so sent and failed rows cost nothing.
    index("notification_outbox_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);
/* v8 ignore stop */

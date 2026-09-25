import type { JWT } from "next-auth/jwt";
import { applyRefreshedGroupsToToken, shouldRefreshGroups } from "./callbacks";

// How often an existing session re-derives groups/isAdmin from PocketID
// instead of trusting the copy stamped into the JWT at login: an
// admin's grant or revoke then takes effect within one refresh cycle
// rather than requiring the user to sign out and back in.
export const GROUPS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// How long admin rights may ride on claims PocketID has not re-confirmed
//: three missed refreshes. Past this, e.g. through a PocketID or
// Postgres outage, the session keeps its groups (users can still launch
// their apps) but loses admin until a refresh succeeds, so a revoked admin
// can't outlast their revocation by waiting out an outage.
export const ADMIN_MAX_UNVERIFIED_MS = 3 * GROUPS_REFRESH_INTERVAL_MS;

export interface Claims {
  groups: string[];
  isAdmin: boolean;
}

export interface StoredClaims extends Claims {
  // Epoch ms of the last successful verification; null for a row that only
  // records a claimed refresh slot so far.
  verifiedAt: number | null;
}

// The server-side state a refresh is throttled by and served from (see
// session_claims in src/lib/db/schema.ts). Epoch ms throughout, like the
// token's own timestamps.
export interface ClaimsStore {
  // Atomically records an attempt for `subject` at `now`, but only when no
  // attempt was recorded within `intervalMs`. True means the caller won the
  // slot and should ask PocketID; false means another request already did.
  claimRefreshSlot(subject: string, now: number, intervalMs: number): Promise<boolean>;
  read(subject: string): Promise<StoredClaims | null>;
  // Records claims PocketID just confirmed. Also counts as an attempt.
  saveVerified(subject: string, claims: Claims, now: number): Promise<void>;
}

interface WarnLogger {
  warn: (obj: object, msg: string) => void;
}

export interface RefreshDeps {
  store: ClaimsStore;
  fetchClaims: (subject: string) => Promise<Claims>;
  log: WarnLogger;
  now: number;
}

// Cookies issued before groupsVerifiedAt existed only carry
// groupsRefreshedAt, which is the closest honest stand-in.
function verifiedAt(token: JWT): number {
  return token.groupsVerifiedAt ?? token.groupsRefreshedAt ?? 0;
}

// Records an attempt that verified nothing. groupsVerifiedAt is written
// explicitly, because a legacy cookie's fallback is groupsRefreshedAt, which
// this moves to `now`; left unpinned, the admin ceiling would chase `now`
// through every failed cycle and never trip.
function markAttemptOnly(token: JWT, now: number): JWT {
  return { ...token, groupsRefreshedAt: now, groupsVerifiedAt: verifiedAt(token) };
}

function applyAdminCeiling(token: JWT, now: number): JWT {
  if (token.isAdmin && now - verifiedAt(token) > ADMIN_MAX_UNVERIFIED_MS) {
    return { ...token, isAdmin: false };
  }
  return token;
}

// The jwt callback's refresh path for an existing session. Only a
// token that looks stale touches Postgres, so a normal browser costs about
// one small read per interval. The throttle itself lives in Postgres, not
// in the cookie, so a client replaying an old cookie can't make every
// request hit PocketID's admin API.
export async function refreshSessionClaims(token: JWT, deps: RefreshDeps): Promise<JWT> {
  const { store, fetchClaims, log, now } = deps;

  if (!token.sub || !shouldRefreshGroups(token, now, GROUPS_REFRESH_INTERVAL_MS)) {
    return applyAdminCeiling(token, now);
  }

  let wonSlot: boolean;
  try {
    wonSlot = await store.claimRefreshSlot(token.sub, now, GROUPS_REFRESH_INTERVAL_MS);
  } catch (error) {
    // No shared throttle to trust, so no PocketID call either: better stale
    // claims (bounded by the admin ceiling) than an unthrottled path.
    log.warn({ error }, "Session claims store unavailable; keeping the session's claims");
    return applyAdminCeiling(markAttemptOnly(token, now), now);
  }

  if (!wonSlot) {
    // Another request refreshed recently. Take what it verified, unless this
    // token's own claims are newer, e.g. from a sign-in whose write failed.
    let stored: StoredClaims | null = null;
    try {
      stored = await store.read(token.sub);
    } catch (error) {
      log.warn({ error }, "Could not read stored session claims; keeping the session's claims");
    }

    const next =
      stored?.verifiedAt != null && stored.verifiedAt >= verifiedAt(token)
        ? {
            ...token,
            groups: stored.groups,
            isAdmin: stored.isAdmin,
            groupsVerifiedAt: stored.verifiedAt,
            groupsRefreshedAt: now,
          }
        : markAttemptOnly(token, now);
    return applyAdminCeiling(next, now);
  }

  let claims: Claims;
  try {
    claims = await fetchClaims(token.sub);
  } catch (error) {
    // Fails open on the previous claims, bounded by the admin ceiling; the
    // attempt is already recorded, so the retry waits a full interval.
    log.warn({ error }, "Failed to refresh PocketID groups for session");
    return applyAdminCeiling(markAttemptOnly(token, now), now);
  }

  try {
    await store.saveVerified(token.sub, claims, now);
  } catch (error) {
    log.warn({ error }, "Could not record refreshed session claims");
  }

  return applyRefreshedGroupsToToken(token, claims.groups, claims.isAdmin, now);
}

// Sign-in claims are verified by definition, and recording them makes them
// supersede whatever older sessions of the same user still carry. Never
// fails the sign-in: a missing row only means the next refresh asks PocketID.
export async function recordSignInClaims(
  store: ClaimsStore,
  subject: string,
  claims: Claims,
  now: number,
  log: WarnLogger,
): Promise<void> {
  try {
    await store.saveVerified(subject, claims, now);
  } catch (error) {
    log.warn({ error }, "Could not record sign-in session claims");
  }
}

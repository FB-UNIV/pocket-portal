import type { AccessRequest } from "./access-requests";

// How long an approval is given to reach the user's session groups before
// it reads as "revoked" rather than "settling".
//
// Three refresh intervals (GROUPS_REFRESH_INTERVAL_MS, claims-refresh.ts):
// a session that refreshed just before the approval waits nearly a full
// interval for the next, and the rest absorbs clock skew. Erring long only
// shows a revoked grant as "settling" for a few extra minutes; erring short
// tells users their access was removed while it's still arriving.
export const GRANT_SETTLE_MS = 15 * 60 * 1000;

export type RequestState =
  // Awaiting an admin decision.
  | "pending"
  // Approved, but not in the session's groups yet — the grant is real and
  // this session just has not caught up.
  | "settling"
  // Approved long enough ago that the session should have caught up, and it
  // still has not: the group was taken away in PocketID.
  | "revoked"
  // An admin said no. Re-requestable: the requester may have a better case.
  | "denied";

export interface RequestOutcome {
  // The row this outcome describes. Carried so a caller acting on it — a
  // "revoked" re-request reopening the stale row — does not have to
  // search for it again, and cannot fail to find what this already matched.
  requestId: string;
  state: RequestState;
  // Whether offering the request form would lead anywhere. The server action
  // enforces this independently — a server action is a callable endpoint, not
  // just whatever the rendered form submits.
  canRequest: boolean;
}

// What to tell the user about *this* client+group pairing, given every request
// they have ever filed and the groups their session currently carries.
//
// Returns null when there is nothing to say: either they never asked, or the
// access landed and the caller already renders a launch link instead.
//
// `userGroups` is the session's copy, which is exactly the point — the whole
// "settling" state exists because that copy lags PocketID by up to one refresh
// interval.
export function deriveRequestOutcome(
  requests: readonly AccessRequest[],
  pocketIdClientId: string,
  pocketIdGroupId: string,
  userGroups: readonly string[],
  now: number = Date.now(),
): RequestOutcome | null {
  const latest = requests
    .filter(
      (request) =>
        request.pocketIdClientId === pocketIdClientId &&
        request.pocketIdGroupId === pocketIdGroupId,
    )
    // A denial can be followed by a fresh request for the same tuple, so the
    // newest row is the one that describes where the user stands today.
    .reduce<AccessRequest | null>(
      (newest, request) =>
        newest === null || request.createdAt > newest.createdAt ? request : newest,
      null,
    );

  if (!latest) return null;

  const id = latest.id;

  if (latest.status === "pending") return { requestId: id, state: "pending", canRequest: false };
  if (latest.status === "denied") return { requestId: id, state: "denied", canRequest: true };

  if (latest.status === "approved") {
    // The grant arrived: nothing to report, the caller renders a launch link.
    if (userGroups.includes(latest.pocketIdGroupName)) return null;

    // No decision time means the row predates migration 0007. It is certainly
    // not from the last few minutes, so read it as settled rather than fresh —
    // that way a user whose access is gone can ask again instead of waiting
    // on a "takes effect shortly" that never resolves.
    const decidedAt = latest.decidedAt?.getTime();
    const settled = decidedAt === undefined || now - decidedAt >= GRANT_SETTLE_MS;

    return settled
      ? { requestId: id, state: "revoked", canRequest: true }
      : { requestId: id, state: "settling", canRequest: false };
  }

  return null;
}

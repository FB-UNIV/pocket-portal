import { describe, it, expect } from "vitest";
import { deriveRequestOutcome, GRANT_SETTLE_MS } from "./request-outcome";
import type { AccessRequest } from "./access-requests";

// Builds a row for one requester+client+group. Only the fields the outcome
// derivation actually reads are meaningful here.
function request(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    id: "req-1",
    requesterSubject: "user-1",
    requesterEmail: null,
    pocketIdClientId: "client-1",
    pocketIdGroupId: "group-1",
    pocketIdGroupName: "engineering",
    message: null,
    status: "pending",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    decidedAt: null,
    ...overrides,
  };
}

const NOW = new Date("2026-01-01T12:00:00Z").getTime();
const justNow = new Date(NOW - 1_000);
const longAgo = new Date(NOW - GRANT_SETTLE_MS - 1_000);

describe("deriveRequestOutcome", () => {
  it("is null when the user never asked for this group", () => {
    expect(deriveRequestOutcome([], "client-1", "group-1", [], NOW)).toBeNull();
  });

  it("ignores requests for a different client or group", () => {
    const rows = [
      request({ pocketIdClientId: "other-client" }),
      request({ pocketIdGroupId: "other-group" }),
    ];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toBeNull();
  });

  it("reports a pending request", () => {
    const rows = [request({ status: "pending" })];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toEqual({
      requestId: expect.any(String),
      state: "pending",
      canRequest: false,
    });
  });

  it("reports a denial, and lets the user ask again", () => {
    const rows = [request({ status: "denied", decidedAt: justNow })];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toEqual({
      requestId: expect.any(String),
      state: "denied",
      canRequest: true,
    });
  });

  // The window this whole feature exists for: the grant landed in PocketID but
  // the session's groups are still the copy stamped at login.
  it("reports a fresh approval as still settling, with no way to re-request", () => {
    const rows = [request({ status: "approved", decidedAt: justNow })];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toEqual({
      requestId: expect.any(String),
      state: "settling",
      canRequest: false,
    });
  });

  it("reports nothing once an approval has actually landed in the user's groups", () => {
    const rows = [request({ status: "approved", decidedAt: justNow })];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", ["engineering"], NOW)).toBeNull();
  });

  // the grant was real, then taken away. Without this the card would
  // claim "takes effect shortly" forever for access that is gone.
  it("reports a long-settled approval the user no longer holds as revoked, and re-requestable", () => {
    const rows = [request({ status: "approved", decidedAt: longAgo })];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toEqual({
      requestId: expect.any(String),
      state: "revoked",
      canRequest: true,
    });
  });

  // Rows predating the decidedAt column (migration 0007) have no decision
  // time. Treating them as settled is the safe read: they are certainly not
  // from the last few minutes.
  it("treats an approved row with no decision time as settled, not fresh", () => {
    const rows = [request({ status: "approved", decidedAt: null })];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toEqual({
      requestId: expect.any(String),
      state: "revoked",
      canRequest: true,
    });
  });

  // A denial is re-requestable, so a user can hold a denied row and a newer
  // pending one for the same tuple at once.
  it("uses the newest row when an earlier denial was followed by a new request", () => {
    const rows = [
      request({ id: "old", status: "denied", createdAt: new Date(NOW - 60_000) }),
      request({ id: "new", status: "pending", createdAt: new Date(NOW - 30_000) }),
    ];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toEqual({
      requestId: expect.any(String),
      state: "pending",
      canRequest: false,
    });
  });

  // `status` is a free-form text column, not a DB enum (see the schema
  // comment), so a value this function does not know about is reachable —
  // say a future state added by a later migration. Say nothing rather than
  // guess, and let the form decide on its own.
  it("says nothing about a status it does not recognise", () => {
    const rows = [request({ status: "superseded" })];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toBeNull();
  });

  it("is not fooled by row order", () => {
    const rows = [
      request({ id: "new", status: "pending", createdAt: new Date(NOW - 30_000) }),
      request({ id: "old", status: "denied", createdAt: new Date(NOW - 60_000) }),
    ];

    expect(deriveRequestOutcome(rows, "client-1", "group-1", [], NOW)).toEqual({
      requestId: expect.any(String),
      state: "pending",
      canRequest: false,
    });
  });
});

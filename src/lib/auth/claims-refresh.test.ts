import { describe, it, expect, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
import {
  ADMIN_MAX_UNVERIFIED_MS,
  GROUPS_REFRESH_INTERVAL_MS,
  recordSignInClaims,
  refreshSessionClaims,
  type ClaimsStore,
  type StoredClaims,
} from "./claims-refresh";

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;

// In-memory stand-in with the same slot rule as the Postgres store: a
// refresh slot is granted only when no attempt was made within the interval.
function fakeStore(initial?: StoredClaims & { attemptedAt: number }) {
  let row = initial ? { ...initial } : undefined;
  const store: ClaimsStore = {
    claimRefreshSlot: vi.fn(async (_subject: string, now: number, intervalMs: number) => {
      if (row && now - row.attemptedAt < intervalMs) return false;
      row = row
        ? { ...row, attemptedAt: now }
        : { groups: [], isAdmin: false, verifiedAt: null, attemptedAt: now };
      return true;
    }),
    read: vi.fn(async () =>
      row ? { groups: row.groups, isAdmin: row.isAdmin, verifiedAt: row.verifiedAt } : null,
    ),
    saveVerified: vi.fn(
      async (_subject: string, claims: { groups: string[]; isAdmin: boolean }, now: number) => {
        row = { ...claims, verifiedAt: now, attemptedAt: now };
      },
    ),
  };
  return store;
}

function staleToken(overrides: Partial<JWT> = {}): JWT {
  return {
    sub: "user-1",
    groups: ["media"],
    isAdmin: true,
    groupsRefreshedAt: NOW - GROUPS_REFRESH_INTERVAL_MS,
    groupsVerifiedAt: NOW - GROUPS_REFRESH_INTERVAL_MS,
    ...overrides,
  };
}

function deps(
  store: ClaimsStore,
  fetchClaims = vi.fn(async () => ({ groups: ["media", "engineering"], isAdmin: false })),
) {
  return { store, fetchClaims, log: { warn: vi.fn() }, now: NOW };
}

const failingFetch = () =>
  vi.fn(async (): Promise<{ groups: string[]; isAdmin: boolean }> => {
    throw new Error("PocketID unreachable");
  });

describe("refreshSessionClaims", () => {
  it("leaves a token with no subject alone", async () => {
    const store = fakeStore();

    const token = await refreshSessionClaims({ groups: [] }, deps(store));

    expect(token).toEqual({ groups: [] });
    expect(store.claimRefreshSlot).not.toHaveBeenCalled();
  });

  it("does not touch Postgres or PocketID while the token is fresh", async () => {
    const store = fakeStore();
    const d = deps(store);
    const fresh = staleToken({ groupsRefreshedAt: NOW - MIN, groupsVerifiedAt: NOW - MIN });

    await expect(refreshSessionClaims(fresh, d)).resolves.toEqual(fresh);
    expect(store.claimRefreshSlot).not.toHaveBeenCalled();
    expect(d.fetchClaims).not.toHaveBeenCalled();
  });

  it("re-derives from PocketID and records it when it wins the refresh slot", async () => {
    const store = fakeStore();
    const d = deps(store);

    const token = await refreshSessionClaims(staleToken(), d);

    expect(d.fetchClaims).toHaveBeenCalledWith("user-1");
    expect(token).toMatchObject({
      groups: ["media", "engineering"],
      isAdmin: false,
      groupsRefreshedAt: NOW,
      groupsVerifiedAt: NOW,
    });
    expect(store.saveVerified).toHaveBeenCalledWith(
      "user-1",
      { groups: ["media", "engineering"], isAdmin: false },
      NOW,
    );
  });

  // The replay attack: a client keeps presenting the same old cookie and
  // ignores every Set-Cookie, so the token always looks stale.
  it("calls PocketID at most once per interval for a replayed old cookie", async () => {
    const store = fakeStore();
    const d = deps(store);
    const replayed = staleToken({
      groupsRefreshedAt: NOW - 60 * MIN,
      groupsVerifiedAt: NOW - 60 * MIN,
    });

    for (let i = 0; i < 20; i++) {
      await refreshSessionClaims(replayed, d);
    }

    expect(d.fetchClaims).toHaveBeenCalledTimes(1);
  });

  // The trap in a timestamp-only throttle: skipping the refresh must not mean
  // trusting the old cookie's claims, or a revoked admin comes back.
  it("serves the stored claims, not the cookie's, when another request refreshed recently", async () => {
    const store = fakeStore({
      groups: ["media"],
      isAdmin: false,
      verifiedAt: NOW - MIN,
      attemptedAt: NOW - MIN,
    });
    const d = deps(store);
    const replayed = staleToken({
      isAdmin: true,
      groupsRefreshedAt: NOW - 60 * MIN,
      groupsVerifiedAt: NOW - 60 * MIN,
    });

    const token = await refreshSessionClaims(replayed, d);

    expect(d.fetchClaims).not.toHaveBeenCalled();
    expect(token).toMatchObject({
      groups: ["media"],
      isAdmin: false,
      groupsVerifiedAt: NOW - MIN,
      groupsRefreshedAt: NOW,
    });
  });

  it("keeps the token's claims when they are newer than the stored ones", async () => {
    const store = fakeStore({
      groups: ["old"],
      isAdmin: false,
      verifiedAt: NOW - 4 * MIN,
      attemptedAt: NOW - MIN,
    });
    const token = staleToken({ groupsVerifiedAt: NOW - 2 * MIN });

    await expect(refreshSessionClaims(token, deps(store))).resolves.toMatchObject({
      groups: ["media"],
      isAdmin: true,
      groupsRefreshedAt: NOW,
    });
  });

  // A slot claimed by a request whose PocketID call is still in flight (or
  // failed) leaves a row with nothing verified in it yet.
  it("keeps the token's claims when the stored row has never been verified", async () => {
    const store = fakeStore({ groups: [], isAdmin: false, verifiedAt: null, attemptedAt: NOW - MIN });

    await expect(refreshSessionClaims(staleToken(), deps(store))).resolves.toMatchObject({
      groups: ["media"],
      isAdmin: true,
    });
  });

  // Lost the slot, then couldn't read what the winner stored: keep this
  // session's claims (bounded by the admin ceiling), don't fail the request,
  // and don't fall through to PocketID, which the slot says someone else asked.
  // A session that has never recorded a refresh has nothing to be newer
  // than, so whatever another request verified wins.
  it("takes the stored claims for a token that never recorded a refresh", async () => {
    const store = fakeStore({ groups: ["media"], isAdmin: false, verifiedAt: NOW - MIN, attemptedAt: NOW - MIN });
    const token = staleToken({ groupsRefreshedAt: undefined, groupsVerifiedAt: undefined });

    await expect(refreshSessionClaims(token, deps(store))).resolves.toMatchObject({
      groups: ["media"],
      isAdmin: false,
      groupsVerifiedAt: NOW - MIN,
    });
  });

  it("keeps the token's claims when the stored ones can't be read", async () => {
    const store = fakeStore({ groups: ["other"], isAdmin: false, verifiedAt: NOW, attemptedAt: NOW });
    vi.mocked(store.read).mockRejectedValue(new Error("connection reset"));
    const d = deps(store);

    const token = await refreshSessionClaims(staleToken(), d);

    expect(token).toMatchObject({ groups: ["media"], isAdmin: true, groupsRefreshedAt: NOW });
    expect(d.fetchClaims).not.toHaveBeenCalled();
    expect(d.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringMatching(/stored session claims/),
    );
  });

  it("keeps the last claims and backs off when PocketID fails", async () => {
    const store = fakeStore();
    const d = deps(store, failingFetch());
    const before = staleToken();

    const token = await refreshSessionClaims(before, d);

    expect(token).toMatchObject({
      groups: ["media"],
      isAdmin: true,
      groupsRefreshedAt: NOW,
      groupsVerifiedAt: before.groupsVerifiedAt,
    });
    expect(store.saveVerified).not.toHaveBeenCalled();
    expect(d.log.warn).toHaveBeenCalled();
  });

  // The attempt is stamped on failure too, or the token would stay stale and
  // every following request would try again for as long as the outage lasts.
  it("backs off a full interval after a failed attempt", async () => {
    const store = fakeStore();
    const d = deps(store, failingFetch());

    const after = await refreshSessionClaims(staleToken(), d);
    await refreshSessionClaims(after, { ...d, now: NOW + GROUPS_REFRESH_INTERVAL_MS - 1 });

    expect(store.claimRefreshSlot).toHaveBeenCalledTimes(1);
  });

  // With the store down there is no throttle to trust, so PocketID is not
  // called at all rather than on every request.
  it("does not call PocketID when Postgres is unavailable", async () => {
    const store = fakeStore();
    vi.mocked(store.claimRefreshSlot).mockRejectedValue(new Error("connection refused"));
    const d = deps(store);

    const token = await refreshSessionClaims(staleToken(), d);

    expect(d.fetchClaims).not.toHaveBeenCalled();
    expect(token).toMatchObject({ groups: ["media"], isAdmin: true, groupsRefreshedAt: NOW });
    expect(d.log.warn).toHaveBeenCalled();
  });

  it("still applies fresh PocketID claims when recording them fails", async () => {
    const store = fakeStore();
    vi.mocked(store.saveVerified).mockRejectedValue(new Error("connection reset"));

    await expect(refreshSessionClaims(staleToken(), deps(store))).resolves.toMatchObject({
      groups: ["media", "engineering"],
      isAdmin: false,
      groupsVerifiedAt: NOW,
    });
  });

  describe("admin staleness ceiling", () => {
    it("drops admin once claims have gone unverified past the ceiling", async () => {
      const store = fakeStore();
      const fresh = staleToken({
        groupsRefreshedAt: NOW - MIN,
        groupsVerifiedAt: NOW - ADMIN_MAX_UNVERIFIED_MS - 1,
      });

      const token = await refreshSessionClaims(fresh, deps(store));

      expect(token.isAdmin).toBe(false);
      // Groups ride on: users keep their app list through an outage.
      expect(token.groups).toEqual(["media"]);
    });

    it("keeps admin right up to the ceiling", async () => {
      const store = fakeStore();
      const fresh = staleToken({
        groupsRefreshedAt: NOW - MIN,
        groupsVerifiedAt: NOW - ADMIN_MAX_UNVERIFIED_MS,
      });

      await expect(refreshSessionClaims(fresh, deps(store))).resolves.toMatchObject({
        isAdmin: true,
      });
    });

    it("drops admin during a PocketID outage that outlasts the ceiling", async () => {
      const store = fakeStore();

      const token = await refreshSessionClaims(
        staleToken({ groupsVerifiedAt: NOW - ADMIN_MAX_UNVERIFIED_MS - 1 }),
        deps(store, failingFetch()),
      );

      expect(token.isAdmin).toBe(false);
    });

    it("drops admin during a Postgres outage that outlasts the ceiling", async () => {
      const store = fakeStore();
      vi.mocked(store.claimRefreshSlot).mockRejectedValue(new Error("connection refused"));

      const token = await refreshSessionClaims(
        staleToken({ groupsVerifiedAt: NOW - ADMIN_MAX_UNVERIFIED_MS - 1 }),
        deps(store),
      );

      expect(token.isAdmin).toBe(false);
    });

    // From review: a failed attempt moves groupsRefreshedAt, so a legacy
    // cookie's fallback must be pinned or the ceiling would chase `now`.
    it("trips for a legacy cookie carried through repeated failed refreshes", async () => {
      const store = fakeStore();
      const fetchClaims = failingFetch();
      let token: JWT = staleToken({ groupsVerifiedAt: undefined });
      const start = NOW;

      for (let t = start; t <= start + ADMIN_MAX_UNVERIFIED_MS + GROUPS_REFRESH_INTERVAL_MS; t += GROUPS_REFRESH_INTERVAL_MS) {
        token = await refreshSessionClaims(token, { ...deps(store, fetchClaims), now: t });
      }

      expect(token.isAdmin).toBe(false);
    });

    it("trips for a legacy cookie carried through a Postgres outage", async () => {
      const store = fakeStore();
      vi.mocked(store.claimRefreshSlot).mockRejectedValue(new Error("connection refused"));
      let token: JWT = staleToken({ groupsVerifiedAt: undefined });

      for (let t = NOW; t <= NOW + ADMIN_MAX_UNVERIFIED_MS + GROUPS_REFRESH_INTERVAL_MS; t += GROUPS_REFRESH_INTERVAL_MS) {
        token = await refreshSessionClaims(token, { ...deps(store), now: t });
      }

      expect(token.isAdmin).toBe(false);
    });

    // Cookies issued before groupsVerifiedAt existed only carry
    // groupsRefreshedAt; dropping every admin on deploy would be wrong.
    it("falls back to the refresh time for cookies that predate groupsVerifiedAt", async () => {
      const store = fakeStore();
      const legacy = staleToken({ groupsRefreshedAt: NOW - MIN, groupsVerifiedAt: undefined });

      await expect(refreshSessionClaims(legacy, deps(store))).resolves.toMatchObject({
        isAdmin: true,
      });
    });
  });
});

describe("recordSignInClaims", () => {
  it("records the sign-in claims so they supersede older sessions' copies", async () => {
    const store = fakeStore();

    await recordSignInClaims(store, "user-1", { groups: ["media"], isAdmin: false }, NOW, {
      warn: vi.fn(),
    });

    expect(store.saveVerified).toHaveBeenCalledWith(
      "user-1",
      { groups: ["media"], isAdmin: false },
      NOW,
    );
  });

  it("never fails a sign-in because Postgres is unavailable", async () => {
    const store = fakeStore();
    vi.mocked(store.saveVerified).mockRejectedValue(new Error("connection refused"));
    const log = { warn: vi.fn() };

    await expect(
      recordSignInClaims(store, "user-1", { groups: [], isAdmin: false }, NOW, log),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});

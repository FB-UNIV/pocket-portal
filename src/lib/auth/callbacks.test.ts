import { describe, it, expect } from "vitest";
import {
  applyProfileToToken,
  applyRefreshedGroupsToToken,
  applyTokenToSession,
  shouldRefreshGroups,
} from "./callbacks";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";

describe("applyProfileToToken", () => {
  it("copies the groups claim from the OIDC profile onto the token on initial sign-in", () => {
    const token = {} as JWT;
    const profile = { sub: "user-1", groups: ["admins", "engineering"] };

    const result = applyProfileToToken(token, profile, false);

    expect(result.groups).toEqual(["admins", "engineering"]);
  });

  it("defaults to an empty array when the profile has no groups claim", () => {
    const token = {} as JWT;
    const profile = { sub: "user-1" };

    const result = applyProfileToToken(token, profile, false);

    expect(result.groups).toEqual([]);
  });

  it("leaves the token's groups and isAdmin untouched when there is no profile (token refresh)", () => {
    const token = { groups: ["admins"], isAdmin: true } as JWT;

    const result = applyProfileToToken(token, undefined, false);

    expect(result.groups).toEqual(["admins"]);
    expect(result.isAdmin).toBe(true);
  });

  it("sets isAdmin on the token from the resolved admin status on initial sign-in", () => {
    const token = {} as JWT;
    const profile = { sub: "user-1" };

    expect(applyProfileToToken(token, profile, true).isAdmin).toBe(true);
    expect(applyProfileToToken(token, profile, false).isAdmin).toBe(false);
  });

  it("stamps the profile's sub claim onto the token on initial sign-in", () => {
    const token = {} as JWT;
    const profile = { sub: "user-1" };

    expect(applyProfileToToken(token, profile, false).sub).toBe("user-1");
  });

  it("leaves the token's existing sub untouched when there is no profile (token refresh)", () => {
    const token = { sub: "user-1" } as JWT;

    expect(applyProfileToToken(token, undefined, false).sub).toBe("user-1");
  });

  it("leaves sub undefined when the profile carries no sub claim", () => {
    const token = {} as JWT;
    const profile = { groups: ["engineering"] };

    expect(applyProfileToToken(token, profile, false).sub).toBeUndefined();
  });

  it("stamps groupsRefreshedAt on sign-in, starting the refresh throttle", () => {
    const token = {} as JWT;
    const profile = { sub: "user-1" };

    expect(applyProfileToToken(token, profile, false, 1_000).groupsRefreshedAt).toBe(1_000);
  });
});

describe("shouldRefreshGroups", () => {
  it("is stale when the token has never been refreshed", () => {
    const token = {} as JWT;

    expect(shouldRefreshGroups(token, 10_000, 5_000)).toBe(true);
  });

  it("is not stale within the max age window", () => {
    const token = { groupsRefreshedAt: 10_000 } as JWT;

    expect(shouldRefreshGroups(token, 14_999, 5_000)).toBe(false);
  });

  it("is stale once the max age has elapsed", () => {
    const token = { groupsRefreshedAt: 10_000 } as JWT;

    expect(shouldRefreshGroups(token, 15_000, 5_000)).toBe(true);
  });
});

describe("applyRefreshedGroupsToToken", () => {
  it("replaces the token's groups and isAdmin with freshly-derived values", () => {
    const token = { groups: ["stale"], isAdmin: false, sub: "user-1" } as JWT;

    const result = applyRefreshedGroupsToToken(token, ["media", "engineering"], true, 20_000);

    expect(result.groups).toEqual(["media", "engineering"]);
    expect(result.isAdmin).toBe(true);
    expect(result.groupsRefreshedAt).toBe(20_000);
  });

  it("preserves the rest of the token (e.g. sub)", () => {
    const token = { sub: "user-1" } as JWT;

    expect(applyRefreshedGroupsToToken(token, [], false, 1).sub).toBe("user-1");
  });
});

describe("applyTokenToSession", () => {
  it("exposes the token's groups on session.user", () => {
    const session = { user: {}, expires: "" } as Session;
    const token = { groups: ["admins", "engineering"] } as JWT;

    const result = applyTokenToSession(session, token);

    expect(result.user.groups).toEqual(["admins", "engineering"]);
  });

  it("exposes the token's sub as session.user.id", () => {
    const session = { user: {}, expires: "" } as Session;
    const token = { sub: "user-1" } as JWT;

    expect(applyTokenToSession(session, token).user.id).toBe("user-1");
  });

  it("defaults to an empty array when the token has no groups", () => {
    const session = { user: {}, expires: "" } as Session;
    const token = {} as JWT;

    const result = applyTokenToSession(session, token);

    expect(result.user.groups).toEqual([]);
  });

  it("exposes the token's isAdmin on session.user", () => {
    const session = { user: {}, expires: "" } as Session;

    expect(applyTokenToSession(session, { isAdmin: true } as JWT).user.isAdmin).toBe(true);
    expect(applyTokenToSession(session, { isAdmin: false } as JWT).user.isAdmin).toBe(false);
  });

  it("defaults isAdmin to false when the token has none", () => {
    const session = { user: {}, expires: "" } as Session;
    const token = {} as JWT;

    expect(applyTokenToSession(session, token).user.isAdmin).toBe(false);
  });
});

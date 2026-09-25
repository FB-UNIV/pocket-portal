import type { JWT } from "next-auth/jwt";
import type { Session, Profile } from "next-auth";

// PocketID's ID token/userinfo carries a "groups" claim (verified against a
// real instance's /.well-known/openid-configuration claims_supported).
interface PocketIdProfile extends Profile {
  groups?: string[];
}

export function applyProfileToToken(
  token: JWT,
  profile: PocketIdProfile | undefined,
  isAdmin: boolean,
  now: number = Date.now(),
): JWT {
  if (!profile) {
    return token;
  }

  return {
    ...token,
    sub: profile.sub ?? undefined,
    groups: profile.groups ?? [],
    isAdmin,
    groupsRefreshedAt: now,
    groupsVerifiedAt: now,
  };
}

// Whether a live session's groups/isAdmin are stale enough to re-derive
// from PocketID. Auth.js's session.updateAge does NOT gate this for
// the "jwt" session strategy — callbacks.jwt runs on every session check
// regardless (verified in @auth/core's session action, lib/actions/session.js:
// updateAge only throttles the "database" strategy's session-row rewrites) —
// so the throttle has to live on the token itself.
export function shouldRefreshGroups(token: JWT, now: number, maxAgeMs: number): boolean {
  if (!token.groupsRefreshedAt) {
    return true;
  }

  return now - token.groupsRefreshedAt >= maxAgeMs;
}

// Applies a background re-fetch of groups/isAdmin from PocketID to an
// existing token (the refresh path — no OIDC `profile` is available here,
// unlike sign-in).
export function applyRefreshedGroupsToToken(
  token: JWT,
  groups: string[],
  isAdmin: boolean,
  now: number = Date.now(),
): JWT {
  return { ...token, groups, isAdmin, groupsRefreshedAt: now, groupsVerifiedAt: now };
}

export function applyTokenToSession(session: Session, token: JWT): Session {
  return {
    ...session,
    user: {
      ...session.user,
      // PocketID's OIDC "sub" is always present on an authenticated JWT
      // session (same assumption src/auth.ts already makes when it reads
      // profile.sub to resolve admin status) — JWT.sub is only typed
      // optional because next-auth's generic JWT shape allows for
      // unauthenticated tokens.
      id: token.sub as string,
      groups: token.groups ?? [],
      isAdmin: token.isAdmin ?? false,
    },
  };
}

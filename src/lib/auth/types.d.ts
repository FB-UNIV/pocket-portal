import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      groups: string[];
      isAdmin: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    groups?: string[];
    isAdmin?: boolean;
    // Epoch ms of the last time we synced with PocketID — sign-in, a
    // successful background refresh, or a *failed* refresh attempt.
    // Gates how often the jwt callback re-fetches on an existing session;
    // it advances on failure too, so an outage is retried at most once per
    // interval rather than on every single request.
    groupsRefreshedAt?: number;
    // Epoch ms of the last time PocketID actually confirmed groups/isAdmin
    // (sign-in or a successful refresh). Unlike groupsRefreshedAt it
    // does not move on a failed attempt, so it bounds how long admin rights
    // can ride on unconfirmed claims (ADMIN_MAX_UNVERIFIED_MS).
    groupsVerifiedAt?: number;
  }
}

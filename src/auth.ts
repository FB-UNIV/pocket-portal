import NextAuth from "next-auth";
import { getPocketIdOidcConfig } from "@/lib/auth/config";
import { applyProfileToToken, applyTokenToSession } from "@/lib/auth/callbacks";
import { authLogger } from "@/lib/observability/auth-logger";
import { recordSignInClaims, refreshSessionClaims } from "@/lib/auth/claims-refresh";
import { createClaimsStore } from "@/lib/auth/claims-store";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig, getPocketIdUser, getPocketIdUserGroups } from "@/lib/pocketid/client";
import { logger } from "@/lib/observability/logger";

// Config is built per request, not cached at module scope: env is read on
// every call, matching the stateless convention in
// .claude/rules/pocketid-api.md (and letting `next build`/unit tests run
// without PocketID OIDC env vars set, since only real requests need them).
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const pocketId = getPocketIdOidcConfig();

  return {
    // No adapter configured => sessions are signed JWT cookies, not a
    // server-side store (ADR-0004: stateless request-handling tier).
    session: { strategy: "jwt" },
    // Self-hosted behind a proxy, so Auth.js can't infer the host is trusted.
    // This is the fallback: with AUTH_URL set (recommended), Auth.js uses it
    // instead of the Host header. See src/lib/auth/origin.ts, which warns at
    // startup when the fallback is in use in production.
    trustHost: true,
    // The portal's own pages rather than Auth.js's unstyled defaults.
    pages: { signIn: "/", error: "/auth/error" },
    // Auth.js logs in the portal's format.
    logger: authLogger(),
    providers: [
      {
        id: "pocketid",
        name: "PocketID",
        type: "oidc",
        issuer: pocketId.issuer,
        clientId: pocketId.clientId,
        clientSecret: pocketId.clientSecret,
        authorization: { params: { scope: "openid profile email groups" } },
        // Auth.js's default checks for a generic OIDC provider is ["pkce"]
        // only — "state" is only added automatically when redirectProxyUrl
        // is set, which we don't use. PocketID's /authorize rejects
        // requests with no state param ("invalid_state"), confirmed live.
        checks: ["pkce", "state"],
      },
    ],
    callbacks: {
      async jwt({ token, profile }) {
        if (profile) {
          // PocketID's OIDC "sub" claim is the same id used by its admin API
          // (verified in its own source: claims["sub"] = user.ID), so this
          // looks up the real PocketID admin flag rather than inventing a
          // separate portal-admin concept. Fails closed (non-admin) if the
          // admin API is unreachable, rather than blocking login entirely.
          let isAdmin = false;
          let adminResolved = false;
          try {
            const user = await getPocketIdUser(getPocketIdConfig(), profile.sub as string);
            isAdmin = user.isAdmin;
            adminResolved = true;
          } catch (error) {
            logger.warn({ error }, "Failed to resolve PocketID admin status at login");
          }

          const now = Date.now();
          const signedIn = applyProfileToToken(token, profile, isAdmin, now);
          // Only claims PocketID fully confirmed are shared with the user's
          // other sessions: a fail-closed isAdmin=false from a failed
          // lookup would otherwise demote their other browsers too.
          if (adminResolved && signedIn.sub) {
            await recordSignInClaims(
              createClaimsStore(getDb),
              signedIn.sub,
              { groups: signedIn.groups ?? [], isAdmin },
              now,
              logger,
            );
          }
          return signedIn;
        }

        // Existing session, no fresh OIDC profile: re-derive groups/isAdmin
        // from PocketID at most once per interval per user, with the throttle
        // and the verified claims held in Postgres rather than in the cookie
        //. See src/lib/auth/claims-refresh.ts.
        return refreshSessionClaims(token, {
          store: createClaimsStore(getDb),
          fetchClaims: async (subject) => {
            const config = getPocketIdConfig();
            const [groups, user] = await Promise.all([
              getPocketIdUserGroups(config, subject),
              getPocketIdUser(config, subject),
            ]);
            return { groups: groups.map((group) => group.name), isAdmin: user.isAdmin };
          },
          log: logger,
          now: Date.now(),
        });
      },
      session({ session, token }) {
        return applyTokenToSession(session, token);
      },
    },
  };
});

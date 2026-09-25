# ADR-0004: Portal authenticates end users via PocketID OIDC

**Date**: 2026-09-20
**Status**: accepted
**Deciders**: François Bouju (session mechanism chosen by Claude, flagged for review)

## Context

The portal's existing PocketID integration (`src/lib/pocketid/client.ts`)
only uses a server-side admin API key for backend calls — it has no notion
of which end user is browsing. Showing "your access" and attributing
requests to a specific person requires the portal to know who's logged in.
PocketID's own reference example (`pocket-id-portal`) follows this same
pattern: the portal is itself a registered OIDC client that users log into.

## Decision

Register the portal as a PocketID OIDC client. End users authenticate via
the standard OIDC authorization code flow. Sessions use signed JWT cookies,
not a server-side session store, to keep the request-handling tier
stateless.

## Alternatives Considered

### Alternative 1: Reuse the admin API key for everything, no real user login
- **Pros**: nothing new to implement.
- **Cons**: can't distinguish users, can't show personalized "your access,"
  can't attribute access requests to anyone.
- **Why not**: defeats the stated product goal outright.

### Alternative 2: Database-backed sessions
- **Pros**: sessions are revocable server-side at any time.
- **Cons**: turns session lookup into a stateful dependency on every
  request, and duplicates state PocketID's own OIDC tokens already carry
  (refresh/expiry).
- **Why not**: signed JWT cookies keep the app tier stateless per the
  existing HA rule; token expiry/refresh via the OIDC flow covers the
  common revocation need. Can be revisited if a hard "kill this session
  right now" requirement shows up.

## Consequences

### Positive
- Matches PocketID's own intended integration pattern (same shape as its
  reference portal example).
- Per-user identity enables personalization and request attribution.

### Negative
- Adds real complexity: authorization code flow, token refresh, secure
  cookie handling.

### Risks
- Session cookies must be `httpOnly`, `secure`, and properly scoped —
  standard OIDC client hygiene, but worth calling out since a mistake here
  is a real vulnerability, not just a bug.
- Choice of OIDC client library (e.g. Auth.js/NextAuth vs. a lighter
  hand-rolled flow) is an implementation detail, not fixed by this ADR.

## Amendment (2026-09-24): claims are verified against Postgres

Sessions are still signed JWT cookies, and a request whose cookie is fresh
still touches no database. What changed is where the *refresh* of a
session's groups/admin claims keeps its state. The throttle was a timestamp
in the cookie, which a client can replay. It could therefore force a
PocketID admin-API call on every request, or keep presenting claims PocketID
had since revoked.

**Decision.** A `session_claims` row per user holds the last claims PocketID
verified, when that was, and when a refresh was last attempted. A cookie
that looks stale reads that row. One request per user per interval wins an
atomic slot and asks PocketID; the rest take the stored claims. The row
always wins over older claims in a cookie. Admin rights also lapse after 15
minutes without a successful verification, so an outage can't prolong a
revoked admin's access.

This is not Alternative 2 (database-backed sessions): there is no session
lookup on every request, sessions are not revocable server-side, and losing
the table only costs one extra PocketID call per user.

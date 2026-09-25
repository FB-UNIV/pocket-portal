# ADR-0007: PocketID OIDC clients are the live app catalog, not a Postgres copy

**Date**: 2026-09-21
**Status**: accepted
**Deciders**: François Bouju

## Context

The first catalog built a Postgres `apps` table and an admin CRUD UI for the app
catalog (name, description, icon, launch URL, backing PocketID group).
This duplicates data PocketID's own OIDC clients already store —
confirmed live: `GET /api/oidc/clients` returns `name`, `description`,
`launchURL`, a logo (`GET /api/oidc/clients/{id}/logo`), and
`allowedUserGroups` per client. The user already registers every
real app as a PocketID OIDC client, with groups already set up, and
does not want to re-enter that data a second time in the portal.

PocketID has no concept of "hide this client from the portal's browse
view" — confirmed by checking its OIDC client DTOs/models and frontend
routes directly (no launcher/dashboard page exists in PocketID itself,
and no visibility field on the client model or via custom claims at the
client level).

## Decision

Drop the `apps` table. The catalog is read live from PocketID's
`GET /api/oidc/clients` on every request that needs it — no caching
layer, staying stateless. A client with no `launchURL` set is
automatically excluded from the browsable catalog (nothing to link to).

A new, minimal `app_overrides` table (`pocket_id_client_id`, `hidden`)
holds only explicit hide/show exceptions an admin sets in the portal —
never a copy of name/description/launchURL/groups. Most clients will
never have a row here; it only exists for the ones an admin explicitly
hides.

Access is determined by intersecting the signed-in user's session groups
with a client's `allowedUserGroups`, or treating it as open access if the
client is unrestricted (`isGroupRestricted: false`).

Access requests still get their own Postgres table, unchanged from
ADR-0002 — that's real state PocketID has no concept of. A request
targets one specific group; if a client allows several, the requester
picks which one when submitting, but the admin has final approve/deny
say regardless of what was requested.

## Alternatives Considered

### Alternative 1: Keep the Postgres `apps` table, sync it from PocketID
- **Pros**: catalog reads don't depend on PocketID being reachable;
  could add portal-only fields PocketID doesn't have.
- **Cons**: introduces a sync/staleness problem (rename or regroup an app
  in PocketID, and the portal's copy silently drifts until someone
  remembers to re-sync); the exact "double my work" duplication being
  rejected here, just automated instead of manual.
- **Why not**: no real requirement for offline catalog reads at homelab
  scale, and the sync problem is strictly worse than reading live.

### Alternative 2: Use PocketID custom claims to store a "hidden" flag
- **Pros**: keeps literally everything, including the hide flag, inside
  PocketID — zero new tables.
- **Cons**: custom claims are a token-injection mechanism for users/groups
  (verified in PocketID's `claims_service.go`), not general per-client
  metadata storage; abusing them this way risks the flag leaking into
  actual ID tokens/userinfo responses for that client's users.
- **Why not**: repurposing a claims mechanism for unrelated app-state
  storage is the wrong tool, and risks a real data leak (a claim meant to
  be internal accidentally becoming a token claim).

## Consequences

### Positive
- Renaming, regrouping, or changing the launch URL of an app in PocketID
  is reflected in the portal instantly — no portal-side edit required.
- No sync/staleness class of bugs to maintain.
- The admin UI shrinks from a CRUD form to a visibility toggle over data
  that already exists.

### Negative
- Every catalog view now makes a live PocketID API call instead of a
  local Postgres query. Fine at homelab scale; would need a caching
  layer at real scale (not needed here).
- Couples the browse/request UI's availability to PocketID's own
  availability, more tightly than before. Access requests themselves
  (Postgres-backed) are unaffected if PocketID has a brief outage — only
  the live catalog view would degrade.

### Risks
- If PocketID ever adds its own visibility/launcher-hide concept natively,
  `app_overrides` becomes redundant — revisit then rather than guessing
  now.

## Supersedes

The "app catalog" half of ADR-0003 (Postgres for catalog *and* requests).
The *requests* half of ADR-0003 is unaffected and still stands.

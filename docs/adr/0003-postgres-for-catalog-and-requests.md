# ADR-0003: Postgres as the external datastore for the app catalog and access requests

**Date**: 2026-09-20
**Status**: accepted — partially superseded by [ADR-0007](0007-pocketid-live-catalog.md)
**Deciders**: François Bouju (data store engine chosen by Claude, flagged for review)

> **2026-09-21 update**: the *catalog* half of this decision (a Postgres
> `apps` table) is superseded by ADR-0007 — the catalog is now read live
> from PocketID's OIDC clients instead. The *access requests* half below
> is unaffected and still stands: that state has no PocketID equivalent
> and still needs Postgres.

## Context

The portal needs to persist two things PocketID has no concept of: an app
catalog (name, description, icon, launch URL, and which PocketID group
grants access to it — possibly including apps not yet OIDC-integrated) and
access-request records (requester, target group, status, timestamps,
decision). The project already has a hard constraint: the app tier must
stay stateless to support horizontal scaling / HA later
(`.claude/rules/pocketid-api.md`).

## Decision

Add Postgres as an external datastore for the app catalog and access
requests. The Next.js app tier remains stateless and horizontally
scalable; Postgres is the single shared source of truth across replicas.

## Alternatives Considered

### Alternative 1: SQLite
- **Pros**: zero extra infrastructure, trivial local setup.
- **Cons**: file-based single-writer model sits awkwardly against
  multiple stateless app replicas writing concurrently; needs extra
  tooling (e.g. Litestream, NFS with caveats) to behave well in an HA
  setup.
- **Why not**: conflicts more directly with the project's explicit HA goal
  than Postgres does, for no real benefit in a homelab context where
  running Postgres is not a burden.

### Alternative 2: Derive everything from PocketID alone (no new datastore)
- **Pros**: no new infrastructure dependency.
- **Cons**: no request history/audit trail beyond whatever the approval
  flow keeps elsewhere; no rich catalog metadata (icons, descriptions) —
  apps would just be raw PocketID OIDC client names.
- **Why not**: already rejected — the approved approach (ADR-0002) is a
  built-in approval UI, which needs request-state storage; and a bare
  client-name list doesn't meet "portal for my users" as a real product.

## Consequences

### Positive
- Proper audit trail and a real catalog UI (icons, descriptions, etc.).
- Standard, well-understood operational model for a homelab-hosted
  Postgres instance.

### Negative
- New infrastructure dependency to run and back up.
- Needs schema migration tooling as the app evolves.

### Risks
- Postgres availability becomes a new dependency for the portal's write
  paths (submitting/approving requests, editing the catalog). Read paths
  for "your current access" are already live from PocketID regardless, so
  a brief Postgres hiccup degrades request/catalog features without
  breaking the core "what do I have access to" view.
- Migration/ORM tooling choice is an implementation detail, not fixed by
  this ADR — record it separately once picked.

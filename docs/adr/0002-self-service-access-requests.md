# ADR-0002: Self-service access requests with in-app admin approval

**Date**: 2026-09-20
**Status**: accepted
**Deciders**: François Bouju

## Context

PocketID has no concept of a pending access request — group membership
changes require an admin to act via PocketID's own UI or API
(`PUT /users/:id/user-groups`). Users need a way to discover apps they don't
yet have access to and ask for it without pinging the homelab owner
out-of-band every time.

## Decision

Build an in-app request/approval flow: a user submits a request naming a
target group (app); the admin sees pending requests inside the portal and
approves or denies them; approving calls PocketID's API to add the user to
the group.

## Alternatives Considered

### Alternative 1: Manual out-of-band approval only
- **Pros**: nothing to build beyond a notification (email/webhook) when
  someone wants access.
- **Cons**: no audit trail, no in-app history, doesn't scale past a
  handful of users, admin still has to go into PocketID directly every
  time.
- **Why not**: defeats the actual point of building a portal — "request
  access to certain apps or groups" was a stated goal, not an
  afterthought.

## Consequences

### Positive
- Full audit trail of who requested what, when, and who approved it.
- Admin has one place (the portal) to manage access instead of jumping
  between systems.
- Self-service reduces friction for users.

### Negative
- The portal needs write access to PocketID's admin API
  (group-membership changes), which is more sensitive than the read-only
  calls it makes today.
- Requires its own storage for request state (see ADR-0003).

### Risks
- The PocketID API key used for group writes must never be exposed to the
  browser — server-side only (Next.js server actions/route handlers), same
  pattern already used for the existing admin client
  (`src/lib/pocketid/client.ts`).
- A buggy approval path could grant unintended access. Mitigation: this
  path needs test coverage (unit + integration against a real PocketID
  instance) before shipping, per the project's TDD workflow.

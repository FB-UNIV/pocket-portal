# ADR-0012: App dependencies are portal-side links between PocketID clients

**Date**: 2026-11-13
**Status**: accepted
**Deciders**: François Bouju

## Context

Some apps are only usable with another one. Grafana is gated by the
`engineering` group, but it is only reachable over the VPN, which is its own
PocketID OIDC client gated by `vpn`. A user granted Grafana alone still can't
reach it, and nothing in the portal says why (#19).

PocketID can't express this. A client's `allowedUserGroups` is an OR: any one
of them lets you in. There is no "requires" relation between clients, and
custom claims are the wrong tool for client metadata (ADR-0007, alternative 2).
The portal is a launcher, not a gateway (ADR-0001), so it can't enforce the
dependency either: the VPN does that.

ADR-0007 limits portal-side app data to what PocketID has no field for (the
`hidden` flag, then `category`), and never a copy of PocketID's own data.

## Decision

An app can **depend on other apps**: a portal-side link from one PocketID
OIDC client to another, stored in a new `app_dependencies` table
(`pocket_id_client_id` → `requires_pocket_id_client_id`). This amends
ADR-0007 a second time.

- **App → app, not app → group.** Which group grants the prerequisite is read
  live from that client's `allowedUserGroups`, so renaming or regrouping in
  PocketID can't leave the portal stale. Only the link itself is stored.
- **One level deep.** An app that has prerequisites can't be one, and a
  prerequisite can't have its own. No self-links, so no cycles.
- **Any client can be a prerequisite**, including one that's hidden or has no
  launch URL: a VPN usually has neither a page nor a reason to be listed.
- **The portal informs, it doesn't enforce.** Users see that an app needs
  another one and whether they have it. **Open** still works.
- Admins edit links on the app's admin page. Every change is audited
  (`app_dependency.added`, `app_dependency.removed`).
- A link to a client PocketID no longer has is ignored when read, the same way
  an `app_overrides` row for a deleted client is.

Requesting an app together with its missing prerequisites (linked requests,
"Approve both") builds on this and is a separate change.

## Alternatives Considered

### Alternative 1: Store the prerequisite *group* on the app
- **Pros**: one less PocketID lookup; works for a prerequisite that isn't an
  OIDC client at all.
- **Cons**: copies PocketID's group assignment into the portal. Regroup the
  VPN in PocketID and the portal keeps granting the old group: the exact drift
  ADR-0007 rules out.
- **Why not**: every prerequisite in practice is itself a client, and its
  groups are already one live read away.

### Alternative 2: Arbitrary dependency chains
- **Pros**: models "A needs B needs C".
- **Cons**: cycle detection, transitive grants and a much harder admin UI and
  request flow, for a case nobody has.
- **Why not**: one level covers every real example (apps behind a VPN).
  Lifting the limit later is additive; adding it later would break data.

## Consequences

### Positive
- Users see why an app they were granted doesn't load, and what to ask for.
- Regrouping a prerequisite in PocketID is picked up immediately.
- Postgres is shared state, so links are consistent across replicas and
  rolling deploys; there's no in-process cache to invalidate.

### Negative
- One more portal-only table for admins to keep right, and links can outlive
  the reason for them. The admin page shows them next to the app's other
  settings to keep that visible.

### Risks
- Two admins adding links at the same moment could each pass the one-level
  check alone and together build a chain. The check and the insert run in one
  transaction that locks the table, so they serialise.

# ADR-0001: Portal is a launcher, not an access gateway

**Date**: 2026-09-20
**Status**: accepted
**Deciders**: François Bouju

## Context

pocket-portal is meant to be the entry point to a homelab: users see which apps
they have access to and can request access to more. PocketID already
supports group-based access control for OIDC clients — an app registered as
a PocketID OIDC client can be restricted to specific groups, and PocketID
enforces that at login. The open question is whether the portal itself
should also sit in the request path (reverse-proxy / forward-auth) or stay
out of it.

## Decision

The portal is a launcher/dashboard only. It does not intercept or gate
traffic to homelab apps. Access enforcement is delegated entirely to each
app's own PocketID OIDC integration and group restriction.

## Alternatives Considered

### Alternative 1: Reverse-proxy forward-auth gateway
- **Pros**: could protect apps that don't natively support OIDC; single
  choke point for access policy.
- **Cons**: substantially larger scope (real network infra: Traefik/Caddy +
  oauth2-proxy, not just a Next.js app); the portal becomes critical path
  for *all* app traffic, raising its availability bar far above "nice
  dashboard."
- **Why not**: most target apps either already support OIDC or can be
  configured to use PocketID directly; building a gateway now is scope
  creep against the actual near-term goal (discovery + self-service
  requests).

## Consequences

### Positive
- Small scope: a portal outage only affects discovery/requests, not access
  to already-authorized apps.
- Each app's security posture is independent and auditable via PocketID
  directly.

### Negative
- Apps that can't do OIDC aren't protected by anything this portal
  provides — they need a separate solution.

### Risks
- Inconsistent security posture if some apps in the catalog aren't actually
  configured for PocketID OIDC yet. Mitigation: the app catalog (ADR-0003)
  should be able to represent "not yet integrated" apps explicitly rather
  than assuming every listed app is enforced.
- If a real need for gateway-level enforcement shows up later, this
  decision should be revisited and superseded rather than silently
  worked around.

# PocketID API reference rule

This project's core function is consuming the PocketID API to build a digital workspace. PocketID's API surface (auth flows, endpoints, scopes, response shapes) is the source of truth for anything touching identity, users, groups, or OIDC/OAuth behavior here.

- Before implementing or modifying any code that calls PocketID, or reasoning about its behavior, check the reference docs: https://pocket-id.org/docs/api
- Do not guess endpoint paths, request/response shapes, auth flows, or error formats from memory or from other OIDC providers' conventions — verify against the reference above first.
- If the docs and the running PocketID instance's actual behavior disagree, trust the observed behavior and note the discrepancy.

## Architecture constraint: stateless

This app must stay stateless in the request-handling layer, since HA (multiple replicas behind a load balancer, rolling deploys) is a near-term goal.

- No in-process session storage, no sticky-session assumptions, no local file state for anything that must survive a restart or be visible to another replica.
- Session/auth state belongs in PocketID itself (tokens, OIDC session) or an external store (e.g. shared cache/DB), never in server memory.
- Any caching must be safe to lose or to diverge across replicas without correctness issues.

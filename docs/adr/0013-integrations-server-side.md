# ADR-0013: Integrations run on the server, keys stay in the environment

**Date**: 2026-11-13
**Status**: accepted
**Deciders**: François Bouju

## Context

#23 asks for dashboard widgets showing live data from the apps people use,
starting with Jellyfin's newest films and episodes, and suggests adapting
Homarr's integration layer. That means the portal calling other services
with credentials, which raises three questions: where the calls run, where
the keys live, and how far the portal trusts an address an admin typed.

## Decision

- **Server-side only.** Every call to an integrated app happens on the
  server; the browser sees only what a widget renders, and pictures
  (Jellyfin posters) are relayed through the portal. Keys never reach the
  browser, and the CSP is unchanged.
- **Keys from the environment.** An integration's API key is a setting like
  `POCKETID_API_KEY`: `JELLYFIN_API_KEY` or `JELLYFIN_API_KEY_FILE`, read
  through `src/lib/config.ts`, never stored in Postgres, never a form field.
  What an admin sets in the portal (address, linked app, on/off) lives in
  the `integrations` table, one row per type, every change audited.
- **Addresses are trusted only so far.** The base URL must be plain http(s)
  with no credentials in it; only fixed paths are called; redirects are
  refused, not followed (`redirect: "manual"`); every call has a timeout;
  ids from the browser (poster item ids) are checked before anything is
  asked; only image types are relayed, with `nosniff` and a sandboxing CSP.
- **Visibility follows the app.** A widget shows only to people who can
  open the PocketID app it's linked to; the poster route checks the same.
- **Failure is local.** A slow or down integration costs its own card
  ("Jellyfin isn't answering right now"), never the dashboard (#20's
  section contract). A one-minute, bounded, per-replica memory of answers
  is allowed by the stateless rule: losing it or replicas disagreeing only
  changes how fresh a widget is.
- **Our contract, Homarr's shape.** `lib/integrations/types.ts` follows
  Homarr's idea (an integration, capability interfaces such as a media
  server, a connection test) but no Homarr code is copied, so no Apache-2.0
  headers or NOTICE entry are needed. Jellyfin is called through its REST
  API directly (four endpoints, checked against its OpenAPI spec) rather
  than `@jellyfin/sdk`, which would bring axios for a handful of requests.
- **Observable.** A span per call and
  `portal_integration_request_duration_seconds{integration,operation,outcome}`.

## Alternatives Considered

### Alternative 1: Keys in the database, entered in the admin UI
- **Pros**: no redeploy to set one.
- **Cons**: a database dump or a read-only SQL bug leaks every key; keys
  pass through browsers.
- **Why not**: the portal already treats secrets as environment (and
  `_FILE`) settings; integrations follow suit.

### Alternative 2: Vendor Homarr's integrations package
- **Pros**: many integrations at once.
- **Cons**: it depends on Homarr's own core, Redis, database and tRPC.
- **Why not**: the issue already ruled it out; adapting the shape is enough.

### Alternative 3: Let the browser call Jellyfin
- **Pros**: no relay.
- **Cons**: needs the key in the browser (or Jellyfin's own session),
  widens the CSP, and exposes Jellyfin's address.
- **Why not**: server-side is the point.

## Consequences

### Positive
- Adding an integration is a type, a client implementing the contract, a
  settings row and a widget; the safety rules come with the shared fetch.

### Negative
- One more secret to manage per integration, and a redeploy to change it.

### Risks
- An admin can point the portal at an internal address (it's their
  network). Mitigation: admins only, plain http(s), fixed paths, no
  redirects, timeouts, and nothing returned but a widget's data.

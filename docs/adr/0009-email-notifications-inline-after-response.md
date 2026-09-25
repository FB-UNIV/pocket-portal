# ADR-0009: Email notifications sent inline, after the response

**Date**: 2026-09-24
**Status**: accepted
**Deciders**: François Bouju

## Context

Admins should be told about new access requests, and requesters told when
theirs is approved or denied. The channel is email, through
the portal's own `SMTP_*` settings, not PocketID's (it can't send on our
behalf, and its SMTP password is redacted once `UI_CONFIG_DISABLED` is on).
What's left is *how* to send without breaking the stateless rule
(`.claude/rules/pocketid-api.md`) or ever blocking the action itself.

## Decision

Send each notification from the server action through Next's `after()`,
scheduled only once the change it reports has committed. A failed send is
logged and dropped; no retry. Admin recipients are PocketID's `isAdmin`
users with an email, read live. With `SMTP_HOST` unset, nothing is sent.

## Alternatives Considered

### Alternative 1: Outbox table plus a sender loop
- **Pros**: survives a crash or deploy mid-send; retries.
- **Cons**: a poller on every replica, coordinated with `FOR UPDATE SKIP
  LOCKED`, a new table, and a retention policy — for a few emails a day.
- **Why not**: the in-app state (`/apps` request outcomes, the admin queue)
  already carries the same information, so a lost email costs a delay, not
  a missed decision. Worth revisiting if notifications gain a channel that
  is the only record of something.

### Alternative 2: Await the send inside the action
- **Pros**: simplest; the failure is visible to the caller.
- **Cons**: a slow or dead SMTP server stalls every approval.
- **Why not**: notifications must never block the action.

## Consequences

### Positive
- No new state: nothing a second replica needs to see.
- Actions stay as fast as today.

### Negative
- An email in flight when a replica stops is lost.
- Recipients come from PocketID at send time, one more admin API read per
  new request.

### Risks
- Silent loss. Mitigation: each failure is logged at `warn` with the
  request id, so it's visible in the logs a deployer already ships.
  Durable delivery (outbox, retry, metrics) is a tracked follow-up.

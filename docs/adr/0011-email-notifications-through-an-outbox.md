# ADR-0011: Email notifications through a Postgres outbox

**Date**: 2026-11-13
**Status**: accepted
**Deciders**: François Bouju
**Supersedes**: [ADR-0009](0009-email-notifications-inline-after-response.md)

## Context

[ADR-0009](0009-email-notifications-inline-after-response.md) sent each
access-request email inline, after the response, best-effort: one in
flight when a replica stopped (a deploy, a crash) was lost, a transient
SMTP failure was logged and forgotten, and failures were only visible in
the logs. Its own "Alternatives" named an outbox as the fix, worth it once
email mattered more than "a delay, not a missed decision" (#5).

Rolling deploys and several replicas (the HA goal) make "a replica stops
mid-send" routine rather than rare, and an admin who never hears about a
request is the main way one sits unanswered.

## Decision

Emails go through a `notification_outbox` table:

1. **Queue.** The action still schedules notification work with `after()`
   once the change has committed (unchanged from ADR-0009), but that work
   now resolves recipients, renders each email in its recipient's
   language, and *inserts* one row per recipient. Rendering at queue time
   means a retry sends exactly what would have been sent.
2. **Send now.** The same `after()` then drains the outbox once, so a
   healthy SMTP server delivers as promptly as before.
3. **Send later.** Every replica runs a small sender loop (every 30 s)
   that claims due rows with `FOR UPDATE SKIP LOCKED` and a lease
   (`locked_until`), so two replicas never claim the same row and a
   replica that dies mid-send releases its rows when the lease runs out.
4. **Retry.** A failed send is retried with backoff (1 min, 5 min, 30 min,
   2 h, 6 h). After the sixth attempt it is marked `failed`, counted in
   `portal_notifications_total{outcome="failed"}`, and written to the
   audit trail as `notification.failed`, so it appears on the admin
   History page under Problems.
5. **Prune.** Sent rows are deleted after 7 days, failed rows after 30:
   the outbox holds addresses and request messages, so it keeps them no
   longer than it needs.

`NOTIFY_ADMIN_EMAILS`, when set, replaces "every PocketID admin with an
address" as the recipients of new-request emails, so a new request no
longer needs a PocketID user listing.

## Alternatives Considered

### Alternative 1: Keep ADR-0009
- **Pros**: no table, no loop.
- **Cons**: the three gaps above.
- **Why not**: rolling deploys turn the lost-email case from rare to
  routine.

### Alternative 2: Queue inside the action's own transaction
- **Pros**: the email is durable the moment the change commits; nothing
  between the response and the insert can lose it.
- **Cons**: recipients and their languages come from PocketID and the
  preferences table, so the action would wait on PocketID before
  answering, which ADR-0009 rejected for good reason.
- **Why not**: the window it closes (a replica dying in the milliseconds
  between the response and the insert) is far smaller than the one the
  outbox closes (the seconds an SMTP send takes, plus every retry).

### Alternative 3: An external queue (Redis, a job runner)
- **Pros**: purpose-built.
- **Cons**: a new service to deploy and back up, for a few emails a day.
- **Why not**: Postgres is already the shared state, and `SKIP LOCKED` is
  what it's for.

## Consequences

### Positive
- An email survives a replica stopping, and a transient SMTP failure is
  retried.
- Failures are a metric and an audit event, not only a log line.
- Other channels (a webhook, Apprise) can be added as another kind of
  outbox row, with the same retries.

### Negative
- **At-least-once**: a replica that sends an email and dies before marking
  it sent lets another replica send it again once the lease expires. A
  duplicate email is the lesser failure.
- A new table that holds email addresses and request messages, pruned on
  the schedule above, and included in backups.
- A timer on every replica (one small query every 30 s when idle).

### Risks
- A long SMTP outage gives up after about 9 hours. Mitigation: each
  give-up is in History and the metric, and the request itself is still
  in the admin queue.

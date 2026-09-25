# ADR-0006: Audit trail as a dedicated Postgres table, separate from application logs

**Date**: 2026-09-20
**Status**: accepted
**Deciders**: François Bouju

## Context

The portal needs an audit trail of security/access-relevant events: logins,
access requests created, approved, or denied, and group-membership changes.
It would be tempting to derive this from the structured application logs
(ADR-0005), but logs are optimized for operational debugging — they get
rotated, sampled, or dropped by log pipelines, and aren't naturally
queryable by business fields like "who did what to whom."

## Decision

Add a dedicated `audit_log` table in the same Postgres instance already
planned for the app catalog and access requests (ADR-0003). Application
code writes an audit row directly, in the same transaction as the business
action where practical, at each of these event points: login, access
request created, request approved, request denied, group membership
changed. This is independent of the Pino/OpenTelemetry logging pipeline.

## Alternatives Considered

### Alternative 1: Derive audit history from structured logs
- **Pros**: no new schema, reuses ADR-0005's logging pipeline.
- **Cons**: logs can be rotated/sampled/lost depending on the log
  pipeline's retention policy; not designed for "who did what to whom"
  queries; mixing high-volume operational logs with low-volume,
  long-retention audit records makes both harder to reason about.
- **Why not**: audit trail needs guarantees (retention, queryability) that
  a general logging pipeline isn't designed to provide.

### Alternative 2: Use OpenTelemetry span attributes as the audit record
- **Pros**: single instrumentation surface.
- **Cons**: traces are typically sampled and short-retention in most
  backends (Tempo, Jaeger); not meant to be a system of record.
- **Why not**: same fundamental mismatch as Alternative 1 — traces are an
  operational/performance tool, not an audit ledger.

## Consequences

### Positive
- Audit trail survives independently of log/trace retention policies.
- Directly queryable via SQL (and later, the in-app "Audit log / activity
  feed" roadmap item) without depending on a log aggregator being up.
- Naturally ties to the same transaction as the action it records (e.g. an
  approval and its audit row commit together).

### Negative
- One more table/write path to maintain; every new sensitive action needs
  a deliberate audit-write call, not automatic coverage the way logging
  middleware can be.

### Risks
- Forgetting to add an audit write for a new sensitive action is a silent
  gap. Mitigation: code review checklist item, and cover audit writes with
  tests the same way any other business logic is TDD'd.

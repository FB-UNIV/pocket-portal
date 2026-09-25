# Architecture Decision Records

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-launcher-not-gateway.md) | Portal is a launcher, not an access gateway | accepted | 2026-09-20 |
| [0002](0002-self-service-access-requests.md) | Self-service access requests with in-app admin approval | accepted | 2026-09-20 |
| [0003](0003-postgres-for-catalog-and-requests.md) | Postgres as the external datastore for the app catalog and access requests | accepted — partially superseded by [0007](0007-pocketid-live-catalog.md) | 2026-09-20 |
| [0004](0004-portal-oidc-login.md) | Portal authenticates end users via PocketID OIDC | accepted | 2026-09-20 |
| [0005](0005-observability-stack.md) | Observability stack — Pino, OpenTelemetry, prom-client | accepted (amended 2026-09-22) | 2026-09-20 |
| [0006](0006-audit-trail-separate-from-logs.md) | Audit trail as a dedicated Postgres table, separate from application logs | accepted | 2026-09-20 |
| [0007](0007-pocketid-live-catalog.md) | PocketID OIDC clients are the live app catalog, not a Postgres copy | accepted | 2026-09-21 |
| [0008](0008-semantic-versioning.md) | Adopt Semantic Versioning for releases | accepted (amended 2026-09-22) | 2026-09-21 |
| [0009](0009-email-notifications-inline-after-response.md) | Email notifications sent inline, after the response | accepted | 2026-09-24 |

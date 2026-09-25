# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see
[`.claude/rules/versioning.md`](.claude/rules/versioning.md) for the
project-specific policy on when to bump what.

## [Unreleased]

### Fixed
- The app list crashed with a `TypeError` on PocketID before 2.15.0, which
  lists OIDC clients without their allowed groups. The portal now needs
  **PocketID 2.15.0 or later**: it logs an error at startup naming both
  versions when PocketID is older, and fails with that message instead of
  crashing.

## [1.0.0-rc.1] - 2026-09-25

> **Upgrading:** the project is now **pocket-portal**. The image moves to
> `ghcr.io/fb-univ/pocket-portal`, `QUICHE_WORLD_TAG` becomes
> `POCKET_PORTAL_TAG`, the example config file is
> `pocket-portal.example.yaml`, and the Helm chart (renamed `pocket-portal`)
> moves to its own repository,
> [pocket-portal-helm](https://github.com/FB-UNIV/pocket-portal-helm), with
> its own releases. The compose defaults for the
> database change too (`POSTGRES_USER` `portal`, `POSTGRES_DB`
> `pocket_portal`).
>
> **An existing deployment doesn't carry its data over in place.** The
> rename also renames where the data lives: compose moves to a new volume
> (`pocket-portal_postgres-data`), and the chart's bundled Postgres to a
> new PVC. Upgrade by migrating the data: back up the old deployment
> *before* upgrading, start the new one, and restore into it (compose and
> Helm commands in `docs/RUNBOOK.md`, "Backups"). A deployment that uses its own
> database through `DATABASE_URL` (compose without the bundled Postgres,
> or the chart with `postgresql.enabled: false`) is unaffected.

### Added
- The portal's name is configurable: `PORTAL_NAME` (or `branding.name` in
  the config file) sets what the header, home page and page titles show.
  Unset, the portal takes the application name set in PocketID, unless
  it's still PocketID's default "Pocket ID", and otherwise its own. With
  `FEATURE_POCKETID_BRANDING` on, a PocketID's name, colour and logo now
  all carry over.
- arm64 images alongside amd64.
- Images are signed with cosign (keyless); `docs/RUNBOOK.md` shows how to
  verify one.

### Changed
- Image tags follow common practice for public images. `latest` is now the
  newest **stable release**, no longer the newest `main` build; `main`
  builds are tagged `dev-<sha>` and `dev` instead of the bare commit SHA.
  A stable release also moves `vX.Y` and `vX`; a pre-release
  (`vX.Y.Z-rc.N`) gets only its own tag. If you deployed `latest` or a
  bare SHA, pin a `vX.Y.Z` instead.

## [0.11.0] - 2026-09-25

> **Upgrading:** nothing required. New security headers mean the portal can
> no longer be shown in an iframe, and `/_next/image` is gone (the portal
> never used it). Kubernetes deployers can now use the Helm chart in
> `deploy/helm/pocket-portal`.

### Added
- Project governance: `SECURITY.md` (private reporting), `CODE_OF_CONDUCT.md`,
  `CODEOWNERS` (with agent-instruction files called out), and issue and PR
  templates.
- A Helm chart (`deploy/helm/pocket-portal`) for Kubernetes: replicas with a
  PodDisruptionBudget, config from a ConfigMap, secrets from a Secret or an
  existing one, migrations in an init container, health and readiness
  probes, an optional Ingress, and an optional single Postgres for trying
  it out. CI lints it, validates it against the Kubernetes schemas, and
  installs it on kind.
- The remaining feature flags, all on by default:
  `FEATURE_EMAIL_NOTIFICATIONS` (pause emails, keeping SMTP settings),
  `FEATURE_POCKETID_BRANDING` (keep the portal's own look),
  `FEATURE_AUDIT_LOG_PAGE` (hide `/admin/audit`; events are still
  recorded) and `WARN_POCKETID_SECRETS_READABLE` (hide the admin banner;
  the startup log still warns). Each also has a `features:` key in the
  config file.

### Changed
- Licensed under AGPL-3.0-or-later (`LICENSE`).
- The image no longer ships Next's optional image optimiser (`sharp` and
  its LGPL-3.0 libvips binaries): the portal never used it. Less native
  code, a smaller image, and `/_next/image` is no longer served.

### Security
- A user can file at most 5 access requests (new or reopened) per hour,
  since each one emails every admin. Counted in Postgres from the audit
  trail, so it holds across replicas; the form explains the refusal.
- Upgraded nodemailer from 8.0.11 to 10.0.10, fixing five advisories
  (GHSA-p6gq-j5cr-w38f, GHSA-8m3c-c648-2xjj, GHSA-wmmp-3585-3rmp,
  GHSA-2x7j-588g-ccc2, GHSA-cc9r-2j5m-2m83). The one plausibly reachable
  here was a CPU-exhaustion bug in address parsing. CI now fails on high
  severity advisories in production dependencies.
- Security headers on every response: a per-request Content-Security-Policy
  with a nonce and `frame-ancestors 'none'`, plus `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy` and
  `Permissions-Policy`. `X-Powered-By` is gone. Pages can no longer be
  framed, so the admin Approve button can't be clickjacked. HSTS stays with
  your TLS proxy.
- In production, startup reports any secret that is one of this
  repository's published test values (`.env.test`, CI), and an
  `AUTH_SECRET` shorter than 32 characters.

## [0.10.0] - 2026-09-25

> **Upgrading:** nothing required. Everything below is optional and off or
> unchanged by default. New: settings can come from a YAML file
> (`CONFIG_FILE`), and the image reads secrets from `NAME_FILE` paths.

### Added
- Feature flags `FEATURE_ACCESS_REQUESTS` (`false` makes the portal a plain
  launcher that lists only apps the user can open; pending requests can
  still be decided) and `ACCESS_REQUEST_REASON` (`optional`, `required` or
  `off`). Unrecognised values fall back to the default and are logged at
  startup.
- An optional YAML config file (`CONFIG_FILE`, see
  `pocket-portal.example.yaml`) for every non-secret setting. Environment
  variables still win; secrets are refused in the file. The image also
  reads secrets from `NAME_FILE` paths (Docker/Kubernetes secrets).

### Changed
- Every configuration problem is logged at startup, all at once, instead of
  surfacing one at a time on first use. An invalid `LOG_LEVEL` now falls
  back to `info` instead of crashing every module that logs.

## [0.9.0] - 2026-09-24

> **Upgrading:** migration 0009 (two `audit_log` indexes) applies on start
> unless `MIGRATE_ON_START=false`. Email is off until you set `SMTP_HOST`
> and `SMTP_FROM`; see the README's configuration table.

### Added
- An admin **Audit Log** page (`/admin/audit`) listing every access request
  and decision, newest first, filterable by action, including grants that
  were refused or failed and why. Adds migration 0009: indexes on
  `audit_log (created_at, id)` and `(action, created_at, id)`.
- The portal picks up PocketID's branding: its logo in the header, and its
  accent colour on primary buttons. The accent is converted to sRGB and
  paired with black or white text, whichever reads better, so it can't
  bring back a contrast failure. PocketID's default accent leaves the
  portal's own look unchanged.
- Email notifications, off unless `SMTP_HOST` is set: PocketID admins hear
  about a new or reopened access request, and requesters hear when theirs
  is approved or denied. Sent after the response and best-effort, so mail
  trouble never blocks or fails a request (ADR-0009).

### Fixed
- The admin queue offers only Deny for a request that can't be granted (its
  app is hidden, or its group was removed in PocketID), and a refused
  approval is explained on the row instead of as "Something went wrong".

## [0.8.0] - 2026-09-24

> **Action required if you scrape metrics:** `/api/metrics` is now closed by
> default. Set `METRICS_TOKEN` and add it to your scraper, e.g. Prometheus
> `authorization: { credentials: <token> }`. Until then every scrape gets a
> 404.

### Changed
- `/api/metrics` is served only to requests bearing `METRICS_TOKEN`, and to
  nobody when it is unset. It used to expose the exact Node version, memory,
  uptime and event-loop lag to anyone who could reach the portal. The
  startup log says whether metrics are enabled.

### Security
- Approving an access request for an app an admin has hidden is refused and
  audited, like a request for a group the app no longer allows. A request
  filed before its app was hidden could otherwise still become a PocketID
  group grant.
- Replaying an old session cookie can no longer make every request call
  PocketID's admin API, nor bring back groups or admin rights PocketID has
  since revoked. The refresh throttle and the last verified claims now live
  in Postgres (new `session_claims` table, applied by the usual migration),
  not in the cookie.
- Admin rights lapse after 15 minutes without a successful check against
  PocketID, e.g. through an outage, until a check succeeds. Groups are kept,
  so users can still launch their apps.

## [0.7.0] - 2026-09-24

### Added
- Startup warning and `/admin` banner when PocketID runs without
  `UI_CONFIG_DISABLED=true`, i.e. its SMTP/LDAP passwords are readable by the
  portal's API key.
- `/apps` now tells a requester what happened to their access request.
  A denial is shown as denied and stays re-requestable; an approval is shown
  as approved, with a note that it may take a few minutes to take effect or a
  sign out and back in.

### Security
- App launch URLs are restricted to `http:` and `https:`. PocketID stores
  any string as a client's launch URL, and a `javascript:` one used to render
  as a live "Open" link in the portal's own origin. A rejected URL is treated
  as no launch URL: the app is not browsable, and `/admin/apps` says so.

### Fixed
- Instances with more than 20 OIDC clients, groups or users no longer lose
  the rest silently. PocketID's list endpoints are paginated and the portal
  only ever read the first page, so apps went missing from the catalog and
  grants for real groups could be refused.
- Submitting an access request that can't go through — one already pending
  or approved, access already held, a group no longer requestable, or an
  over-long reason — now explains why on the app's card. It used to show the
  generic "Something went wrong" page with a reference number, e.g. from a
  second browser tab still showing the old form.
- Requesting access again after an admin approved it no longer fails with an
  opaque error. The grant was always applied correctly — the session's group
  list just lagged by up to one refresh interval, so the page kept offering a
  request that could not succeed.
- Access that was approved and later revoked in PocketID can be requested
  again. The approved request is reopened in place rather than duplicated,
  keeping one request per user, app and group.
- `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` and
  `OTEL_EXPORTER_OTLP_PROTOCOL` in `.env` now reach the container; the
  reference compose file silently dropped them.

## [0.6.0] - 2026-09-22

The portal can now be deployed by someone other than its author: a
reference `docker-compose.yml`, a documented contract, and migrations that
actually run from the published image.

### Added
- **Reference deployment**: `docker-compose.yml` brings up the portal
  and its Postgres, with `.env.example` as the configuration contract.
  PocketID stays external on purpose — an identity provider should not be
  an unbacked side-car of the app consuming it. No hosting target is baked
  in; the repo ships a contract, not a prescription.
- **Migrations run from the published image.** Previously impossible: the
  migration files were not in the image, `drizzle-kit` is a devDependency,
  and the runtime stage deliberately has no npm. The image now carries
  `drizzle-orm`'s migrator and applies migrations on start
  (`MIGRATE_ON_START`, default on), guarded by a Postgres advisory lock so
  concurrent replicas serialise. `docker compose run --rm portal migrate`
  applies them without starting the server.
- **Health endpoints**: `/api/health` (liveness, no dependencies) and
  `/api/ready` (probes Postgres and PocketID, 503 with a per-dependency
  breakdown). The image declares a `HEALTHCHECK` against the former.
- **`AUTH_URL`** pins the portal's public origin. Without it Auth.js trusts
  the incoming `Host` header, so a proxy forwarding an attacker-controlled
  Host could steer the OIDC callback. The portal now warns at startup when
  it is unset in production.
- A CI job that boots the reference stack and asserts it actually serves —
  a compose file that merely parses proves nothing.

### Changed
- `npm run db:migrate` reads `DATABASE_URL` from the environment instead of
  hardcoding `.env.test`, so it can target a real database.
- `docker-compose.test.yml` is namespaced `pocket-portal-test`. Both compose
  files previously resolved to the same project name, so bringing up the
  reference stack would adopt and recreate the test containers, destroying
  seeded data.
- `docs/RUNBOOK.md` rewritten around the contract: reverse-proxy
  requirements, health checks, migration hazards, rollback and backups.
- ADR-0005 amended: the app emits signals (Prometheus text, JSON on stdout,
  OTLP); what consumes them is the deployer's choice. It previously assumed
  a specific Prometheus/Grafana/Loki/Tempo stack.

### Fixed
- `scripts/migrate.mjs` resolves paths with `fileURLToPath` rather than
  `URL.pathname`, and its direct-execution guard normalises both sides. The
  old string comparison broke on any path containing a space — and failed
  silently, exiting 0 having migrated nothing.

## [0.5.0] - 2026-09-22

An accessibility and polish pass over the whole portal UI, and a persistent
site header so pages stop being navigational dead ends.

### Added
- A site header on every rendered page route: a banner landmark with the portal's
  nav (My Access, Apps, and the two admin sections for admins) and sign-out.
  Previously the only way into `/apps` or `/admin/*` was the home page.
- A skip link as the first focusable element on every page (WCAG 2.2
  SC 2.4.1), targeting the `#main-content` landmark each page now renders.
- Error and not-found boundaries. A server action that throws — for
  instance requesting access you already hold — used to render an unstyled
  crash page with no way back; it now announces the failure, offers a retry
  and a link home, and shows only the error digest, never the raw message.
  A `global-error` boundary covers the root layout too, which `error.tsx`
  structurally cannot reach and which now calls `auth()` on every request.

### Changed
- Every route has its own page title (SC 2.4.2); the app had been serving
  "Create Next App" on all of them since it was bootstrapped.
- Repeated row controls ("Open", "Show"/"Hide", "Approve"/"Deny") now carry
  an accessible name saying which app or requester they act on (SC 4.1.2),
  and the "Pending" badge names the group it is pending for.
- Access-request timestamps render as "21 Sep 2026, 10:00 UTC" rather than
  a raw ISO-8601 string, with the machine value kept in `<time datetime>`.
- The home page keeps its two entry points as a landing call to action and
  drops the nav links now carried by the header.

### Fixed
- Text colours that fell below SC 1.4.3's 4.5:1 contrast: request
  timestamps and the "No message provided" placeholder (2.56:1 on white,
  4.35:1 in dark mode), the "no launch URL" admin warning (3.19:1), and the
  pending badge, which had no dark-mode variant.
- Focus indicators are now drawn in the foreground colour with an offset
  (>= 15:1 against the page in both themes); the browser default was
  invisible on the dark filled buttons (SC 2.4.7).
- `body` was pinned to Arial by a create-next-app leftover, so the Geist
  fonts the layout loads were downloaded and never applied.
- Page gutters are responsive (`px-6 sm:px-16`); they were a flat 64px,
  which crowded the content on a phone.

## [0.4.1] - 2026-09-22

### Fixed
- `requestAccessAction` now refuses a request for access the user already
  holds, or a group they already have a pending/approved (non-denied)
  request for — server-side, so a tampered or repeated submission
  can't clutter the admin approval dashboard. Re-requesting after a denial
  is still allowed. The "one active request" rule is enforced atomically
  by a DB constraint (widened from "one pending" to "one non-denied"), not
  just the application-level check, so a submission racing an admin's
  approval of the same request can't slip past it and create a duplicate.
  A migration reconciles any pre-existing rows that would violate the
  tightened constraint before applying it.

## [0.4.0] - 2026-09-21

A newly-granted app now shows up for the signed-in user, and a revoked app
disappears from their available apps, without signing out and back in.

### Changed
- Session groups and admin status refresh from PocketID periodically (every
  5 minutes) instead of staying fixed at whatever they were at login.
  An approval's group grant, or a revoke, now takes effect within one
  refresh cycle. Fails open on a transient PocketID outage (keeps the
  existing token contents rather than dropping access mid-session) and
  retries on the next refresh.

## [0.3.0] - 2026-09-21

Approving an access request now actually grants it — the request/approve loop
is functional end to end, and every lifecycle transition is audited.

### Added
- Approving a pending request performs the real PocketID group-membership
  grant. The request's status only moves to `approved` if the grant
  succeeds, so the record never claims access that wasn't given; a failed
  grant leaves the request `pending` and is audited. The grant is a
  read-modify-write (PocketID has no append endpoint), so it adds the group
  without disturbing the user's other memberships, and is idempotent.
- Full audit trail of the access-request lifecycle: `access_request.created`
  on submission, and `access_request.approved` / `access_request.denied` on the
  admin decision (plus `grant_failed` / `grant_rejected`), in the audit log.

### Security
- Defense-in-depth allowlist guard on approval: the grant target is re-derived
  from the stored request (never the submitted form) and refused unless it is
  still a real, requestable group of its client — a tampered or stale row can't
  be approved into an arbitrary or privileged group grant. Scoping down the
  admin-level PocketID credential the portal uses for writes is tracked as a
  follow-up.

## [0.2.0] - 2026-09-21

The self-service access-request feature (ADR-0002), end to end: users can
find apps they don't have yet and ask for them; admins review and decide
in-portal. Approving records the decision but does not yet perform the
PocketID group grant — that write lands in a later release.

### Added
- Browse view (`/apps`) listing every app a user could reach, with a
  self-service "Request access" form per allowed group; already-pending
  requests are shown as such instead of re-submittable.
- Optional free-text message on an access request, so a requester can say
  why they need access; it's shown to the admin reviewing the request.
- Admin approval dashboard (`/admin/requests`) listing pending requests
  oldest-first with approve/deny actions; a decision is guarded so a stale
  click can't overwrite one already made.
- Admin navigation links on the home page (App Catalog, Access Requests),
  shown only to admins.

## [0.1.0] - 2026-09-21

Initial state of the project as of adopting semantic versioning — not a
single release, but a baseline snapshot of everything shipped so far.

### Added
- Next.js (App Router, TypeScript) portal scaffold, stateless by design.
- Sign-in via PocketID OIDC, with NextAuth/Auth.js session handling (ADR-0004).
- "My Access" view showing the signed-in user's PocketID group memberships.
- App catalog read live from PocketID's own OIDC clients, with an
  admin-only hide/show override table in Postgres (ADR-0007).
- Postgres-backed audit trail, kept separate from application logs (ADR-0006).
- Observability stack: structured logging (Pino), distributed tracing and a
  Prometheus metrics endpoint (OpenTelemetry, prom-client) (ADR-0005).
- CI: unit tests with coverage gate, integration/e2e tests against real
  PocketID + Postgres, SBOM freshness check, Semgrep static analysis,
  Docker image build with Trivy scanning and SBOM/provenance attestations,
  published to `ghcr.io` on every push to `main`.
- Dependabot for npm, Docker base image, and GitHub Actions updates.
- 7 ADRs (`docs/adr/`) recording the architectural decisions behind the
  portal's shape.

### Changed
- App catalog moved from a synced Postgres copy to live PocketID reads,
  superseding half of ADR-0003 (ADR-0007).

### Fixed
- Postgres test container healthcheck now targets the correct database
  name; migrations apply automatically on `test-env:up`.

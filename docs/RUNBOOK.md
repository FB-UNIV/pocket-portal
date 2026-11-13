# Runbook

> **There is no fixed deployment target, by design.** This project is
> meant to be open-sourced, so a host baked into these docs would be a
> host every other deployer has to undo. What follows is a **contract**
> plus two reference deployments that run unmodified and are meant to be
> adapted: `docker-compose.yml` and the [Helm chart](#kubernetes), which
> lives in its own repository.
>
> Everything here is verified against the published image and the
> reference stack, not aspirational. Sections that are genuinely the
> deployer's decision say so rather than guessing on your behalf.

## The artifact

| Property | Value |
|---|---|
| Registry | `ghcr.io/fb-univ/pocket-portal` |
| Platforms | `linux/amd64`, `linux/arm64` |
| Signed | cosign keyless, by `docker-build.yml` (see [Verifying an image](#verifying-an-image)) |
| Base image | `node:24-alpine`, multi-stage, `apk upgrade` in the runtime stage |
| Runs as | non-root `nextjs` user |
| Entrypoint | `/app/docker-entrypoint.sh`, default command `node server.js` |
| Port | `3000` (`EXPOSE 3000`, `PORT=3000`, `HOSTNAME=0.0.0.0`) |
| Healthcheck | `/api/health`, 30s interval, 180s start period |
| Volumes | none required; the portal is stateless and only Postgres holds state. Optionally a read-only config file (`CONFIG_FILE`) |
| Secrets | as env vars, or `NAME_FILE` pointing at a mounted file (e.g. `AUTH_SECRET_FILE`), resolved by the entrypoint |

Tags published:

| Tag | When | Meaning |
|---|---|---|
| `vX.Y.Z` | only on `git push origin vX.Y.Z` | A release. Never moves. See [Releases](#releases). |
| `vX.Y`, `vX` | each stable release | The newest release in that minor or major line; moves as patches (or minors) ship. |
| `latest` | each stable release | The newest stable release. Never a `main` build or a pre-release. |
| `vX.Y.Z-rc.N` (any `-` suffix) | on `git push origin vX.Y.Z-rc.N` | A pre-release. Gets only its own tag: never `vX.Y`, `vX` or `latest`. |
| `dev-<full-40-char-sha>` | every push to `main` | One commit's image, unreleased. Pushed **before** its scan; a release re-scans it. |
| `dev` | push to `main`, **after** the scan passes and the image is signed | The newest `main` build. Unreleased code: for testing only. |

Pin a `vX.Y.Z` in production. `vX.Y` and `vX` take updates without editing
the pin but move under you; `dev` moves on every merge.

### Verifying an image

Every published image is signed with [cosign](https://docs.sigstore.dev/)
keylessly: the signature is tied to this repository's release workflow,
not to a key. To check one before deploying it:

```bash
cosign verify ghcr.io/fb-univ/pocket-portal:vX.Y.Z \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/FB-UNIV/pocket-portal/\.github/workflows/docker-build\.yml@refs/(heads/main|tags/v.+)$'
```

## Quick start

The deployment steps are in the [README](../README.md#deploy-it): clone,
configure, `docker compose up -d`. The required variables use compose's
`:?` syntax, so a missing one fails immediately with a named error rather
than starting a half-configured portal.

## Configuration

Every variable is listed in the [README](../README.md#configuration) and
explained in [`.env.example`](../.env.example). The registry in
`src/lib/config.ts` is the source of truth, and tests keep both in step
with it.

Settings resolve **environment > config file > default**:

- **Config file.** `CONFIG_FILE` names an optional YAML file for the
  portal's non-secret settings; see [`pocket-portal.example.yaml`](../pocket-portal.example.yaml).
  `MIGRATE_ON_START` (read by the entrypoint first), `OTEL_*` and the
  compose-only variables stay environment-only.
  It's read at startup, so a change needs a restart. A file that is set but
  can't be read stops the portal (exit 1).
- **Secrets** come from the environment or, in the image, from
  `NAME_FILE=/run/secrets/…`. Setting both `NAME` and `NAME_FILE` stops the
  container.
- **At startup** every problem is logged at once as `Configuration: …`, and
  any feature flag set away from its default in one `Feature flags: …`
  line.

Required for any page to render — the root layout calls `auth()` on every
request, so missing PocketID configuration produces a 500, not a degraded
page: `POCKETID_BASE_URL`, `POCKETID_API_KEY`, `POCKETID_OIDC_CLIENT_ID`,
`POCKETID_OIDC_CLIENT_SECRET`, `AUTH_SECRET`, `DATABASE_URL`.

Two that matter across replicas:

- **`AUTH_SECRET` must be identical on every replica**, or a session cookie
  issued by one is rejected by another.
- **`AUTH_URL` should be set in production.** Without it Auth.js falls back
  to trusting the incoming `Host` header, so a proxy forwarding an
  attacker-controlled `Host` can steer the OIDC callback. It must match the
  callback origin registered in PocketID. The portal logs a warning at
  startup when it is unset in production.

### PocketID: version 2.15.0 or later

Earlier versions list OIDC clients without their allowed groups (only a
count), which the portal needs to decide who can open what: the app list
and access requests fail. At startup the portal reads PocketID's version
(`/api/version/current`, with its API key) and logs an error naming both
versions if PocketID is too old. CI tests against PocketID 2.16.0.

### PocketID: set `UI_CONFIG_DISABLED=true`

Set on **PocketID**, not the portal.

**Why:** the portal's API key is a PocketID admin key. On a default PocketID
it can read `smtpPassword` and `ldapBindPassword` in plaintext via
`/api/application-configuration/all`. PocketID masks them only when this flag
is on. The portal
never reads them.

**Cost:** PocketID's settings (SMTP, LDAP, branding) move from its admin UI
to [env vars](https://pocket-id.org/docs/configuration/environment-variables#overriding-the-ui-configuration).
Copy your current settings over before switching. Use `*_FILE` variants for
secrets.

**Check:**

```bash
curl -sSf -H "X-API-KEY: $POCKETID_API_KEY" \
  "$POCKETID_BASE_URL/api/application-configuration/all" \
  | grep -oE '"key":"(smtpPassword|ldapBindPassword)"[^}]*' \
  || echo "Check failed: request error or keys missing"
```

Values should be `XXXXXXXXXX` or empty.

### The PocketID API key

**What it can do.** A PocketID API key "acts with the rights of the admin
who created it" ([PocketID API docs](https://pocket-id.org/docs/api)): it
can create users and groups and change any membership, not just what the
portal needs. The portal reads OIDC clients, users and groups, and its one
write is adding a user to a group when an admin approves a request, and
only for a group of an app the portal shows. PocketID has no narrower key
yet; #4 tracks using one when it does.

**Store it as a secret.** Use `POCKETID_API_KEY_FILE` pointing at a Docker
or Kubernetes secret rather than an environment variable in a compose file
or a manifest. Create the key under PocketID's **Administration → API
Keys** with an **Expires At** date you'll be reminded of. (A PocketID set
up declaratively may use `STATIC_API_KEY` instead; then the same value
goes on both sides.)

**Rotate it** before it expires, or at once if it may have leaked:

1. Create a new key in PocketID (the old one keeps working meanwhile).
2. Update the portal's secret and restart the portal. A rolling restart
   is enough: the portal is stateless, and the secret is read at start.
3. Check: `/api/ready` reports PocketID ok, and
   `portal_pocketid_request_duration_seconds_count{outcome="4xx"}` isn't
   climbing (a rejected key is a 401).
4. Remove the old key in PocketID, or, if your PocketID can't, let it
   expire.

**Where it isn't.** The key travels only in the `X-API-KEY` header to
PocketID. Checked on a real build across the whole e2e suite (thousands of
exported spans, dozens of keyed PocketID calls): no trace and no log line
carries the key, the header, or the OIDC client secret. Traces never carry
query strings (the OIDC callback's holds the sign-in code), and the logger
redacts API keys, passwords, secrets, tokens and authorization headers
should one ever be passed to it.

**Watch it.** Grants are counted and worth an alert; see the examples in
[Portal metrics](#portal-metrics). The portal can only count what it does:
a membership change made with its key elsewhere shows up only in
PocketID's own audit log. To keep a privileged group from ever being
granted through the portal, don't make it an allowed group of an app
people can ask for (or hide that app on `/admin/apps`): the portal only
grants groups of apps it shows.

## Kubernetes

The Helm chart in [pocket-portal-helm](https://github.com/FB-UNIV/pocket-portal-helm) maps the contract above onto
Kubernetes:

- **Config**: `config:` becomes the YAML config file, in a ConfigMap.
- **Secrets**: one Secret, with the portal's variable names as keys.
- **Migrations**: an init container runs `migrate` before each pod, and the app runs with `MIGRATE_ON_START=false`.
- **Probes**: `/api/health` for startup and liveness, `/api/ready` for readiness.
- **HA**: `replicaCount` above 1, with a PodDisruptionBudget. No sticky sessions are needed.

The bundled Postgres is for trying it out. It has no backups, so in production point `secrets.databaseUrl` elsewhere.
The chart has its own version and releases; its CI lints it, validates it against the Kubernetes schemas, and installs it on a kind cluster.

## Reverse proxy contract

The portal is a launcher, not a gateway ([ADR-0001](adr/0001-launcher-not-gateway.md)),
so a proxy in front of it terminates TLS **for the portal only** — it never
sits in front of your other apps.

What the proxy must do:

1. **Terminate TLS.** The portal speaks plain HTTP on 3000 and has no TLS
   support of its own.
2. **Forward a correct `Host`**, or set `AUTH_URL` and make the header
   irrelevant. Doing both is fine and is what we recommend.
3. **Set `X-Forwarded-Proto: https`**, so redirects and cookie `Secure`
   handling resolve to https rather than http.
4. **Not be bypassable.** The reference compose binds the portal to
   `127.0.0.1` for this reason; if the container port is reachable from the
   network, the proxy's guarantees are optional.
5. **Send `Strict-Transport-Security`**, e.g. `max-age=31536000`. Only the
   proxy knows the portal is served over HTTPS, so the portal doesn't set
   it. The portal sets everything else itself: a per-request CSP with
   `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`,
   `Referrer-Policy` and `Permissions-Policy`.

Caddy:

```caddyfile
portal.example.test {
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
location / {
    add_header         Strict-Transport-Security "max-age=31536000" always;
    proxy_pass         http://127.0.0.1:3000;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

Traefik (compose labels on the `portal` service):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.portal.rule=Host(`portal.example.test`)
  - traefik.http.routers.portal.tls=true
  - traefik.http.middlewares.portal-hsts.headers.stsSeconds=31536000
  - traefik.http.routers.portal.middlewares=portal-hsts
  - traefik.http.services.portal.loadbalancer.server.port=3000
```

Whatever you use, register `https://<your origin>/api/auth/callback/pocketid`
as the OIDC client's callback URL in PocketID, and set `AUTH_URL` to the
same origin.

## Health checks

| Endpoint | Meaning | Use for |
|---|---|---|
| `/api/health` | Liveness. Touches nothing. 200 whenever the process serves. | Docker healthcheck, k8s `livenessProbe`, uptime monitoring |
| `/api/ready` | Readiness. Probes Postgres and PocketID. 200 or 503 with a per-dependency breakdown. | Load balancer membership, k8s `readinessProbe` |

Keep them in their lanes. A liveness probe wired to `/api/ready` will
restart healthy instances during a PocketID outage, turning a dependency
blip into a self-inflicted outage.

Both are unauthenticated so probes can reach them, and both deliberately
return terse errors — never the driver's, which carries hosts, ports and
sometimes credentials. `/api/ready` is bounded (2s per dependency) so a
wedged dependency fails fast instead of hanging the probe.

`/api/metrics` is telemetry, not a health signal, and is closed unless
`METRICS_TOKEN` is set (see [Observability](#observability)).

## Database migrations

Migrations ship inside the image and run automatically on start.

```bash
docker compose run --rm portal migrate     # apply only, then exit
MIGRATE_ON_START=false docker compose up   # skip on start
```

Concurrent replicas are safe: the runner takes a Postgres advisory lock, so
they serialise rather than racing the same DDL. It polls
`pg_try_advisory_lock` with a 60s deadline and fails with a clear message
rather than waiting forever.

### Hazards that are yours to manage

The lock solves concurrency. These are inherent and no amount of tooling
removes them:

- **A failed migration is a crash loop, not a degraded app.** The
  entrypoint exits non-zero and the container restarts. Arguably correct —
  new code on an old schema is broken too — but it is a real change from
  "app keeps serving".
- **Rolling the image back does not roll the schema back, and it fails
  silently.** An older image simply finds nothing to apply and starts
  against a newer schema. Real example from this repo:
  `0006_widen-active-access-request-unique.sql` widened a unique
  constraint; roll back past it and the code's duplicate-request
  assumptions no longer match what the database enforces. Nothing errors.
- **A destructive migration makes rollback one-way.** Drizzle generates no
  down migrations. Plan the reversal *before* shipping a migration that
  drops or rewrites data.
- **Rolling updates run two schema versions at once.** Old and new pods
  overlap, so a migration must be backward-compatible with the previous
  app version for the duration (expand/contract).
- **Do not set an aggressive liveness probe during migrations.** The server
  does not listen until they finish; killing it mid-migration loops
  forever. The image's 180s start period accounts for the 60s lock wait
  plus migration time; match it if you configure your own. (The Helm chart
  runs migrations in an init container, before any probe starts.)

## Rollback

Every image is addressable by an immutable tag, so rollback is a
redeploy, not a rebuild:

1. Pick the last known-good reference — a previous `vX.Y.Z`, or a `dev-<sha>` tag.
2. Set `POCKET_PORTAL_TAG` to it and `docker compose up -d`.
3. **Check migrations.** See the hazards above: the schema does not roll
   back with the image.

## Releases

Full process: [`.claude/rules/versioning.md`](../.claude/rules/versioning.md).
The two operationally important parts:

- Wait for `docker-build.yml`'s `build` job to finish on `main` **before**
  pushing the tag. Tagging early makes `promote-release` fail, and pushing
  the same tag again does **not** re-trigger it — re-run the failed job.
- `promote-release` re-scans the image with Trivy against the current
  vulnerability database before retagging. A commit clean at build time can
  legitimately fail promotion later as new CVEs land.
- A tag with a `-` suffix (`v1.0.0-rc.1`) is a pre-release: it's published
  under its own tag only, so `latest`, `vX` and `vX.Y` stay on the last
  stable release. Use one to try the release pipeline end to end.
- A floating tag only moves forward: a release moves `vX.Y`, `vX` or
  `latest` only if it's the newest stable release in that range. So
  `v1.4.1` after `v2.0.0` never moves `latest`; it moves `v1` only if it's
  the newest `v1.*`, and `v1.4` only if it's the newest `v1.4.*`.

## Observability

The app emits signals and does not care what consumes them
([ADR-0005](adr/0005-observability-stack.md)):

| Signal | Where | Notes |
|---|---|---|
| Metrics | `GET /api/metrics`, Prometheus text | Off unless `METRICS_TOKEN` is set; then send it as `Authorization: Bearer <token>` (Prometheus: `authorization: { credentials: <token> }` in the scrape config). Anything else gets a 404. The startup log says which state the instance is in. Exposes Node.js process metrics (CPU, memory, heap, event-loop lag, GC) and, for every request, `http_requests_total` and `http_request_duration_seconds` labelled by `method`, `status_code` and `route`, the matched route *pattern* (`/apps`, `/api/auth/[...nextauth]`, `/_not-found`), never the raw path. Counted whatever `LOG_REQUESTS` says. Plus the [portal's own metrics](#portal-metrics): access requests, grants, notification emails and PocketID API latency. Each replica exposes its own; see [per-route latency](#per-route-latency) for a query. |
| Logs | stdout: JSON (Pino) by default, or `LOG_FORMAT=pretty` for one readable line per entry | `docker compose logs`, or ship them anywhere that reads container stdout. `LOG_LEVEL` controls verbosity. One line per request (method, path, status, duration; `LOG_REQUESTS=false` turns it off), with health checks at `debug`. **Every server error** is logged with its stack and the *digest* a user's error page shows, so "digest 123" leads straight to it. Startup logs every configuration problem (`Configuration: …`), an outdated PocketID and any non-default feature flags. Emails go through an outbox and are retried ([ADR-0011](adr/0011-email-notifications-through-an-outbox.md)): a failed attempt is logged at `warn` with its request id and when it'll be retried, and an email given up on after the last attempt at `error`, as well as on the admin History page. Every line written during a request, the request line included, carries `trace_id` and `span_id`; see [linking logs and traces](#linking-logs-and-traces). |
| Traces | OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT` | Always on: each request is a trace, with Next.js's spans (middleware, rendering, route handlers, server actions), a span for every outgoing HTTP call (all PocketID API and OIDC calls), and the portal's own: every database query (`SELECT access_requests`, with the statement's shape and never its values), each email send (`email.send`, with the recipient count and never an address), building the catalog (`catalog.build`), and deciding a request (`access_request.decide`, with the PocketID grant as `access_request.grant`). Traces need a collector to see them (e.g. Grafana Tempo, Jaeger). Unset, it targets `http://localhost:4318`, and exports fail harmlessly if nothing listens there. The per-request log line is taken from the same span. |

### Per-route latency

The 95th percentile per route, over five minutes, across replicas:

```promql
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
```

Buckets run from 25 ms to 10 s (25, 50, 100, 250, 500 ms, 1, 2.5, 5,
10 s), so a percentile is only as precise as the bucket it falls in.

### Portal metrics

What the portal does, alongside how it serves. Every label comes from a
fixed set, never from a request, so the number of series stays small.

| Metric | Labels | Counts |
|---|---|---|
| `portal_access_requests_total` | `event`: `created`, `reopened`, `approved`, `denied` | Access requests, once each change is committed |
| `portal_pocketid_grants_total` | `outcome`: `granted`, `failed` (PocketID errored), `refused` (not a grantable group of a visible app) | Every attempt to add someone to a PocketID group |
| `portal_notifications_total` | `kind`: `new_request`, `decision`; `outcome`: `queued`, `sent`, `retried` (an attempt failed, another is scheduled), `failed` (given up on, or never queued) | Notification emails, one per recipient |
| `portal_pocketid_request_duration_seconds` | `endpoint` (a pattern: `GET /api/users/{id}`, never a URL), `outcome`: `2xx`, `4xx`, `5xx`, `error` (no answer) | PocketID API calls and their latency. Not the OIDC sign-in calls, and not the cached branding read |
| `portal_integration_request_duration_seconds` | `integration` (`jellyfin`), `operation` (`status`, `recently_added`, `poster`, `test`), `outcome`: `2xx`, `4xx`, `5xx`, `error` | Calls to integrated apps ([ADR-0013](adr/0013-integrations-server-side.md)) |
| `portal_web_vitals_seconds` | `name`: `TTFB`, `LCP`, `INP`; `route`: a page pattern | What people's browsers measured: time to first byte, when the main content appeared, and how long an interaction took to respond. See [Web Vitals](#web-vitals) |

Starting points for alerts (thresholds are yours, see [Your decisions](#your-decisions)):

```promql
# The portal's key can change group memberships, so grants are worth
# watching (#4): more than usual in an hour, or any that failed.
sum(increase(portal_pocketid_grants_total{outcome="granted"}[1h])) > 10
sum(increase(portal_pocketid_grants_total{outcome="failed"}[15m])) > 0

# PocketID slow or failing: every page waits on it.
histogram_quantile(0.95, sum by (le) (rate(portal_pocketid_request_duration_seconds_bucket[5m]))) > 1
sum(rate(portal_pocketid_request_duration_seconds_count{outcome=~"5xx|error"}[5m]))
  / sum(rate(portal_pocketid_request_duration_seconds_count[5m])) > 0.05

# Emails failing: attempts being retried (an SMTP problem now), or given
# up on after the last one (ADR-0011).
sum(increase(portal_notifications_total{outcome="retried"}[15m])) > 0
sum(increase(portal_notifications_total{outcome="failed"}[1h])) > 0
```

Grants only ever follow an approval, so
`portal_pocketid_grants_total{outcome="granted"}` and
`portal_access_requests_total{event="approved"}` move together. The
portal can only count what it does itself: a membership change made with
its API key outside the portal (a leaked key, say) shows up only in
PocketID's own audit log, so watch that too.

### Web Vitals

Server latency stops when the response leaves; people wait for the
network, the JavaScript and the rendering too. With metrics on
(`METRICS_TOKEN`), browsers report three timings per page to
`/api/web-vitals`: time to first byte (`TTFB`), when the main content
appeared (`LCP`), and how long interactions took to respond (`INP`).
`FEATURE_WEB_VITALS=false` turns this off and keeps the rest of the
metrics.

The endpoint is public, since the sign-in page has timings too. It
accepts only those three names, the portal's own pages and a bounded
value, refuses beacons from other sites and bodies over 512 bytes, and
caps each replica at 30 a second (bursts of 120). Each label comes from a
fixed set, so nobody can add series; the worst a script outside a browser
can do is skew the numbers within that rate. It's same-origin, so the
CSP (`connect-src 'self'`) already allows it.

```promql
# p75, the usual Web Vitals percentile, per page:
histogram_quantile(0.75, sum by (le, name, route) (rate(portal_web_vitals_seconds_bucket[1h])))
```

Google's thresholds for "good": TTFB under 0.8 s, LCP under 2.5 s, INP
under 200 ms. The buckets sit on those boundaries.

### Linking logs and traces

Every log line written during a request carries the request's `trace_id`
and `span_id` (absent at startup and in background work outside a
request). With Grafana:

- **Loki to Tempo**: a *derived field* on the Loki data source, name
  `TraceID`, regex `"trace_id":"(\w+)"`, linked to the Tempo data source
  with `${__value.raw}`. With `LOG_FORMAT=pretty`, use `trace_id=(\w+)`.
- **Tempo to Loki**: *Trace to logs* on the Tempo data source, filtered by
  trace id, with the same label your log shipper puts on the portal's
  container.

## Backups

The portal is stateless; the only thing worth backing up is Postgres: the
`postgres-data` volume in the compose stack, or the chart's PVC (which the
chart itself never backs up). It holds `access_requests`,
`app_overrides`, `app_dependencies`, `audit_log`, `integrations`, `news_posts`, `news_images`,
`notification_outbox`, `session_claims`, `user_onboarding` and
`user_preferences`.
`notification_outbox` holds emails waiting to be sent (sent ones are
pruned after a week, failed ones after a month); losing it loses only
those. `session_claims` is disposable: losing it only means each user's next
session refresh, at most one interval away, asks PocketID instead of
reading a stored copy. Losing `user_preferences` resets everyone's language
to their browser's until they pick one again. The audit log is the
one with real retention implications
([ADR-0006](adr/0006-audit-trail-separate-from-logs.md)).

The dumps below use `--clean --if-exists`, so they restore even over tables
the portal's migrations already created, and `--no-owner --no-acl`, so they
restore into a database whose user has a different name (the rename moved
the default from `quiche` to `portal`).

With compose:

```bash
# Uses the container's own POSTGRES_USER and POSTGRES_DB, whatever you set.
docker compose exec -T postgres sh -c \
  'pg_dump --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql \
  && test -s backup.sql && echo "backup ok"
```

No `backup ok` means no backup: a failed `pg_dump` still leaves an empty
`backup.sql` behind.

Restore with the portal stopped, so nothing writes during the restore:

```bash
docker compose stop portal
docker compose up -d postgres
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' < backup.sql
docker compose up -d
```

With the Helm chart's bundled Postgres, find the release's resources by
label (their names depend on the release name):

```bash
R=<release>
PG=$(kubectl get statefulset -l app.kubernetes.io/instance=$R,app.kubernetes.io/component=postgresql -o name)
APP=$(kubectl get deployment -l app.kubernetes.io/instance=$R,app.kubernetes.io/component=portal -o name)

kubectl exec "$PG" -c postgresql -- sh -c \
  'pg_dump --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql \
  && test -s backup.sql && echo "backup ok"

# Restore: stop the portal, restore, start it again.
kubectl scale "$APP" --replicas=0
kubectl exec -i "$PG" -c postgresql -- \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' < backup.sql
kubectl scale "$APP" --replicas=<replicaCount>
```

Moving from a quiche-world release: take the backup *before*
`helm upgrade`, while the old StatefulSet still runs (the same lookup
finds it), then restore into the new one. The old PVC is left in place;
delete it once the restored portal checks out.

## Your decisions

Deliberately not answered here, because they depend on infrastructure this
project cannot see:

- **Where it runs** — host, orchestrator, DNS, certificate issuer.
- **Alerting and escalation.** The signals above exist; no alert rules
  ship, because a threshold that suits one deployment is noise in another.
  A reasonable starting point: alert on `/api/ready` failing for more than
  a few minutes, and on the portal's own error-rate metric.
- **Log retention** and where stdout is shipped.
- **Backup schedule and offsite copies.**

## Known operational issues

| Issue | Impact |
|---|---|
| PocketID API key scope | The PocketID API key the portal holds is an admin key: it can change any membership, and read PocketID's `smtpPassword` and `ldapBindPassword` in plaintext. Mitigated by [`UI_CONFIG_DISABLED=true` on PocketID](#pocketid-set-ui_config_disabledtrue), [storing and rotating it as a secret, and alerting on grants](#the-pocketid-api-key). A narrower key waits on PocketID (#4) |
| Email delivery | Emails go through an outbox in Postgres ([ADR-0011](adr/0011-email-notifications-through-an-outbox.md)), so one in flight when an instance stops is sent by another, and a failed send is retried for about nine hours (1 min, 5 min, 30 min, 2 h, 6 h) before it's given up on, in History under Problems and in `portal_notifications_total{outcome="failed"}`. Delivery is at-least-once: an instance that dies between sending and recording it lets another send it again. Nothing is queued in the instant between the response and the queueing, so a crash in exactly that window still loses an email; the request itself is always in the admin queue |

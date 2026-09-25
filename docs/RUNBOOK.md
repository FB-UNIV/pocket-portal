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
| Metrics | `GET /api/metrics`, Prometheus text | Off unless `METRICS_TOKEN` is set; then send it as `Authorization: Bearer <token>` (Prometheus: `authorization: { credentials: <token> }` in the scrape config). Anything else gets a 404. The startup log says which state the instance is in. |
| Logs | structured JSON (Pino) on stdout | `docker compose logs`, or ship them anywhere that reads container stdout. `LOG_LEVEL` controls verbosity. Startup logs every configuration problem (`Configuration: …`) and any non-default feature flags. An email that couldn't be sent is logged at `warn` with its request id and never retried ([ADR-0009](adr/0009-email-notifications-inline-after-response.md)). |
| Traces | OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT` | Always on. Unset, it targets `http://localhost:4318`, and exports fail harmlessly if nothing listens there. |

## Backups

The portal is stateless; the only thing worth backing up is Postgres: the
`postgres-data` volume in the compose stack, or the chart's PVC (which the
chart itself never backs up). It holds `access_requests`,
`app_overrides`, `audit_log` and `session_claims`. The last is disposable:
losing it only means each user's next session refresh, at most one interval
away, asks PocketID instead of reading a stored copy. The audit log is the
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
| PocketID API key scope | The PocketID API key the portal holds can also read PocketID's `smtpPassword` and `ldapBindPassword` in plaintext. Mitigated by [`UI_CONFIG_DISABLED=true` on PocketID](#pocketid-set-ui_config_disabledtrue) |
| Email delivery | Email notifications are best-effort: one in flight when an instance stops is lost, and a failed send isn't retried. The request itself is safe: the admin queue and `/apps` still show it, so check the queue rather than relying on the email |

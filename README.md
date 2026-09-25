# pocket-portal

A self-hosted portal for a homelab or small team, built on
[PocketID](https://pocket-id.org). People sign in with a passkey, see the
apps they can reach, and request access to the rest — an admin approves
in-portal and the real group grant happens in PocketID.

It is a **launcher, not a gateway**: it never sits in the traffic path to
your apps, so if the portal is down, nobody loses access.

## Deploy it

```bash
git clone https://github.com/FB-UNIV/pocket-portal.git
cd pocket-portal
cp .env.example .env    # fill in the "Required" section
docker compose up -d
```

That runs the portal and its Postgres. **PocketID is not included**: point
`POCKETID_BASE_URL` at your own instance.

**On Kubernetes**, use the Helm chart from
[pocket-portal-helm](https://github.com/FB-UNIV/pocket-portal-helm), which has its own install guide and releases.

Put a TLS-terminating reverse proxy in front. With Caddy:

```caddyfile
portal.example.com {
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:3000
}
```

Set `AUTH_URL=https://portal.example.com` and register
`https://portal.example.com/api/auth/callback/pocketid` as the callback in
PocketID. nginx and Traefik examples are in the
[runbook](docs/RUNBOOK.md#reverse-proxy-contract).

### Configuration

Set in `.env` ([`.env.example`](.env.example) explains each one), or in a
[config file](#config-file).

<!-- AUTO-GENERATED: every variable in src/lib/config.ts's CONFIG_VARS must
     appear here; src/lib/config.test.ts fails otherwise. -->
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `POCKETID_BASE_URL` | yes | | Your PocketID URL |
| `POCKETID_API_KEY` | yes | | PocketID admin API key |
| `POCKETID_OIDC_CLIENT_ID` | yes | | OIDC client the portal signs in with |
| `POCKETID_OIDC_CLIENT_SECRET` | yes | | Secret for that client |
| `AUTH_SECRET` | yes | | Signs session cookies. Same on every replica |
| `POSTGRES_PASSWORD` | yes | | Database password |
| `POCKET_PORTAL_TAG` | yes | | Image tag to run, a release such as `vX.Y.Z` |
| `AUTH_URL` | recommended | Host header | Public origin, pins OIDC redirects |
| `METRICS_TOKEN` | no | metrics off | Bearer token that unlocks `/api/metrics` |
| `SMTP_HOST` | no | email off | SMTP server for access-request emails |
| `SMTP_FROM` | with `SMTP_HOST` | | Sender address |
| `SMTP_PORT` | no | `587` (`465` for `tls`) | SMTP port |
| `SMTP_TLS` | no | `starttls` | `starttls`, `tls` or `none` |
| `SMTP_USER` / `SMTP_PASSWORD` | no | | SMTP credentials, set both or neither |
| `FEATURE_ACCESS_REQUESTS` | no | `true` | `false` makes the portal a plain launcher: users see only apps they can open |
| `ACCESS_REQUEST_REASON` | no | `optional` | Reason field on requests: `optional`, `required` or `off` |
| `FEATURE_EMAIL_NOTIFICATIONS` | no | `true` | `false` pauses emails, keeping the SMTP settings |
| `FEATURE_POCKETID_BRANDING` | no | `true` | `false` keeps the portal's own look |
| `PORTAL_NAME` | no | PocketID's app name, else `Pocket Portal` | Name shown in the header and page titles |
| `FEATURE_AUDIT_LOG_PAGE` | no | `true` | `false` hides `/admin/audit`; events are still recorded |
| `WARN_POCKETID_SECRETS_READABLE` | no | `true` | `false` hides the admin banner; the startup log still warns |
| `CONFIG_FILE` | no | | Path to an optional YAML config file (below) |
| `MIGRATE_ON_START` | no | `true` | Apply DB migrations on start |
| `LOG_LEVEL` | no | `info` | Log verbosity |
| `LOG_FORMAT` | no | `json` | `pretty` for one readable line per entry (`docker logs`); `json` for log collectors |
| `LOG_REQUESTS` | no | `true` | A log line per request (method, path, status, duration); `false` leaves requests to traces |
| `PORTAL_BIND` | no | `127.0.0.1` | Host interface the port is published on |
| `PORTAL_PORT` | no | `3000` | Host port |
| `POSTGRES_USER` | no | `portal` | Database user |
| `POSTGRES_DB` | no | `pocket_portal` | Database name |
| `DATABASE_URL` | without compose | built by compose | Postgres connection string |
| `OTEL_SERVICE_NAME` | no | `pocket-portal` | Trace service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | `http://localhost:4318` | OTLP collector for traces |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | no | `http/protobuf` | OTLP wire format: `http/protobuf` or `http/json` |
<!-- /AUTO-GENERATED -->

#### Config file

The portal's non-secret settings can also go in a YAML file named by `CONFIG_FILE`
(see [`pocket-portal.example.yaml`](pocket-portal.example.yaml)); environment
variables win over it. Secrets are refused there: set them in the
environment, or in the image as `NAME_FILE=/run/secrets/…` (e.g.
`AUTH_SECRET_FILE`). The file is read at startup, so restart to apply a
change. Every configuration problem is logged at startup, and a
`CONFIG_FILE` that can't be read stops the portal.

## Securing the portal

> [!WARNING]
> The portal needs a PocketID admin API key. On a default PocketID, that key
> can also read PocketID's **SMTP and LDAP passwords in plaintext**. Run
> PocketID with **`UI_CONFIG_DISABLED=true`** to mask them
> ([details](docs/RUNBOOK.md#pocketid-set-ui_config_disabledtrue)). Until you do,
> the portal warns at startup and on every `/admin` page.

Before going live:

- [ ] PocketID runs with `UI_CONFIG_DISABLED=true`
- [ ] `POCKETID_API_KEY` is stored as a secret and rotated if leaked
- [ ] `AUTH_URL` is set to your public origin
- [ ] TLS proxy in front, sending HSTS, per the [proxy contract](docs/RUNBOOK.md#reverse-proxy-contract)

## What you get

| Route | Who | What |
|---|---|---|
| `/` | anyone | Sign in |
| `/my-access` | signed in | Your PocketID group memberships |
| `/apps` | signed in | Browse the catalog, request access |
| `/admin/apps` | admins | Show/hide apps in the catalog |
| `/admin/requests` | admins | Approve or deny requests |
| `/admin/audit` | admins | Every request and decision, newest first |
| `/api/health`, `/api/ready` | anyone | Liveness and readiness probes |
| `/api/metrics` | bearer of `METRICS_TOKEN`; 404 otherwise, and when unset | Prometheus metrics |

## Documentation

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | How it all fits together — start here |
| [Runbook](docs/RUNBOOK.md) | Deploying, upgrading, health checks, rollback, backups |
| [Development](docs/DEVELOPMENT.md) | Running it locally and changing it |
| [Contributing](docs/CONTRIBUTING.md) | Setup gotchas and the pre-PR checklist |
| [Decisions](docs/adr/) | Why it is built this way |
| [Changelog](CHANGELOG.md) | What changed, and when |

## Requirements

- **PocketID 2.15.0 or later** — an existing instance you control (CI
  tests with 2.16.0). Older versions don't send the data the app list
  needs; the portal names the problem in its startup log.
- **Docker** with Compose v2, **Kubernetes** with Helm, or any runtime that
  can run `ghcr.io/fb-univ/pocket-portal` and reach a Postgres.
- **Postgres**: bundled in the compose file and (for trying it out) the
  Helm chart, or bring your own.

Built with Next.js (TypeScript, App Router). Stateless by design: sessions
are signed cookies, so it runs as multiple replicas behind a load balancer
with no sticky sessions.

## License

[AGPL-3.0-or-later](LICENSE). You may run, modify and share it; if you offer
a modified portal to users over a network, you must make your changes'
source available to them.

## Reporting a security issue

Please don't open a public issue for a suspected vulnerability. Report it
privately, as [SECURITY.md](SECURITY.md) describes.

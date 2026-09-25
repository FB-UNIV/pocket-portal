# Development

Everything needed to run pocket-portal locally and change it. If you only
want to *deploy* it, you want the [runbook](RUNBOOK.md) instead — none of
this is required for that.

New to the codebase? Read [Architecture](ARCHITECTURE.md) first; it explains
what talks to what, which makes the rest of this page make sense.

### Prerequisites

- **Node.js 24+**, as in CI and the image.
- **Docker** (with Compose v2, i.e. `docker compose`, not the standalone
  `docker-compose`) — runs the ephemeral PocketID + Postgres test
  containers.
- **git** and, if you want to open PRs the way this repo expects (see
  `.claude/rules/git-workflow.md` — every change goes through a branch +
  PR, never a direct push to `main`), the **GitHub CLI** (`gh`).

### Full local setup: PocketID login working end to end

This is the part that isn't obvious from reading the code, so it's spelled
out in full.

#### 1. Start the test PocketID + Postgres containers

```bash
npm run test-env:up
```

This starts `docker-compose.test.yml` (PocketID at `localhost:1411`,
Postgres at `localhost:5432`, both ephemeral/tmpfs-backed — all data is
lost on `test-env:down`) and then automatically runs
`scripts/pocketid-provision-oidc-client.mjs`, which registers the OIDC
client the portal logs in as and mints a secret, writing both to the
gitignored `.env.test.generated`. PocketID only returns that secret once,
at creation time, which is why this step exists instead of a static
fixture value.

It then runs `scripts/pocketid-seed-catalog.mjs`, which seeds a realistic
catalog so the portal has real data to show (an empty PocketID has none):
a few OIDC clients (apps) with launch URLs — some open, some group-gated —
the `media`/`engineering` groups they gate on, and an `e2e-user` who is a
member of `media`. That membership is deliberate: it makes the open and
`media`-gated apps show as **Open** for that user and the `engineering`
one show as **Request access**, so both branches of the catalog are
exercisable. An `e2e-admin` (PocketID admin, no groups) is seeded too, for
the `/admin` pages. It's idempotent (fixed client IDs, lookup-by-name for
groups/users), so re-running `test-env:up` converges rather than
duplicating.

#### 2. Load the environment and start the dev server

```bash
set -a
source .env.test
source .env.test.generated
set +a
npm run dev
```

(`set -a` exports every variable `source` defines, without it they'd only
be set in the shell, not passed to the `npm run dev` child process.)

#### 3. Create a real PocketID user and log in

PocketID's own onboarding/setup wizard is **not available** in this test
environment: `.env.test`'s `STATIC_API_KEY` bootstraps an admin user on
container start, and PocketID only offers first-run setup when *no* user
exists yet. So there's a real admin, but it's an API-key-only user with no
password/passkey — you can't sign in as it through a browser.

Run:

```bash
npm run dev-login
```

This creates (or reuses/promotes) a real admin-capable end-user account
via PocketID's admin API and prints a one-click login link, e.g.:

```
One-click PocketID login (valid 30m, single use):
  http://localhost:1411/lc/AbCd12EfGh34
```

Open that link in a browser. You'll land inside PocketID already signed
in — go to **Settings → Passkeys** and register a passkey (Windows Hello,
a platform authenticator, a security key, whatever your browser/OS
offers). `http://localhost` counts as a secure context, so WebAuthn works
without HTTPS.

> Why a script instead of just clicking a shorter admin-generated link:
> PocketID's login-code screen has a real frontend bug when no SMTP is
> configured — it validates codes as 12 characters long, but the
> admin API's default token is 6 characters, so it can never complete,
> even via the auto-submitting `/lc/{code}` link. `pocketid-dev-login.mjs`
> requests a 30-minute TTL specifically because PocketID's backend only
> generates the 6-character format for tokens with `ttl <= 15m` — a
> longer TTL gets the 12-character format the UI actually expects. This
> is upstream PocketID behavior, not something fixed in this repo.

#### 4. Sign in through the portal

Go to http://localhost:3000, click **Sign in with PocketID**, and
authenticate with the passkey you just registered. You should land back
on the portal signed in, with a **My Access** link showing your PocketID
group memberships (empty until you add yourself to a group in PocketID's
admin UI — group changes show up within a few minutes without needing to
sign out and back in: sessions re-derive groups and admin status from
PocketID every `GROUPS_REFRESH_INTERVAL_MS`, 5 minutes, in
`src/lib/auth/claims-refresh.ts`).

#### 5. Tearing down

```bash
npm run test-env:down
```

Wipes the tmpfs-backed containers — your test user, passkey, and OIDC
client are all gone with it. Next time you `test-env:up`, repeat steps
1–3.

### Scripts

<!-- AUTO-GENERATED: one row per package.json script, and no others;
     src/lib/docs-sync.test.ts fails otherwise. -->
| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build (standalone output for Docker) |
| `npm run start` | Run the production build with `next start` |
| `npm run start:standalone` | Run the standalone server, as the image does; what e2e uses |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (fast, no network) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:coverage` | Unit tests with coverage; CI gates on 80% for `src/lib/**` and the logic-bearing parts of `src/app/**` (see `vitest.config.ts`) |
| `npm run test:integration` | Tests against real PocketID + Postgres — run `test-env:up` first |
| `npm run test:e2e` | Playwright e2e — builds and serves the app itself |
| `npm run test-env:up` | Start the ephemeral PocketID + Postgres test containers |
| `npm run test-env:down` | Stop and remove them (`-v`: also drops tmpfs data) |
| `npm run db:migrate` | Apply drizzle migrations — chained into `test-env:up` already; run it yourself only if a DB-touching route errors with a missing relation |
| `npm run dev-login` | Print a one-click PocketID login link for manual testing (see above) |
| `npm run sbom` | Regenerate `sbom.cdx.json`: required after any dependency change, see [Contributing](CONTRIBUTING.md#before-opening-a-pr) |
<!-- /AUTO-GENERATED -->

There's also `npx tsc --noEmit` for typecheck — run `npx next typegen`
first on a clean checkout (Next.js 16's `LayoutProps`/`PageProps` ambient
types don't exist until a build or typegen has run; this bit CI once, see
[Troubleshooting](#troubleshooting)).

### Testing

```bash
npm test                 # unit tests, no network needed
npm run test-env:up      # for the two below
npm run test:integration # real PocketID + Postgres
npm run test:e2e         # Playwright — builds and serves the app itself
```

How the e2e suite is laid out:

- **Signing in.** `e2e/auth.setup.ts` signs `e2e-user` and `e2e-admin` in
  once, and specs reuse the saved session (`sessionFile()` in
  `e2e/helpers/auth.ts`). PocketID rate-limits the one-time tokens this
  uses (a burst of 5, then 1 per 10s, per IP), so signing in per test fails.
- **Accessibility.** `e2e/a11y.spec.ts` runs axe (WCAG 2.2 AA) over every
  page, in light and dark mode. Any violation fails.
- **No browser needed.** `oidc-login`, `metrics`, `my-access` and
  `admin-apps` use Playwright's `request` fixture, so they run where
  Chromium can't launch (e.g. WSL without passwordless `sudo` for its
  shared libraries). The other specs drive a browser.

### Database

`DATABASE_URL` (from `.env.test`, already loaded in step 2 above) points
at the same test Postgres container. `npm run test-env:up` already
applies migrations for you (`npm run db:migrate`, chained in) — you don't
need to run it separately for the normal flow above.

What lives in Postgres versus what is read live from PocketID is covered in
[Architecture § Who owns what](ARCHITECTURE.md#who-owns-what).

If you ever hit a missing-relation error against a container you brought
up some other way, run:

```bash
npm run db:migrate
```

In production nobody runs this by hand: the image applies migrations on
start, under a Postgres advisory lock so replicas don't race. See
[Database migrations](RUNBOOK.md#database-migrations).

Changing the schema: edit `src/lib/db/schema.ts`, then
`npx drizzle-kit generate --name <what-it-does>` writes the next migration
into `drizzle/`. Keep it backward-compatible with the previous release,
since rolling updates run both at once.

### Development workflow

**Tests first.** Write a failing test before the code that makes it pass
(`/ecc:tdd-workflow` if you use Claude Code).

**Git: branches + PRs only.** Direct pushes to `main` aren't allowed, even
for small changes — see `.claude/rules/git-workflow.md` for the full flow
(branch off `main`, PR, let CI run, then merge).

**Commit style**: [Conventional Commits](https://www.conventionalcommits.org/) —
`feat:`, `fix:`, `test:`, `chore:`, `ci:`, `docs:`, `refactor:`. Keep the
RED/GREEN/refactor TDD stages as separate commits where practical (see git
log for examples).

**Dependencies** ([full rules](../.claude/rules/dependencies.md)): install
the latest stable release (at least 7 days old), pin GitHub Actions to a
commit SHA, and regenerate the SBOM on every change, as described in
[Contributing](CONTRIBUTING.md#before-opening-a-pr).

**Configuration**: add a setting to the registry in `src/lib/config.ts` and
read it through a reader there, never `process.env` directly. The README
table, `.env.example` and the config-file keys are then checked by tests.

**Versioning**: [`versioning.md`](../.claude/rules/versioning.md).

### CI

Every push to `main` and every PR runs:

- `unit-tests.yml` — lint, typecheck, unit tests + coverage, `npm audit`
  (advisory: `continue-on-error`, doesn't block — Dependabot is the actual
  enforcement path for dependency CVEs)
- `e2e-tests.yml` — integration tests against real PocketID, Playwright e2e
  (browser binaries cached, keyed on the pinned Playwright version)
- `sbom-check.yml` — SBOM freshness
- `compose-smoke.yml` — boots the reference compose stack from the PR's
  image and checks liveness, readiness and that migrations ran
- `semgrep.yml` — static analysis, pinned rulesets (`p/typescript`,
  `p/react`, `p/security-audit`; CodeQL doesn't work here: its SARIF
  upload needs GitHub Advanced Security, unavailable for private repos on a
  personal account)
- `docker-build.yml` — on a PR, a build-only check (no scan, no push) so a
  broken multi-stage build surfaces before merge, not after; on push to
  `main`, the real build: scans with Trivy (fails on CRITICAL/HIGH), and
  only then pushes to `ghcr.io`

All jobs have a `timeout-minutes` cap and cancel superseded runs on the
same branch/PR (`concurrency`) — there's no branch protection on this free
private repo to enforce any of this as a merge gate, so it's convention,
not the platform, doing the enforcing; a PR should still have all of these
green before merging.

### Troubleshooting

Issues you might hit running this locally:

| Symptom | Cause | Fix |
|---|---|---|
| Every page returns HTTP 500 on a fresh checkout, including `/` before you have logged in anywhere | **Known limitation, not a bug.** The root layout calls `auth()` on every request, which needs PocketID's configuration and throws `POCKETID_BASE_URL is not set`. There is no configuration-free degraded mode. The startup log lists every missing setting as `Configuration: …` | Set the `POCKETID_*` env vars ([full local setup](#full-local-setup-pocketid-login-working-end-to-end)). To check the process is alive without any config, use `/api/health`, which touches neither PocketID nor Postgres |
| Login fails with PocketID logging `invalid_client` | A stale `next dev`/`next-server` process is still running with an old `POCKETID_OIDC_CLIENT_SECRET` from before the test container was last recreated | `ps aux \| grep next` / `lsof -i :3000`, kill the stale process, restart `npm run dev` with freshly-sourced env vars |
| PocketID's `/lc/{code}` link or the manual code-entry screen never logs you in, code looks "too short" | Upstream PocketID frontend bug — see the callout in [step 3](#3-create-a-real-pocketid-user-and-log-in) above | Use `npm run dev-login`, not a manually-minted admin token |
| `npx tsc --noEmit` fails: `Cannot find name 'LayoutProps'` on a fresh checkout | Next.js 16's typed-routes ambient types only exist after a build/dev run | Run `npx next typegen` first (see `unit-tests.yml`) |
| `GET /api/auth/error?error=Configuration` returns HTTP 500 | Intentional Auth.js behavior (`@auth/core/lib/pages/error.js` hardcodes `status: 500` for the `Configuration` error class) | Not a bug — look at what upstream error actually triggered it (check the dev server log) instead of the error page's status code |
| `npm install` prints an `EBADENGINE` warning for `jsdom@30.0.1` | `jsdom` wants Node `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`; an older 24.x patch triggers the warning | Harmless — tests still run correctly |
| CI step loading `.env.test` into `$GITHUB_ENV` fails: `Invalid format '# ...'` | `$GITHUB_ENV`'s format rejects comment/blank lines; `.env.test` has both | Filter out `^#` and blank lines before appending (see `e2e-tests.yml`) |
| `sbom-check.yml` fails although you ran `npm run sbom` | `npm sbom` walks the installed `node_modules`, whose optional platform packages differ by machine and Node version | Regenerate the way CI does; see [Contributing](CONTRIBUTING.md#before-opening-a-pr) |
| e2e sign-ins fail with 429 after the first few | PocketID rate-limits one-time token redemption (burst 5, then 1 per 10s, per IP) | Reuse `sessionFile()` from `e2e/auth.setup.ts` rather than calling `signInAsSeedUser` per test |
| Semgrep blocks on `github-actions-mutable-action-tag` across a workflow | Version tags (`@v7`, `@v4`, ...) can be silently repointed by the action owner — `trivy-action` has a real history of exactly this | Pin every `uses:` to a commit SHA with a `# vX.Y.Z` comment (Dependabot still updates these) |
| `relation "apps"` (or similar) does not exist when a DB-touching route runs | You brought up Postgres some other way than `test-env:up`, so migrations were never applied | Run `npm run db:migrate` |

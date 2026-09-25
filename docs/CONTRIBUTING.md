# Contributing

This file is a map, not a second copy of the rules. The authoritative
process lives in [`.claude/rules/`](../.claude/rules/) and the
[README](../README.md); anything restated here would drift the moment one
of them changed, so this points instead.

## Setup

Prerequisites, install steps and the full PocketID login walkthrough:
[Development](DEVELOPMENT.md). Read [Architecture](ARCHITECTURE.md) first if
you are new to the codebase.

Two things that bite newcomers:

- **Node 24+**, as in the Dockerfile and CI. Nothing warns you: there is no
  `.nvmrc` or `engines` field. On an older Node, vitest fails at startup
  (`node:util` has no `styleText`). If `node_modules` came from another
  Node, `rm -rf node_modules && npm ci`, or the native rolldown binding is
  wrong.
- **`npm run dev` alone will not render a page.** `/api/health` responds,
  but every page 500s until the `POCKETID_*` env vars are set. See
  [Development](DEVELOPMENT.md).

## Scripts

`package.json` is the source of truth; [Development § Scripts](DEVELOPMENT.md#scripts)
annotates what each one is for. Deliberately not duplicated here.

## Tests

| Suite | Command | Needs |
|---|---|---|
| Unit | `npm test` | nothing |
| Coverage | `npm run test:coverage` | nothing; gates at 80% |
| Integration | `npm run test:integration` | `npm run test-env:up` first |
| E2E | `npm run test:e2e` | `npm run test-env:up` first |

Integration and e2e load env like CI does:

```bash
set -a && . ./.env.test && . ./.env.test.generated && set +a
```

The test containers are **long-lived locally** while CI gets fresh ones
every run, so a local-only e2e failure is more often stale container state
than a real regression — check `app_overrides` in the test Postgres and the
OIDC client list in PocketID before debugging code.

This repo writes tests first: see the `test: RED …` / `feat: GREEN …`
commit pairs in the history.

## Before opening a PR

Full rules: [`git-workflow.md`](../.claude/rules/git-workflow.md),
[`versioning.md`](../.claude/rules/versioning.md),
[`dependencies.md`](../.claude/rules/dependencies.md),
[`pocketid-api.md`](../.claude/rules/pocketid-api.md).

- [ ] Work is on a feature branch — **never push to `main` directly**,
      however small the change.
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit` pass.
      (Run `npx next typegen` before `tsc`, or `layout.tsx` errors with
      `Cannot find name 'LayoutProps'`.)
- [ ] Added, removed or upgraded a dependency, or bumped the version?
      Regenerate `sbom.cdx.json` the way `sbom-check` does, or CI rejects
      it. Its output depends on the installed tree, so match CI's
      environment (Node 24, linux-x64), from a scratch copy:

      ```bash
      d=$(mktemp -d) && mkdir -p "$d/scripts"
      cp package.json package-lock.json "$d/" && cp scripts/generate-sbom.mjs "$d/scripts/"
      (cd "$d" && npm ci --ignore-scripts && node scripts/generate-sbom.mjs)  # with Node 24
      cp "$d/sbom.cdx.json" .
      ```
- [ ] Bumped the version? Follow [`versioning.md`](../.claude/rules/versioning.md):
      `package.json`, `.env.example`'s `POCKET_PORTAL_TAG` (a test checks
      both) and a `CHANGELOG.md` entry.
- [ ] Touching anything that talks to PocketID? Verify endpoint paths and
      response shapes against <https://pocket-id.org/docs/api> or a live
      instance — never from memory or another OIDC provider's conventions.
- [ ] Keep it stateless: no in-process session or cache state that a second
      replica cannot see.
- [ ] New setting? Add it to the registry in `src/lib/config.ts` and the
      README table; never read `process.env` directly.
- [ ] PR body references the issue with a closing keyword (`Closes #N`),
      or `Refs #N` if it only advances it, and the PR is added to
      the project board.
- [ ] Let CI finish before merging — that is the point of the PR.

## Architecture decisions

Significant choices are recorded as ADRs in [`adr/`](adr/), with
[`adr/template.md`](adr/template.md) to copy. Add one when a decision would
otherwise only exist in a PR thread.

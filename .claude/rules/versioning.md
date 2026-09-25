# Semantic versioning

This project's `package.json` `version` follows
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html):
`MAJOR.MINOR.PATCH`.

## Pre-1.0 (current phase)

The project is currently `0.x`. Per semver §4, anything in a `0.y.z`
release may change at any time — but to keep bumps meaningful before 1.0:

- **PATCH** (`0.1.x`): bug fixes, internal refactors, dependency bumps —
  nothing a user or admin would notice.
- **MINOR** (`0.x.0`): a new feature, a new admin/user-facing behavior, or
  a breaking change to env vars / the OIDC contract (breaking changes still
  bump MINOR, not MAJOR, before 1.0).
- **MAJOR** stays `0` until 1.0.0.

## Cutting 1.0.0

`1.0.0` is reserved for the first release someone other than the author
could deploy and run. The project is intended to be open-sourced, so the
gate is deliberately *not* "we picked a host" — a target baked into the
docs is a target every other deployer has to undo. The gate is that
[`docs/RUNBOOK.md`](../../docs/RUNBOOK.md) documents a real **deployment
contract** and the repo ships a **reference deployment** that works
unmodified: required configuration, a health check, an upgrade path
including schema migrations, and a rollback story — not a "Not defined"
section. Don't bump to `1.0.0` just because a feature set
feels complete.

## After 1.0.0

- **MAJOR**: breaking change — removed/renamed env var, changed OIDC
  client contract, a schema change that breaks existing data, etc.
- **MINOR**: backward-compatible feature.
- **PATCH**: backward-compatible bug fix.

## Process

A PR that changes the version:

1. Bumps `version` in `package.json`, and to match it `POCKET_PORTAL_TAG`
   in `.env.example`; `src/lib/env-example.test.ts` fails if it's left
   behind. (The Helm chart has its own repository and releases: after an
   app release, bump its `appVersion` there.)
2. Adds an entry under `## [Unreleased]` in `CHANGELOG.md` (format:
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)), or renames
   `[Unreleased]` to the new version + date if the PR is itself the release.
3. After merge, **wait for `docker-build.yml`'s `build` job to finish on
   `main`** (it pushes and scans the image for this commit), then tag the
   merge commit: `git tag vX.Y.Z && git push origin vX.Y.Z`. Pushing that
   tag triggers `docker-build.yml`'s `promote-release` job, which
   independently re-scans that exact commit's image (`dev-<sha>`) and, only
   if it still passes, tags it `vX.Y.Z`, `vX.Y`, `vX` and `latest` on
   `ghcr.io` and signs it (a pre-release such as `vX.Y.Z-rc.1` gets only
   its own tag) — no rebuild, but it does
   re-scan (against the current vulnerability database, not a stale
   build-time snapshot) rather than trusting the `build` job's earlier
   result, since that job pushes the commit's image *before* scanning it
   and this job has no way to know whether that scan passed. If you tag
   before the `build` job finishes, `promote-release` fails loudly
   (nothing to retag yet); **re-run the failed `promote-release` job**
   once `build` is green — pushing the same tag again does *not*
   re-trigger anything, since nothing about the ref changed.

   `vX.Y.Z` is deliberately *not* derived from `package.json` on every
   push to `main` — it only ever moves in direct response to a git tag
   being pushed. An earlier version of this pipeline tagged
   `v${package.json version}` on every push to `main`, so a push that
   didn't bump the version silently re-pointed the existing `vX.Y.Z`
   registry tag at content its release notes didn't describe (this
   happened twice in practice: v0.4.0 and v0.4.1 each briefly pointed at
   later, undocumented commits before the fix).
4. Create a **GitHub Release** for that tag with the version's `CHANGELOG.md`
   section as the notes — a pushed git tag alone does not create one, so the
   changelog wouldn't otherwise show up on the Releases page. Extract the
   section (dropping its `## [X.Y.Z] - date` header line) and pipe it in:

   ```bash
   awk '/^## \[X\.Y\.Z\]/{f=1;next} f&&/^## \[/{exit} f{print}' CHANGELOG.md \
     | gh release create vX.Y.Z --title "vX.Y.Z" --verify-tag --notes-file -
   ```

   The `--verify-tag` guards against publishing a release for a tag that was
   never pushed (step 3).

Not every PR needs a version bump — routine chores, CI tweaks, and
docs-only changes don't need one. Bump when the change is something a
changelog reader would actually want to know about.

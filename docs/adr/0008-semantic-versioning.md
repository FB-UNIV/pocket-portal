# ADR-0008: Adopt Semantic Versioning for releases

**Date**: 2026-09-21
**Status**: accepted — tagging mechanism amended 2026-09-22 and 2026-09-25
**Deciders**: François Bouju

> **2026-09-22 update**: the last Decision bullet below (deriving the
> image's `vX.Y.Z` tag from `package.json` on every push to `main`) was
> reverted. Doing so silently re-pointed an existing `vX.Y.Z`
> registry tag at undocumented content whenever a push didn't bump the
> version — it actually happened to v0.4.0 and v0.4.1. `vX.Y.Z` is now
> applied only by `docker-build.yml`'s separate `promote-release` job,
> triggered by an actual `git tag vX.Y.Z` push, which independently
> re-scans that commit's already-published image before retagging it. The
> rest of this ADR (semver adoption, pre-1.0 policy, `CHANGELOG.md`)
> stands; see `.claude/rules/versioning.md` for the current release steps.
>
> **2026-09-25 update**: `latest` now means the newest stable release, not
> the newest `main` build. `main` builds are tagged `dev-<sha>` and `dev`;
> a stable release also moves `vX.Y` and `vX`; a pre-release
> (`vX.Y.Z-rc.N`) gets only its own tag. Images are built for amd64 and
> arm64 and signed with cosign. The tag table is in `docs/RUNBOOK.md`.

## Context

`package.json`'s `version` field has sat at `create-next-app`'s default
(`0.1.0`) since the project was scaffolded, never bumped and with no
policy for when or how it should change. There's also no `CHANGELOG.md` —
the only record of what changed and when is `git log`, which doesn't
distinguish a routine chore from a user-facing change. The Docker image
published by `docker-build.yml` is tagged only by commit SHA and `latest`,
so there's no way to reference "the version that added feature X" without
digging through commit history.

## Decision

Adopt [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) for
`package.json`'s version, with a project-specific policy for the current
pre-1.0 phase (full policy: `.claude/rules/versioning.md`):

- Stay in `0.x` until a real (non-homelab-dev) deployment target exists —
  `1.0.0` is not cut just because a feature set feels complete.
- Maintain `CHANGELOG.md` (Keep a Changelog format) alongside every
  version bump.
- Tag the `main` merge commit `vX.Y.Z` after a version-bumping PR merges.
- ~~`docker-build.yml` reads `package.json`'s version on every push to
  `main` and adds a `vX.Y.Z` tag to the published image, alongside the
  existing commit-SHA and `latest` tags.~~ (Superseded 2026-09-22 — see
  the note above: `vX.Y.Z` is now applied only in response to a pushed
  git tag, never derived from `package.json` on a push to `main`.)

## Alternatives Considered

### Alternative 1: Jump straight to 1.0.0
- **Pros**: simpler mental model — no separate pre-1.0 rules to remember.
- **Cons**: semver's own spec reserves `0.y.z` for initial development
  where the public API/contract may still change; this project has no
  deployment target yet and the access-request flow (ADR-0002) isn't
  built, so "1.0" would overstate stability that doesn't exist.
- **Why not**: would make the version number lie about how settled the
  project is.

### Alternative 2: Date-based versioning (CalVer)
- **Pros**: no bump-type judgment calls; version always reflects recency.
- **Cons**: doesn't communicate whether a change is breaking, which is the
  main thing a version number is useful for on a single-deployable app
  with real env-var/OIDC contracts that can break between versions.
- **Why not**: semver's breaking-vs-not signal is more useful here than
  CalVer's recency signal.

## Consequences

### Positive
- The Docker image, `CHANGELOG.md`, and git tags all reference the same
  version number, making "what changed between X and Y" answerable
  without reading raw commit history.
- Forces a deliberate decision about whether a change is user-visible
  (worth a bump) versus routine (isn't), instead of leaving `0.1.0`
  meaningless forever.

### Negative
- One more thing to remember per PR (bump + changelog entry) — mitigated
  by making it explicitly optional for routine/chore/docs-only PRs.

### Risks
- Pre-1.0 semver bumps are inherently a judgment call (spec §4 permits
  anything to change at any time); if bump decisions turn out inconsistent
  in practice, revisit the policy in `.claude/rules/versioning.md` rather
  than treating the first attempt as final.

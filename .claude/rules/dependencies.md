# Dependency rules

## The SBOM is a build output, not a committed file

The npm-level Software Bill of Materials (CycloneDX) is generated in CI,
never by hand and never committed:

- **Every image** built on `main` (`docker-build.yml`) gets it as a
  **signed attestation** on its digest (`actions/attest-sbom`, pushed to
  GHCR beside the image). Release tags point at that same digest, so they
  carry it too. Verify with:

  ```bash
  gh attestation verify oci://ghcr.io/fb-univ/pocket-portal:vX.Y.Z \
    --owner FB-UNIV --predicate-type https://cyclonedx.org/bom
  ```

- **Every GitHub Release** gets it as a `sbom.cdx.json` asset
  (`release-sbom.yml`).
- The OS/base-image level is covered by BuildKit's own SBOM attestation
  (`sbom: true` in the same build).

So a dependency change needs nothing extra: no regeneration, no
`sbom.cdx.json` in the diff. `npm run sbom` still exists (CI runs it) if
you want to look at one locally; it's gitignored.

**Why not commit it:** it's derived from `package-lock.json`, so a
committed copy only drifts (it depends on the installed tree, so it only
matched CI's byte for byte on Node 24 from a scratch copy) and every
Dependabot PR failed on it. Making CI push it back onto those branches
would put a write token in the job that installs the brand-new,
not-yet-trusted dependency versions. A signed attestation tied to the
image digest also proves more than a JSON file anyone can edit in a PR.
Review supply-chain changes in the `package-lock.json` diff.

The SBOM-generating jobs hold no write permission and install with
`--ignore-scripts`; only a separate step or job, which runs no dependency
code, attests or uploads the result. Keep it that way.

## Prefer the latest stable version

When adding a new dependency, or touching one that's already outdated,
install the latest stable release rather than pinning to an older version
"to be safe" — e.g. `npm install <pkg>@latest`, not a version copied from an
old tutorial or a stale lockfile entry. Skip this only when a newer version
is genuinely incompatible (breaking change you're not ready to absorb,
known regression) — note why in the commit message when you deliberately
stay behind.

This applies to npm packages, the Docker base image tag, and GitHub Actions
versions. Dependabot (`.github/dependabot.yml`) automates the ongoing part of
this — weekly PRs bumping npm, Docker, and Actions dependencies — but don't
rely on it alone when you're the one adding something new.

Dependabot has a 7-day cooldown on newly published versions (a brand-new
release can be a compromised or unstable one — Semgrep's
`dependabot-missing-cooldown` rule flags configs without this). GitHub
Actions are pinned to a commit SHA with a `# vX` comment rather than a
mutable tag, for the same reason (Semgrep's
`github-actions-mutable-action-tag` rule; `trivy-action` has a real history
of this exact attack). Dependabot still knows how to bump a SHA-pinned
action when a new version's SHA needs swapping in.

Lockfiles are resolved with **Node 24's npm** (CI's toolchain): a lockfile
written by another npm major can omit optional packages Node 24's `npm ci`
requires, and then every job fails at install.

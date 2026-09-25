# Dependency rules

## Keep the SBOM current

Whenever an external component is added, removed, or upgraded — an npm
package, a Docker base image, anything pulled in from outside this repo —
regenerate the Software Bill of Materials before considering the change done:

```bash
npm run sbom
```

This writes `sbom.cdx.json` (CycloneDX format). Commit it alongside the
dependency change. `.github/workflows/sbom-check.yml` regenerates and diffs
it on every push/PR.

The output depends on the installed `node_modules`, so a plain local run
can differ from CI's. Regenerate it the way `docs/CONTRIBUTING.md` shows
(Node 24 on linux-x64, from a scratch copy), which
matches CI byte for byte. A failure there then really means the SBOM is
stale.

The Docker image itself is covered separately: `docker-build.yml` builds with
an SBOM attestation (`sbom: true`) so the base-image/OS-level component list
travels with the published image, independent of the npm-level
`sbom.cdx.json`.

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

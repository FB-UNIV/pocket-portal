# Git workflow: PRs only, never push to `main` directly

Direct pushes/commits to `main` are not allowed, including for small or
"obvious" changes. This applies to Claude and to human contributors alike.

## Required flow

1. Create a feature branch off `main` (name it after the issue, e.g.
   `8-portal-oidc-login` or `fix/audit-log-timestamp`).
2. Commit work there, following the repo's existing commit conventions
   (RED/GREEN TDD commits, `chore:`/`fix:`/`feat:` prefixes).
3. Push the branch and open a PR with `gh pr create`.
4. Let CI run on the PR (unit tests, e2e, lint, sbom-check, semgrep) before
   merging — this is the whole point: catching problems pre-merge instead
   of on `main`.
5. Merge the PR (squash or merge, whichever keeps history readable) once
   checks pass. Do not merge with failing required checks.

## Referencing issues and the project

- The PR description must reference the issue(s) it addresses using a
  GitHub closing keyword (`Closes #N`, `Fixes #N`) so the issue auto-closes
  on merge and shows the linked PR in its timeline.
- If the issue is tracked on a GitHub Project board, add
  the PR itself to that project too (`gh project item-add <project-number>
  --owner <owner> --url <pr-url>`), so the board reflects in-review work,
  not just merged/closed work.
- When a PR isn't a 1:1 fix for a single issue (e.g. it advances an issue
  without fully closing it), use `Refs #N` instead of a closing keyword,
  and say explicitly in the PR body what's still open.

## Why

- Direct pushes to `main` mean CI results are only known *after* the
  change already landed — this repo's CI (unit tests, e2e against real
  PocketID/Postgres, SBOM check, semgrep) is meant to gate merges, not
  report on them after the fact.
- PRs give every change a reviewable diff and a place for CI status,
  discussion, and linkage to the issue/project it came from — none of
  which exist for a bare commit pushed straight to `main`.

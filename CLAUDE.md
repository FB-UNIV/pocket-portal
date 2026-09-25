# pocket-portal

Digital workspace for users, built by consuming the PocketID API (identity/auth provider). Next.js (TypeScript, App Router).

@.claude/rules/pocketid-api.md
@.claude/rules/dependencies.md
@.claude/rules/git-workflow.md
@.claude/rules/versioning.md
@AGENTS.md

## Commands

- Build: `npm run build`
- Test (unit): `npm test`
- Test (watch): `npm run test:watch`
- Test (integration, real PocketID + Postgres): `npm run test:integration` (requires `npm run test-env:up` first)
- Test (e2e, Playwright): `npm run test:e2e` (requires `npm run test-env:up`; builds and serves the standalone server itself)
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit` (run `npx next typegen` first on a fresh checkout)
- Dev server: `npm run dev`
- Docker image: `docker build -t pocket-portal .` (multi-stage, `next.config.ts` `output: "standalone"`; CI pushes to `ghcr.io/<repo>` on every push to `main`)

## Notes

- Stateless-by-design (see rule above): no in-process session/cache state.
- Configuration: read settings through `src/lib/config.ts` (add new ones to its `CONFIG_VARS` registry and the README table), never `process.env` directly.
- SBOM: regenerate it the reproducible way in `docs/CONTRIBUTING.md` (Node 24, a scratch copy), not with a plain local `npm run sbom`.

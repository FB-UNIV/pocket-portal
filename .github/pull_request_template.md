<!-- What changes, and why. Link the issue: `Closes #N`, or `Refs #N` if it
only advances it. -->

Closes #

## Checklist ([details](https://github.com/FB-UNIV/pocket-portal/blob/main/docs/CONTRIBUTING.md#before-opening-a-pr))

- [ ] Tests first; `npm test`, `npm run lint` and `npx tsc --noEmit` pass
- [ ] Dependency change or version bump: SBOM regenerated the reproducible way
- [ ] New setting: in `src/lib/config.ts`'s registry and the README table
- [ ] Talks to PocketID: verified against its API docs or a live instance
- [ ] Stateless: no in-process state another replica can't see
- [ ] `CHANGELOG.md` updated, if a user would notice

# ADR-0010: Inherit PocketID's branding, not its theme

**Date**: 2026-11-06
**Status**: accepted
**Deciders**: project maintainer

## Context

People reach the portal from PocketID, and PocketID's admin can set an
application name, a logo and an accent colour. Since 0.x the portal has read
those three from PocketID's public `/api/application-configuration` (behind
`FEATURE_POCKETID_BRANDING`, on by default), so the two feel like one
product. The decision was never written down, and the 1.1.0 redesign
(`docs/DESIGN.md`) gave the portal a look of its own, which raised the
question of how much of PocketID's look the portal should copy.

The accent was also applied as one inline `style` on `<html>`. That set the
same colour in the light and the dark theme, so a dark accent (navy, forest)
that reads well on paper all but disappeared on the dark page.

## Decision

The portal inherits PocketID's **name, logo and accent colour**, and nothing
else. Its palette, type, layout and wording are its own (`docs/DESIGN.md`).

- The accent drives the primary buttons only (`--brand`, `--on-brand`,
  `--brand-hover`). It's converted to sRGB and paired with black or white
  text, whichever reads better, so it can't introduce a contrast failure.
- The dark theme gets its own variant: the accent is lightened toward white
  until the button stands out from the dark page by 3:1 (WCAG 1.4.11), and
  its text colour is chosen again. An accent that already does is unchanged.
- Both variants go out as a small `<style>` element (light, then dark under
  `prefers-color-scheme: dark`), built only from re-serialised hex values.
- `FEATURE_POCKETID_BRANDING=false` keeps the portal's own name, mark and
  terracotta accent. `PORTAL_NAME` overrides the name either way.

## Alternatives Considered

### Alternative 1: Copy PocketID's whole theme
- **Pros**: The portal would look exactly like PocketID.
- **Cons**: PocketID exposes only an accent and images, not a palette or type,
  so "the whole theme" would mean scraping or hard-coding PocketID's CSS,
  which changes between releases. PocketID's UI is also built for managing
  an account, not for people looking for "the films app".
- **Why not**: It's brittle, and it fits the wrong audience.

### Alternative 2: Ignore PocketID's branding
- **Pros**: One look everywhere, nothing to fetch on each render.
- **Cons**: Signing in jumps between two differently branded products, and
  an admin who chose a logo and colour in PocketID has to set them again
  somewhere else.
- **Why not**: The three values are cheap to read (cached for 5 minutes,
  2-second timeout, falls back silently) and do most of the work of making
  the portal feel like part of the same setup.

### Alternative 3: Use the accent unchanged in dark mode
- **Pros**: Exactly the admin's colour everywhere.
- **Cons**: Dark accents become invisible buttons on a near-black page.
- **Why not**: Readability beats colour fidelity. The light theme keeps the
  exact colour.

## Consequences

### Positive
- The portal looks like part of the same setup as PocketID, while staying
  designed for people who don't know what the apps are.
- Any accent an admin picks stays readable, in both themes.

### Negative
- In the dark theme, an admin's accent can be shown lighter than they chose.
- `DARK_GROUND` in `src/lib/pocketid/branding.ts` must match `--ground`
  in globals.css's dark theme.

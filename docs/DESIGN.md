# Design

The portal's look and wording. The tokens live in
[`src/app/globals.css`](../src/app/globals.css); this page says why they are
what they are, so a new page can follow them without guessing.

## Who it's for

Mostly people who **don't know what the apps behind the portal are**:
family members and friends, not the admin who runs the server. "Jellyfin"
means nothing to them; "watch films and series" does. So:

- **Lead with what an app is for.** An app card shows its PocketID
  description as the headline and its name above it, small. Write
  descriptions in PocketID as a plain task ("Watch films and series"), not a
  product category ("Media server").
- **Plain words.** "Ask for access", "Waiting for an admin", "You won't need
  another password". Avoid OIDC, client, scope and similar jargon on
  user-facing pages. Group names still appear where someone has to choose
  between two groups.
- **Say what happens next.** Every request state tells the person what to
  expect, e.g. an approval says it shows up within a few minutes.

## Look

Warm paper and ink, with one terracotta accent. When PocketID has an accent
colour, it replaces the terracotta (`--brand`, `--on-brand`, `--brand-hover`,
contrast-checked in `src/lib/pocketid/branding.ts`), lightened in the dark
theme if needed so the buttons stay visible. Only PocketID's name, logo and
accent carry over, never the rest of its look:
[ADR-0010](adr/0010-inherit-pocketid-branding-not-theme.md).

| Token | Light | Dark | Use |
|---|---|---|---|
| `ground` | `#fbf8f3` | `#16130f` | Page background |
| `surface` | `#ffffff` | `#201c17` | Cards, inputs |
| `surface-muted` | `#f1ebe2` | `#2a251f` | Bands, hover, icon wells |
| `ink` / `ink-muted` | `#1f1b16` / `#5e554b` | `#f3ede4` / `#bdb2a4` | Text |
| `line` / `line-strong` | ink at 9% / 18% | white at 9% / 20% | Borders |
| `tip`, `ok`, `bad` (+ `on-*`, `*-line`) | amber, green, red tints | darker tints | Notices and request states |
| `brand` | `#b4461f` on white | `#e8865f` on ink | Primary buttons |

Every text pair is at least 4.5:1, and most are 7:1 or more. The
Playwright accessibility suite runs axe on every page in both themes.

**Type:** Figtree (self-hosted by `next/font`), extra-bold for page titles,
bold for card headlines. Geist Mono only for codes and identifiers.

**Components** (in `globals.css`, `@layer components`):

- `.btn` with `.btn-primary`, `.btn-secondary` or `.btn-quiet`: pill
  buttons at least 44px tall that shrink slightly when pressed.
- `.card`: white surface, 20px radius, faint border and shadow. Add
  `.card-link` when the whole card is a link: it lifts on hover.
- `.field`: text inputs and textareas.

## Polish rules

- Transition only the properties that change, never `transition: all`. Press
  feedback is `scale(0.96)`. Everything goes still under
  `prefers-reduced-motion`.
- Headings use `text-wrap: balance` and paragraphs `text-wrap: pretty` (set
  globally). Counts and badges use `tabular-nums`.
- Touch targets are at least 44px. Focus is a 2px ink ring, 3px out.
- Use the tokens, never raw hex or Tailwind's `zinc-*`. The one exception is
  the per-app tint behind an app without a logo (`src/app/apps/page.tsx`).

// Finding an app on /apps: an admin-set category per app (app_overrides,
// see ADR-0007), and a free-text search. Pure, so the page stays a server
// component driven by its URL (?q=…&category=…), which works without
// JavaScript and can be shared or bookmarked.

// A chip label, not a sentence.
export const MAX_CATEGORY_LENGTH = 40;
const MAX_QUERY_LENGTH = 100;

export interface BrowseParams {
  q?: string;
  category?: string;
  // The app whose request form is open (?ask=<PocketID client id>).
  ask?: string;
}

type Browsable = { name: string; description: string; category: string | null };

// What gets stored: trimmed, inner whitespace collapsed, cut to length.
// Blank means "no category" (null), never an empty-string category.
export function normalizeCategory(input: string | null | undefined): string | null {
  const clean = (input ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_CATEGORY_LENGTH).trim();
  return clean === "" ? null : clean;
}

export function categoriesOf(apps: Browsable[]): string[] {
  const seen = new Set<string>();
  for (const app of apps) if (app.category) seen.add(app.category);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function filterApps<T extends Browsable>(apps: T[], { q, category }: BrowseParams): T[] {
  const needle = q?.toLocaleLowerCase();
  return apps.filter(
    (app) =>
      (!category || app.category === category) &&
      (!needle ||
        [app.name, app.description, app.category ?? ""].some((field) =>
          field.toLocaleLowerCase().includes(needle),
        )),
  );
}

// Next hands search params over as string | string[] | undefined.
export function readBrowseParams(
  params: Record<string, string | string[] | undefined> | undefined,
): BrowseParams {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  const q = first(params?.q).slice(0, MAX_QUERY_LENGTH);
  const category = first(params?.category);
  const ask = first(params?.ask);
  return { ...(q && { q }), ...(category && { category }), ...(ask && { ask }) };
}

// The /apps URL for a search and/or category, for the category links (which
// keep the search) and the "show everything" link; with `ask`, the same view
// with one app's request form open (its Ask link), and without, closed again
// (Cancel).
export function browseHref({ q, category, ask }: BrowseParams): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (ask) params.set("ask", ask);
  const query = params.toString();
  return query ? `/apps?${query}` : "/apps";
}

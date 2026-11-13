// News posts (#22): who sees one, in what order, and what an admin's form
// may contain. The rules live here as plain functions; lib/news/store.ts
// applies the same visibility in SQL.

export interface NewsPost {
  id: string;
  title: string;
  body: string;
  authorSubject: string;
  publishedAt: Date;
  pinned: boolean;
  expiresAt: Date | null;
  // PocketID group names (as in the OIDC groups claim); empty: everyone.
  audienceGroups: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PostInput {
  title: string;
  body: string;
  pinned: boolean;
  expiresAt: Date | null;
  audienceGroups: string[];
}

export const MAX_TITLE_LENGTH = 120;
export const MAX_BODY_LENGTH = 10_000;

// Published, not expired, and for everyone or for one of their groups.
export function isVisibleTo(post: NewsPost, userGroups: string[], now: Date): boolean {
  if (post.publishedAt > now) return false;
  if (post.expiresAt && post.expiresAt <= now) return false;
  return post.audienceGroups.length === 0 || post.audienceGroups.some((group) => userGroups.includes(group));
}

// Pinned first, then the newest.
export function orderPosts(posts: NewsPost[]): NewsPost[] {
  return [...posts].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
}

export type PostProblem =
  | "title_required"
  | "title_too_long"
  | "body_required"
  | "body_too_long"
  | "bad_date"
  | "unknown_group";

// An admin's form, checked: a form is user input, and the audience must be
// groups PocketID actually has. "Shown until" is a day, inclusive, in UTC.
export function normalizePostInput(
  form: FormData,
  knownGroups: string[],
): { ok: true; value: PostInput } | { ok: false; reason: PostProblem } {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const title = text("title");
  const body = text("body");
  if (!title) return { ok: false, reason: "title_required" };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, reason: "title_too_long" };
  if (!body) return { ok: false, reason: "body_required" };
  if (body.length > MAX_BODY_LENGTH) return { ok: false, reason: "body_too_long" };

  let expiresAt: Date | null = null;
  const until = text("expiresAt");
  if (until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { ok: false, reason: "bad_date" };
    expiresAt = new Date(`${until}T23:59:59.999Z`);
    if (Number.isNaN(expiresAt.getTime())) return { ok: false, reason: "bad_date" };
  }

  const audienceGroups = [
    ...new Set(form.getAll("audience").filter((v): v is string => typeof v === "string" && v !== "")),
  ];
  if (audienceGroups.some((group) => !knownGroups.includes(group))) return { ok: false, reason: "unknown_group" };

  return { ok: true, value: { title, body, pinned: form.get("pinned") === "on", expiresAt, audienceGroups } };
}

import type { NewsPost } from "@/lib/news/posts";
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "@/lib/news/posts";
import type { PocketIdUserGroup } from "@/lib/pocketid/client";
import type { getTranslations } from "@/i18n/server";

type AdminNewsT = Awaited<ReturnType<typeof getTranslations<"AdminNews">>>;

// Why a save came back (?problem=, from ./actions). An allowlist: the query
// is user input.
const PROBLEMS = {
  title_required: "problemTitleRequired",
  title_too_long: "problemTitleTooLong",
  body_required: "problemBodyRequired",
  body_too_long: "problemBodyTooLong",
  bad_date: "problemBadDate",
  unknown_group: "problemUnknownGroup",
} as const;

export function problemMessage(problem: unknown, t: AdminNewsT): string | null {
  return typeof problem === "string" && Object.hasOwn(PROBLEMS, problem)
    ? t(PROBLEMS[problem as keyof typeof PROBLEMS])
    : null;
}

// One form for a new post and an edit (#22). Plain fields and a plain form
// action, so it works before (or without) JavaScript.
export function PostForm({
  action,
  post,
  groups,
  problem,
  t,
}: {
  action: (formData: FormData) => Promise<void>;
  post?: NewsPost;
  groups: PocketIdUserGroup[];
  problem: string | null;
  t: AdminNewsT;
}) {
  const until = post?.expiresAt ? post.expiresAt.toISOString().slice(0, 10) : "";
  return (
    <form action={action} className="card flex flex-col gap-5 p-6">
      {problem ? (
        <p role="alert" className="rounded-xl border border-bad-line bg-bad px-4 py-3 text-sm font-semibold text-on-bad">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="font-semibold">
          {t("titleLabel")}
        </label>
        <input id="title" name="title" required maxLength={MAX_TITLE_LENGTH} defaultValue={post?.title} className="field" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className="font-semibold">
          {t("bodyLabel")}
        </label>
        <p id="body-hint" className="text-sm text-ink-muted">
          {t("bodyHint")}
        </p>
        <textarea
          id="body"
          name="body"
          required
          rows={8}
          maxLength={MAX_BODY_LENGTH}
          defaultValue={post?.body}
          aria-describedby="body-hint"
          className="field"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">{t("audienceLegend")}</legend>
        <p className="text-sm text-ink-muted">{t("audienceHint")}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {groups.map((group) => (
            <label key={group.id} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="audience"
                value={group.name}
                defaultChecked={post?.audienceGroups.includes(group.name)}
              />
              {group.friendlyName || group.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="expiresAt" className="font-semibold">
            {t("untilLabel")}
          </label>
          <input id="expiresAt" name="expiresAt" type="date" defaultValue={until} className="field" />
        </div>
        <label className="inline-flex items-center gap-2 self-end pb-2">
          <input type="checkbox" name="pinned" defaultChecked={post?.pinned} />
          {t("pinnedLabel")}
        </label>
      </div>

      <div>
        <button type="submit" className="btn btn-primary">
          {post ? t("save") : t("publish")}
        </button>
      </div>
    </form>
  );
}

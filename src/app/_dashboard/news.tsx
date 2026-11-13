import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listPostsFor } from "@/lib/news/store";
import { renderMarkdown } from "@/lib/news/markdown";
import type { NewsPost } from "@/lib/news/posts";
import { getLocale, getTranslations } from "@/i18n/server";
import { DashboardSection, loadSection } from "./section";

const SECTION_ID = "news";
// Five on the dashboard; asking for one more says whether there's more.
const SHOWN = 5;

type NewsT = Awaited<ReturnType<typeof getTranslations<"News">>>;

// One post, as the dashboard and /news show it: its title names the
// article, then the date (and Pinned), then its words, rendered from
// Markdown on the server into elements, never HTML (lib/news/markdown).
export function NewsArticle({ post, t, locale }: { post: NewsPost; t: NewsT; locale: string }) {
  const titleId = `news-${post.id}`;
  return (
    <article aria-labelledby={titleId} className="card flex flex-col gap-2 p-5">
      <h3 id={titleId} className="text-lg font-bold">
        {post.title}
      </h3>
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <time dateTime={post.publishedAt.toISOString()}>
          {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(post.publishedAt)}
        </time>
        {post.pinned ? <span className="badge badge-tip">{t("pinned")}</span> : null}
      </p>
      <div className="news-body flex flex-col gap-2 text-[15px] [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-surface-muted [&_code]:px-1 [&_h4]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6">
        {renderMarkdown(post.body)}
      </div>
    </article>
  );
}

// News on the dashboard (#22), filtered for this person on the server: a
// post for other groups never reaches the browser. A dashboard section
// (./section): with no news, or if it can't be read, it isn't there.
export async function News({ userGroups }: { userGroups: string[] }) {
  const loaded = await loadSection("News", () => listPostsFor(getDb(), userGroups, new Date(), SHOWN + 1));
  if (!loaded.ok || loaded.value.length === 0) return null;

  const [t, locale] = await Promise.all([getTranslations("News"), getLocale()]);
  const more = loaded.value.length > SHOWN;

  return (
    <DashboardSection
      id={SECTION_ID}
      heading={t("heading")}
      action={
        more ? (
          <Link href="/news" className="text-[15px] font-semibold text-ink underline underline-offset-4">
            {t("all")}
          </Link>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {loaded.value.slice(0, SHOWN).map((post) => (
          <NewsArticle key={post.id} post={post} t={t} locale={locale} />
        ))}
      </div>
    </DashboardSection>
  );
}
